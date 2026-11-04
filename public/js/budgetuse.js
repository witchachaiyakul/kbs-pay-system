// js/budgetuse.js
import { db } from "./firestore.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    getDoc,
    doc,
    setDoc,
    updateDoc,
    runTransaction,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 GLOBAL VARIABLES & CACHE
// ============================================================================
window.budgetPlansCache = [];
let currentSelectedActivity = null;

// ============================================================================
// 1. DATA FETCHING (COMMITTEES & DIVISION PLANS)
// ============================================================================

// ดึงรายชื่อผู้ขอใช้ (Committees) มาใส่ใน <datalist id="committee_list">
export async function populateCommitteesDropdown() {
  const listElement = document.getElementById('committee_list');
  if (!listElement) return;

  try {
    const qSnapshot = await getDocs(collection(db, "committees"));
    listElement.innerHTML = '';

    qSnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const name = data.name || data.comm_name || data.fullname || '';
      if (name) {
        const opt = document.createElement('option');
        opt.value = name;
        listElement.appendChild(opt);
      }
    });
  } catch (err) {
    console.warn("⚠️ ไม่สามารถโหลดข้อมูลคณะกรรมการ:", err);
  }
}

// กรองกิจกรรมตามฝ่าย (5 ฝ่าย)
export async function filterByDept(deptName) {
  const deptTitle = document.getElementById('selectedDeptName');
  const tbody = document.getElementById('deptActivitiesTableBody');
  const loading = document.getElementById('deptTableLoading');
  const tableWrapper = document.getElementById('deptTableWrapper');

  if (deptTitle) deptTitle.innerText = deptName;
  if (loading) loading.classList.remove('d-none');
  if (tableWrapper) tableWrapper.classList.add('d-none');
  if (tbody) tbody.innerHTML = '';

  try {
    const plansRef = collection(db, "budget_plans");
    let q;
    if (deptName && deptName !== 'ทั้งหมด') {
      q = query(plansRef, where("division", "==", deptName));
    } else {
      q = query(plansRef);
    }

    const querySnapshot = await getDocs(q);
    const list = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const total = Number(data.total_budget || data.budget_set || data.amount || 0);
      const used = Number(data.used_budget || data.budget_used || 0);
      const remain = Number(data.remaining_budget || (total - used));

      list.push({
        id: docSnap.id,
        project_id: data.project_id || docSnap.id,
        division: data.division || data.ฝ่าย || '-',
        project_name: data.project_name || data.โครงการ || '-',
        activity_name: data.activity_name || data.กิจกรรม || '-',
        fund_type: data.fund_type || data.ประเภทเงิน || 'งบประมาณ',
        total_budget: total,
        used_budget: used,
        remaining_budget: remain,
        responsible_person: data.responsible_person || data.owner || data.ผู้รับผิดชอบ || '-'
      });
    });

    window.budgetPlansCache = list;

    if (loading) loading.classList.add('d-none');
    if (tableWrapper) tableWrapper.classList.remove('d-none');

    if (list.length > 0) {
      tbody.innerHTML = list.map(item => `
        <tr>
                <td class="text-center fw-semibold text-navy text-wrap text-break">${item.division}</td>
                <td class="text-wrap text-break">
                    <div class="fw-bold text-dark">${item.project_name}</div>
                    <small class="text-muted">รหัส: ${item.project_id}</small>
                </td>
                <td class="text-wrap text-break">
                    <strong class="text-primary">${item.activity_name}</strong>
                </td>
                <td class="text-center align-middle p-1"> <span class="badge bg-secondary text-wrap" style="max-width: 100%; white-space: normal; line-height: 1.3;"> ${item.fund_type} </span> </td>
                <td class="text-end fw-bold text-dark text-nowrap">${item.total_budget.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
                <td class="text-end fw-bold text-danger text-nowrap">${item.used_budget.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
                <td class="text-end fw-bold text-success fs-6 text-nowrap">${item.remaining_budget.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
                <td class="text-center small text-wrap text-break">${item.responsible_person}</td>
                <td class="text-center align-middle p-1">
                    <button type="button" class="btn btn-navy btn-sm px-2 py-1 fw-bold shadow-sm w-100" onclick="openDisburseModalById('${item.project_id}')">
                    <i class="bi bi-scissors me-1"></i>ตัดจ่าย
                    </button>
                </td>
                </tr>
      `).join('');
    } else {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-warning">⚠️ ไม่พบรายการโครงการ/กิจกรรมของฝ่าย "${deptName}"</td></tr>`;
    }
  } catch (err) {
    if (loading) loading.classList.add('d-none');
    if (tableWrapper) tableWrapper.classList.remove('d-none');
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-danger">❌ เกิดข้อผิดพลาดในการโหลดข้อมูล: ${err.message}</td></tr>`;
  }
}

// ============================================================================
// 2. MODAL & REAL-TIME CALCULATION
// ============================================================================

