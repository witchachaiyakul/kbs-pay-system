// public/js/budget.js
import { db } from "./firestore.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    limit,
    addDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 GLOBAL VARIABLES & GOOGLE CHARTS ASYNC INITIALIZATION
// ============================================================================
window.budgetPlansCache = [];
let currentDisbursePlan = null;
let isGoogleChartsReady = false;

// โหลด Google Charts และตั้งค่า Callback เมื่อพร้อมใช้งาน
if (typeof google !== 'undefined' && google.charts) {
  google.charts.load('current', { 'packages': ['corechart'] });
  google.charts.setOnLoadCallback(() => {
    isGoogleChartsReady = true;
    // หากมีข้อมูลอยู่ใน Cache แล้วให้สั่งวาดกราฟซ้ำอีกครั้งเมื่อไลบรารีพร้อม
    if (window.budgetPlansCache && window.budgetPlansCache.length > 0) {
      renderOverviewCharts(window.budgetPlansCache);
    }
  });
}

// ============================================================================
// 📊 1. FIRESTORE BUDGET PLANS FETCH ENGINE
// ============================================================================

export async function getBudgetPlans(fundTypeFilter = null) {
  try {
    const plansRef = collection(db, "budget_plans");
    let q = fundTypeFilter 
      ? query(plansRef, where("fund_type", "==", fundTypeFilter))
      : query(plansRef, limit(500));

    const querySnapshot = await getDocs(q);
    const plans = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const total = Number(data.total_budget || data.budget_set || data.amount || 0);
      const used = Number(data.used_budget || data.budget_used || 0);
      const remain = Number(data.remaining_budget || (total - used));

      plans.push({
        id: docSnap.id,
        project_id: data.project_id || docSnap.id,
        division: data.division || data.ฝ่าย || 'ไม่ระบุ',
        project_name: data.project_name || data.โครงการ || '-',
        activity_name: data.activity_name || data.กิจกรรม || '-',
        fund_type: data.fund_type || data.ประเภทเงิน || 'อื่นๆ',
        total_budget: total,
        used_budget: used,
        remaining_budget: remain,
        responsible_person: data.responsible_person || data.owner || data.ผู้รับผิดชอบ || '-'
      });
    });

    return { success: true, totalCount: plans.length, data: plans };
  } catch (error) {
    console.error("❌ getBudgetPlans Error:", error);
    return { success: false, message: error.message, data: [] };
  }
}

export async function getBudgetPlansByDept(deptName) {
  try {
    if (!deptName) return { success: false, message: "ไม่ได้ระบุชื่อฝ่าย", data: [] };
    
    const plansRef = collection(db, "budget_plans");
    const q = query(plansRef, where("division", "==", deptName));
    const querySnapshot = await getDocs(q);
    const list = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const total = Number(data.total_budget || data.budget_set || data.amount || 0);
      const used = Number(data.used_budget || data.budget_used || 0);

      list.push({
        id: docSnap.id,
        ...data,
        total_budget: total,
        used_budget: used,
        remaining_budget: Number(data.remaining_budget || (total - used))
      });
    });

    return { success: true, data: list };
  } catch (error) {
    console.error("❌ getBudgetPlansByDept Error:", error);
    return { success: false, message: error.message, data: [] };
  }
}

// ============================================================================
// 📈 2. DASHBOARD & KPI DATA LOADER
// ============================================================================