export function openDisburseModalById(projectId) {
  const plans = window.budgetPlansCache || [];
  const item = plans.find(p => String(p.project_id) === String(projectId) || String(p.id) === String(projectId));
  if (!item) return;

  currentSelectedActivity = item;
  openDisburseModalCurrent();
}

export function openDisburseModalCurrent() {
  if (!currentSelectedActivity) return;

  const item = currentSelectedActivity;
  const nameElem = document.getElementById('mdActivityName');
  if (nameElem) nameElem.innerText = item.activity_name || item.project_name || '-';
  
  // รีเซ็ตฟอร์ม
  const form = document.getElementById('disburseForm');
  if (form) form.reset();

  document.getElementById('alertOverBudget')?.classList.add('d-none');
  const btnSubmit = document.getElementById('btnSubmitDisburseDoc');
  if (btnSubmit) btnSubmit.disabled = false;

  const total = Number(item.total_budget || 0);
  const used = Number(item.used_budget || 0);
  const remain = Number(item.remaining_budget || 0);

  document.getElementById('calcTotalBudget').innerText = total.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';
  document.getElementById('calcUsedBudget').innerText = used.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';
  document.getElementById('calcBeforeRemain').innerText = remain.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';
  document.getElementById('calcReqAmount').innerText = '0.00 ฿';
  document.getElementById('calcAfterRemain').innerText = remain.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';

  // ดึงประวัติการตัดจ่าย
  loadDisburseHistory(item.id || item.project_id);

  const modalElem = document.getElementById('disburseModal');
  if (modalElem) {
    const modal = new bootstrap.Modal(modalElem);
    modal.show();
  }
}

// โหลดประวัติรายการตัดจ่ายจาก collection "log_budget"
async function loadDisburseHistory(projectId) {
  const tbody = document.getElementById('mdDisburseHistoryBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">กำลังดึงข้อมูล...</td></tr>';

  try {
    const q = query(collection(db, "log_budget"), where("project_id", "==", String(projectId)));
    const qSnap = await getDocs(q);

    if (!qSnap.empty) {
      let html = '';
      qSnap.forEach(docSnap => {
        const h = docSnap.data();
        let displayDate = '-';

        if (h.createdAt && h.createdAt.toDate) {
          displayDate = h.createdAt.toDate().toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
        } else if (h.date) {
          displayDate = h.date;
        }

        const method = h.method || h.purchase_type || '-';
        const details = h.details || h.remark || '-';
        const applicant = h.buyer || h.requested_by || h.applicant || '-';
        const amount = Number(h.budget_use || h.amount || 0);

        html += `
          <tr>
            <td class="small">${displayDate}</td>
            <td><span class="badge bg-secondary">${method}</span></td>
            <td class="small">${details}</td>
            <td class="small">${applicant}</td>
            <td class="text-end fw-bold text-danger">${amount.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">ยังไม่เคยมีประวัติการตัดจ่ายในกิจกรรมนี้</td></tr>';
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

// คำนวณยอดเงิน Real-time
export function calculateDisburseBalance() {
  if (!currentSelectedActivity) return;

  const remain = Number(currentSelectedActivity.remaining_budget || 0);
  const reqAmount = Number(document.getElementById('mdInpAmount')?.value || 0);
  const afterRemain = remain - reqAmount;

  const reqElem = document.getElementById('calcReqAmount');
  const afterElem = document.getElementById('calcAfterRemain');
  const alertBox = document.getElementById('alertOverBudget');
  const btnSubmit = document.getElementById('btnSubmitDisburseDoc');

  if (reqElem) reqElem.innerText = reqAmount.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';
  if (afterElem) afterElem.innerText = afterRemain.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';

  if (afterRemain < 0) {
    if (document.getElementById('overAmount')) {
      document.getElementById('overAmount').innerText = Math.abs(afterRemain).toLocaleString('th-TH', {minimumFractionDigits: 2});
    }
    alertBox?.classList.remove('d-none');
    if (afterElem) afterElem.className = 'text-danger fs-5 fw-bold';
    if (btnSubmit) btnSubmit.disabled = true;
  } else {
    alertBox?.classList.add('d-none');
    if (afterElem) afterElem.className = 'text-success fs-5 fw-bold';
    if (btnSubmit) btnSubmit.disabled = false;
  }
}

// ============================================================================
// 3. LOG NO. GENERATOR & DISBURSEMENT SUBMISSION
// ============================================================================

// ออกเลขเอกสาร นผ.2 ด้วย Transaction (รูปแบบ: นผ2MMYYNNNN)
async function generateNextLogNoTransaction() {
  const now = new Date();
  const monthStr = String(now.getMonth() + 1).padStart(2, '0');
  const thaiYearFull = now.getFullYear() + 543;
  const yearStr = String(thaiYearFull).slice(-2);
  const docId = `${yearStr}${monthStr}`;
  
  const logNoRef = doc(db, "log_no", docId);

  return await runTransaction(db, async (transaction) => {
    const logDocSnap = await transaction.get(logNoRef);
    let nextNum = 1;

    if (logDocSnap.exists()) {
      const data = logDocSnap.data();
      nextNum = Number(data.last_number || 0) + 1;
    }

    transaction.set(logNoRef, {
      last_number: nextNum,
      month: monthStr,
      year: yearStr,
      updated_at: serverTimestamp()
    }, { merge: true });

    const paddedSeq = String(nextNum).padStart(4, '0');
    return `นผ2${monthStr}${yearStr}${paddedSeq}`;
  });
}

// ยืนยันขอตัดจ่ายและบันทึกลง Firestore
export async function submitDisbursePlanDoc() {
  if (!currentSelectedActivity) {
    alert('❌ กรุณาเลือกกิจกรรมที่ต้องการตัดจ่ายก่อน');
    return;
  }

  const purchaseType = document.getElementById('mdSelPurchase').value;
  const amount = Number(document.getElementById('mdInpAmount').value);
  const applicant = document.getElementById('mdSelCommittee').value;
  const remark = document.getElementById('mdInpRemark').value;

  if (!amount || amount <= 0) {
    alert('❌ กรุณากรอกจำนวนเงินขอตัดจ่ายให้ถูกต้อง');
    return;
  }
  if (!applicant) {
    alert('❌ กรุณากรอก/เลือก ผู้ขอใช้งบประมาณ');
    return;
  }

  const btnSubmit = document.getElementById('btnSubmitDisburseDoc');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '⏳ กำลังบันทึกข้อมูล...';
  }

  try {
    const projectId = currentSelectedActivity.id || currentSelectedActivity.project_id;
    const planRef = doc(db, "budget_plans", projectId);

    // ดึงข้อมูลล่าสุดจาก Firestore เพื่อความถูกต้องของยอดคงเหลือ
    const planSnap = await getDoc(planRef);
    if (!planSnap.exists()) {
      throw new Error("ไม่พบข้อมูลโครงการในระบบ");
    }

    const currentPlanData = planSnap.data();
    const oldTotal = Number(currentPlanData.total_budget || currentPlanData.budget_set || 0);
    const oldUsed = Number(currentPlanData.used_budget || currentPlanData.budget_used || 0);
    const oldRemain = oldTotal - oldUsed;

    if (oldRemain < amount) {
      throw new Error("ยอดเงินคงเหลือไม่เพียงพอต่อการตัดจ่าย");
    }

    // 1. ออกเลข นผ.2
    const logNo = await generateNextLogNoTransaction();

    const balanceBefore = oldRemain;
    const balanceAfter = balanceBefore - amount;
    const newUsedBudget = oldUsed + amount;
    const newRemainBudget = balanceAfter;

    // 2. บันทึกข้อมูลลง collection log_budget
    const logBudgetRef = doc(db, "log_budget", logNo);
    await setDoc(logBudgetRef, {
      log_no: logNo,
      project_id: projectId,
      activities: currentSelectedActivity.activity_name || '-',
      project_name: currentSelectedActivity.project_name || '-',
      division: currentSelectedActivity.division || '-',
      method: purchaseType,
      buyer: applicant,
      details: remark,
      balance_before: balanceBefore,
      budget_use: amount,
      balance_after: balanceAfter,
      status: "active",
      createdAt: serverTimestamp()
    });

    // 3. อัปเดตยอดคงเหลือใน budget_plans
    await updateDoc(planRef, {
      used_budget: newUsedBudget,
      remaining_budget: newRemainBudget
    });

    // สำเร็จ: ซ่อน Modal ฟอร์ม และแสดง Success Modal
    const modalEl = document.getElementById('disburseModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    document.getElementById('successLogNo').innerText = logNo;
    
    const successModal = new bootstrap.Modal(document.getElementById('disburseSuccessModal'));
    successModal.show();

    // รีเฟรชตารางตามฝ่ายเดิม
    const currentDept = document.getElementById('selectedDeptName').innerText || 'ทั้งหมด';
    filterByDept(currentDept);

  } catch (err) {
    alert('❌ เกิดข้อผิดพลาดในการบันทึก: ' + err.message);
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="bi bi-file-earmark-check-fill me-1"></i> ยืนยันและสร้างเอกสาร';
    }
  }
}

export function resetFormToMain() {
  window.location.href = "index.html";
}

export function resetAndReopenDisburse() {
  const successModal = bootstrap.Modal.getInstance(document.getElementById('disburseSuccessModal'));
  if (successModal) successModal.hide();
  openDisburseModalCurrent();
}

// ============================================================================
// 🚀 DOM READY & INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  populateCommitteesDropdown();
});

// ============================================================================
// 🌐 GLOBAL EXPORTS (ผูกฟังก์ชันให้ HTML เรียกใช้งานได้)
// ============================================================================
window.filterByDept = filterByDept;
window.openDisburseModalById = openDisburseModalById;
window.calculateDisburseBalance = calculateDisburseBalance;
window.submitDisbursePlanDoc = submitDisbursePlanDoc;
window.resetFormToMain = resetFormToMain;
window.resetAndReopenDisburse = resetAndReopenDisburse;