export async function loadKbsBudgetData() {
  setKpiLoadingState();

  const response = await getBudgetPlans();
  if (response && response.success) {
    const plans = response.data || [];
    window.budgetPlansCache = plans; // บันทึก Cache หน้าบ้าน

    let grandTotalBudget = 0;
    let grandUsedBudget = 0;
    let grandRemainingBudget = 0;
    const fundSummary = {};

    plans.forEach(data => {
      const total = Number(data.total_budget || 0);
      const used = Number(data.used_budget || 0);
      const remain = Number(data.remaining_budget || (total - used));

      grandTotalBudget += total;
      grandUsedBudget += used;
      grandRemainingBudget += remain;

      const fundType = String(data.fund_type || 'อื่นๆ').trim();

      // 1. สรุปยอดตามชื่อ fund_type แต่ละหมวดตรงๆ
      if (!fundSummary[fundType]) {
        fundSummary[fundType] = { total: 0, used: 0, remain: 0, count: 0 };
      }
      fundSummary[fundType].total += total;
      fundSummary[fundType].used += used;
      fundSummary[fundType].remain += remain;
      fundSummary[fundType].count += 1;

      // 2. เงื่อนไขพิเศษ: ถ้า fund_type มีคำว่า "รายได้" ให้สะสมยอดเข้า "รายได้สถานศึกษารวม" ด้วย
      if (fundType.includes('รายได้')) {
        const keyTotal = 'รายได้สถานศึกษารวม';
        if (!fundSummary[keyTotal]) {
          fundSummary[keyTotal] = { total: 0, used: 0, remain: 0, count: 0 };
        }
        fundSummary[keyTotal].total += total;
        fundSummary[keyTotal].used += used;
        fundSummary[keyTotal].remain += remain;
        fundSummary[keyTotal].count += 1;
      }
    });

    const progressPercent = grandTotalBudget > 0 
      ? ((grandUsedBudget / grandTotalBudget) * 100).toFixed(2) 
      : '0.00';

    // อัปเดตตัวเลข KPI บนหน้าเว็บ
    if (document.getElementById('kpiTotalBudget')) document.getElementById('kpiTotalBudget').innerText = grandTotalBudget.toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿';
    if (document.getElementById('kpiTotalSpent')) document.getElementById('kpiTotalSpent').innerText = grandUsedBudget.toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿';
    if (document.getElementById('kpiTotalRemain')) document.getElementById('kpiTotalRemain').innerText = grandRemainingBudget.toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿';
    if (document.getElementById('kpiTotalProgress')) document.getElementById('kpiTotalProgress').innerText = progressPercent + ' %';

    // 🎯 1. อัปเดตการ์ดสรุปความคืบหน้าด้านล่าง (12 การ์ด)
    updateFundCardLabels(fundSummary);

    // 🎯 2. อัปเดต 3 กราฟภาพรวมด้านบน (donutDept, donutTypeBudget, donutTypeSpent)
    renderOverviewCharts(plans);

  } else {
    showKpiErrorState(response?.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
  }
}

function setKpiLoadingState() {
  if (document.getElementById('kpiTotalBudget')) document.getElementById('kpiTotalBudget').innerText = 'กำลังโหลด...';
  if (document.getElementById('kpiTotalSpent')) document.getElementById('kpiTotalSpent').innerText = 'กำลังโหลด...';
  if (document.getElementById('kpiTotalRemain')) document.getElementById('kpiTotalRemain').innerText = 'กำลังโหลด...';
  if (document.getElementById('kpiTotalProgress')) document.getElementById('kpiTotalProgress').innerText = '...';
}

function showKpiErrorState(errMsg) {
  if (document.getElementById('kpiTotalBudget')) document.getElementById('kpiTotalBudget').innerText = 'ข้อผิดพลาด';
  if (document.getElementById('kpiTotalSpent')) document.getElementById('kpiTotalSpent').innerText = '-';
  if (document.getElementById('kpiTotalRemain')) document.getElementById('kpiTotalRemain').innerText = '-';
  if (document.getElementById('kpiTotalProgress')) document.getElementById('kpiTotalProgress').innerText = '-';
}

// ============================================================================
// 🎨 3. CHART RENDER ENGINE & SAFE DRAWING
// ============================================================================

// ฟังก์ชันสำหรับเรียกวาด Google Chart อย่างปลอดภัย (ดักรอ Async โหลดเสร็จ)
function safeDrawPieChart(containerId, dataArray, options) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!isGoogleChartsReady || typeof google === 'undefined' || !google.visualization || typeof google.visualization.PieChart !== 'function') {
    setTimeout(() => safeDrawPieChart(containerId, dataArray, options), 200);
    return;
  }

  const data = google.visualization.arrayToDataTable(dataArray);
  const chart = new google.visualization.PieChart(container);
  chart.draw(data, options);
}

// วาดกราฟโดนัทคงเหลือ/ใช้ไปของการ์ดแต่ละใบด้านล่าง
function renderDonutChart(containerId, used, remain) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (used <= 0 && remain <= 0) {
    container.innerHTML = '<div class="text-center text-muted pt-5 small">ไม่มีงบประมาณ</div>';
    return;
  }

  const dataArray = [
    ['สถานะ', 'จำนวนเงิน'],
    ['ใช้ไปแล้ว', used],
    ['คงเหลือ', remain]
  ];

  const options = {
    pieHole: 0.55,
    colors: ['#ef4444', '#10b981'],
    legend: { position: 'bottom', textStyle: { fontSize: 11 } },
    chartArea: { width: '90%', height: '75%' },
    tooltip: { text: 'value' },
    backgroundColor: 'transparent'
  };

  safeDrawPieChart(containerId, dataArray, options);
}

// วาด 3 กราฟภาพรวมด้านบน
function renderOverviewCharts(plans) {
  if (!plans || plans.length === 0) return;

  const deptSummary = {};       // งบตามกลุ่มบริหารงาน (donutDept)
  const fundBudgetSummary = {}; // งบตั้งตามแหล่งงบประมาณ (donutTypeBudget)
  const fundSpentSummary = {};  // ยอดใช้จริงตามประเภทเงิน (donutTypeSpent)

  plans.forEach(item => {
    const dept = item.division || 'ไม่ระบุ';
    const fund = item.fund_type || 'อื่นๆ';
    const total = Number(item.total_budget || 0);
    const used = Number(item.used_budget || 0);

    deptSummary[dept] = (deptSummary[dept] || 0) + total;
    fundBudgetSummary[fund] = (fundBudgetSummary[fund] || 0) + total;
    if (used > 0) {
      fundSpentSummary[fund] = (fundSpentSummary[fund] || 0) + used;
    }
  });

  // 1. งบประมาณตามกลุ่มบริหารงาน (donutDept)
  renderPieDonutCategory('donutDept', 'กลุ่มบริหารงาน', deptSummary);

  // 2. งบประมาณตามแหล่งงบประมาณ (donutTypeBudget)
  renderPieDonutCategory('donutTypeBudget', 'แหล่งงบประมาณ', fundBudgetSummary);

  // 3. ยอดใช้จ่ายจริงตามประเภทเงิน (donutTypeSpent)
  renderPieDonutCategory('donutTypeSpent', 'ประเภทเงิน', fundSpentSummary);

  // สรุปตัวเลขใต้กราฟที่ 3
  const sumSpentElem = document.getElementById('sumTypeSpent');
  if (sumSpentElem) {
    const totalSpentAll = Object.values(fundSpentSummary).reduce((a, b) => a + b, 0);
    sumSpentElem.innerHTML = `<span class="fw-bold text-dark fs-6">รวมยอดใช้จ่ายจริงทุกประเภทเงิน: </span><span class="fw-bold text-danger fs-5">${totalSpentAll.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</span>`;
  }
}

function renderPieDonutCategory(containerId, categoryLabel, summaryData) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const entries = Object.entries(summaryData);
  if (entries.length === 0) {
    container.innerHTML = '<div class="text-center text-muted pt-5 small">ไม่มีข้อมูล</div>';
    return;
  }

  const dataArray = [[categoryLabel, 'จำนวนเงิน']];
  entries.forEach(([key, val]) => {
    dataArray.push([key, val]);
  });

  const options = {
    pieHole: 0.45,
    chartArea: { width: '90%', height: '80%' },
    legend: { position: 'right', textStyle: { fontSize: 12 } },
    backgroundColor: 'transparent',
    pieSliceText: 'percentage'
  };

  safeDrawPieChart(containerId, dataArray, options);
}

function updateFundCardLabels(fundSummary) {
  const cardMapping = {
    'อุดหนุน': { chartId: 'progress_อุดหนุน', labelId: 'sumProgress_อุดหนุน' },
    'อุดหนุน งบประมาณคงเหลือปี 68': { chartId: 'progress_อุดหนุน_งบประมาณคงเหลือปี_68', labelId: 'sumProgress_อุดหนุน_งบประมาณคงเหลือปี_68' },
    'กิจกรรมพัฒนาผู้เรียน': { chartId: 'progress_กิจกรรมพัฒนาผู้เรียน', labelId: 'sumProgress_กิจกรรมพัฒนาผู้เรียน' },
    'รายได้สถานศึกษารวม': { chartId: 'progress_สรุปรายได้', labelId: 'sumProgress_สรุปรายได้' },
    'รายได้ SMTE': { chartId: 'progress_รายได้_SMTE', labelId: 'sumProgress_รายได้_SMTE' },
    'รายได้ STI': { chartId: 'progress_รายได้_STI', labelId: 'sumProgress_รายได้_STI' },
    'รายได้ คอมพิวเตอร์': { chartId: 'progress_รายได้_คอมพิวเตอร์', labelId: 'sumProgress_รายได้_คอมพิวเตอร์' },
    'รายได้ ภาษาอังกฤษ': { chartId: 'progress_รายได้_ภาษาอังกฤษ', labelId: 'sumProgress_รายได้_ภาษาอังกฤษ' },
    'รายได้ EIS': { chartId: 'progress_รายได้_EIS', labelId: 'sumProgress_รายได้_EIS' },
    'รายได้ ภาษาจีน': { chartId: 'progress_รายได้_ภาษาจีน', labelId: 'sumProgress_รายได้_ภาษาจีน' },
    'รายได้ หอพัก': { chartId: 'progress_รายได้_หอพัก', labelId: 'sumProgress_รายได้_หอพัก' },
    'รายได้สถานศึกษา': { chartId: 'progress_รายได้สถานศึกษา', labelId: 'sumProgress_รายได้สถานศึกษา' }
  };

  Object.keys(cardMapping).forEach(fundKey => {
    const config = cardMapping[fundKey];
    const summary = fundSummary[fundKey];
    const labelElem = document.getElementById(config.labelId);

    if (summary) {
      renderDonutChart(config.chartId, summary.used, summary.remain);

      if (labelElem) {
        labelElem.innerHTML = `
          <div class="fw-bold text-dark mb-1">รวม ${summary.count} โครงการ</div>
          <div class="text-success small fw-semibold">คงเหลือ: ${summary.remain.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</div>
          <div class="text-danger small fw-semibold">ใช้ไป: ${summary.used.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</div>
        `;
      }
    } else {
      const chartElem = document.getElementById(config.chartId);
      if (chartElem) chartElem.innerHTML = '<div class="text-center text-muted pt-5 small">ไม่มีข้อมูล</div>';
      if (labelElem) labelElem.innerHTML = '<span class="text-muted small">ไม่มีรายการข้อมูล</span>';
    }
  });
}

// ============================================================================
// 🔍 4. MODAL DETAIL POP-UP (คัดกรองข้อมูลจาก Cache 7 คอลัมน์)
// ============================================================================

export function openBudgetDetail(fundType) {
  const modalElement = document.getElementById('budgetDetailModal');
  if (!modalElement) return;
  
  const modal = new bootstrap.Modal(modalElement);
  
  const titleElem = document.getElementById('modalFundTypeTitle');
  if (titleElem) titleElem.innerText = fundType;

  const loading = document.getElementById('modalLoading');
  const tableWrapper = document.getElementById('modalTableWrapper');
  const emptyMsg = document.getElementById('modalEmptyMsg');
  const tbody = document.getElementById('modalBudgetDetailBody');

  if (loading) loading.classList.remove('d-none');
  if (tableWrapper) tableWrapper.classList.add('d-none');
  if (emptyMsg) emptyMsg.classList.add('d-none');
  if (tbody) tbody.innerHTML = '';

  modal.show();

  let plansData = [];
  if (window.budgetPlansCache && Array.isArray(window.budgetPlansCache)) {
    if (fundType === 'รายได้สถานศึกษารวม') {
      plansData = window.budgetPlansCache.filter(item => 
        item.fund_type && String(item.fund_type).includes('รายได้')
      );
    } else {
      plansData = window.budgetPlansCache.filter(item => item.fund_type === fundType);
    }
  }

  if (loading) loading.classList.add('d-none');

  if (plansData.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove('d-none');
    return;
  }

  let rowsHtml = '';
  plansData.forEach((item) => {
    const total = Number(item.total_budget || 0);
    const used = Number(item.used_budget || 0);
    const remain = Number(item.remaining_budget || (total - used));

    rowsHtml += `
      <tr>
        <td class="text-center fw-semibold text-navy">${item.division || '-'}</td>
        <td>
          <div class="fw-bold text-dark">${item.project_name || '-'}</div>
          <small class="text-muted">รหัส: ${item.project_id || '-'}</small>
        </td>
        <td>${item.activity_name || '-'}</td>
        <td class="text-end fw-bold text-dark">${total.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
        <td class="text-end fw-bold text-danger">${used.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
        <td class="text-end fw-bold text-success">${remain.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
        <td class="text-center small">${item.responsible_person || '-'}</td>
      </tr>
    `;
  });

  if (tbody) tbody.innerHTML = rowsHtml;
  if (tableWrapper) tableWrapper.classList.remove('d-none');
}

// ============================================================================
// ✂️ 5. DISBURSEMENT & MODULE 3 FUNCTIONS
// ============================================================================

export function resetFormToMain() {
  window.location.href = "index.html";
}

export async function filterByDept(deptName) {
  const deptTitle = document.getElementById('selectedDeptName');
  const loading = document.getElementById('deptTableLoading');
  const tableBody = document.getElementById('deptActivitiesTableBody');

  if (deptTitle) deptTitle.innerText = deptName;
  if (loading) loading.classList.remove('d-none');
  if (tableBody) tableBody.innerHTML = '';

  const res = await getBudgetPlansByDept(deptName);
  
  if (loading) loading.classList.add('d-none');

  if (res.success && res.data.length > 0) {
    tableBody.innerHTML = res.data.map(item => {
      const budget = parseFloat(item.total_budget || 0);
      const spent = parseFloat(item.used_budget || 0);
      const remain = budget - spent;

      return `
        <tr>
          <td class="text-center">${item.division || '-'}</td>
          <td>${item.project_name || '-'}</td>
          <td>${item.activity_name || '-'}</td>
          <td class="text-center"><span class="badge bg-secondary">${item.fund_type || '-'}</span></td>
          <td class="text-end fw-bold">${budget.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
          <td class="text-end text-danger">${spent.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
          <td class="text-end text-success fw-bold">${remain.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
          <td>${item.responsible_person || item.owner || '-'}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-primary" onclick="openDisburseModal('${item.id}', '${item.activity_name || ''}', ${budget}, ${spent})">
              <i class="bi bi-scissors"></i> ตัดจ่าย
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-4 text-warning">
          <i class="bi bi-exclamation-triangle me-1"></i> ไม่พบรายการโครงการในฝ่าย ${deptName}
        </td>
      </tr>
    `;
  }
}

export function openDisburseModal(id, activityName, total, used) {
  currentDisbursePlan = { id, activityName, total, used, remain: total - used };
  
  const title = document.getElementById('mdActivityName');
  if (title) title.innerText = activityName;

  document.getElementById('calcTotalBudget').innerText = total.toLocaleString('th-TH', {minimumFractionDigits:2}) + ' ฿';
  document.getElementById('calcUsedBudget').innerText = used.toLocaleString('th-TH', {minimumFractionDigits:2}) + ' ฿';
  document.getElementById('calcBeforeRemain').innerText = (total - used).toLocaleString('th-TH', {minimumFractionDigits:2}) + ' ฿';
  
  document.getElementById('mdInpAmount').value = '';
  calculateDisburseBalance();

  const modal = new bootstrap.Modal(document.getElementById('disburseModal'));
  modal.show();
}

export function calculateDisburseBalance() {
  if (!currentDisbursePlan) return;

  const reqVal = parseFloat(document.getElementById('mdInpAmount')?.value || 0);
  const afterRemain = currentDisbursePlan.remain - reqVal;
  
  const reqDisp = document.getElementById('calcReqAmount');
  const afterDisp = document.getElementById('calcAfterRemain');
  const alertOver = document.getElementById('alertOverBudget');
  const submitBtn = document.getElementById('btnSubmitDisburseDoc');

  if (reqDisp) reqDisp.innerText = reqVal.toLocaleString('th-TH', {minimumFractionDigits:2}) + ' ฿';
  if (afterDisp) afterDisp.innerText = afterRemain.toLocaleString('th-TH', {minimumFractionDigits:2}) + ' ฿';

  if (afterRemain < 0) {
    if (alertOver) alertOver.classList.remove('d-none');
    document.getElementById('overAmount').innerText = Math.abs(afterRemain).toLocaleString('th-TH', {minimumFractionDigits:2});
    if (submitBtn) submitBtn.disabled = true;
  } else {
    if (alertOver) alertOver.classList.add('d-none');
    if (submitBtn) submitBtn.disabled = false;
  }
}

export async function submitDisbursePlanDoc() {
  const amount = parseFloat(document.getElementById('mdInpAmount').value);
  const purpose = document.getElementById('mdSelPurchase').value;
  const user = document.getElementById('mdSelCommittee').value;
  const remark = document.getElementById('mdInpRemark').value;

  if (!amount || amount <= 0 || !user) {
    alert("กรุณากรอกข้อมูลจำนวนเงินและผู้ขอใช้ให้ครบถ้วน");
    return;
  }

  try {
    const docRef = await addDoc(collection(db, "log_budget"), {
      project_id: currentDisbursePlan.id,
      activities: currentDisbursePlan.activityName,
      method: purpose,
      budget_use: amount,
      buyer: user,
      details: remark,
      createdAt: serverTimestamp()
    });

    bootstrap.Modal.getInstance(document.getElementById('disburseModal'))?.hide();

    document.getElementById('successLogNo').innerText = docRef.id;
    const successModal = new bootstrap.Modal(document.getElementById('disburseSuccessModal'));
    successModal.show();
  } catch (err) {
    alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
  }
}

export function resetAndReopenDisburse() {
  bootstrap.Modal.getInstance(document.getElementById('disburseSuccessModal'))?.hide();
  if (currentDisbursePlan) {
    openDisburseModal(currentDisbursePlan.id, currentDisbursePlan.activityName, currentDisbursePlan.total, currentDisbursePlan.used);
  }
}

// ============================================================================
// 🚀 6. AUTOMATIC INITIALIZATION ON DOM READY
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  loadKbsBudgetData();
});

// ============================================================================
// 🌐 7. GLOBAL WINDOW EXPORTS FOR HTML INLINE EVENTS
// ============================================================================
window.getBudgetPlans = getBudgetPlans;
window.getBudgetPlansByDept = getBudgetPlansByDept;
window.loadKbsBudgetData = loadKbsBudgetData;
window.openBudgetDetail = openBudgetDetail;
window.resetFormToMain = resetFormToMain;
window.filterByDept = filterByDept;
window.openDisburseModal = openDisburseModal;
window.calculateDisburseBalance = calculateDisburseBalance;
window.submitDisbursePlanDoc = submitDisbursePlanDoc;
window.resetAndReopenDisburse = resetAndReopenDisburse;