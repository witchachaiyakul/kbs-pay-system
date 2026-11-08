import { db } from "./firestore.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    doc,
    runTransaction,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 GLOBAL VARIABLES & CACHE
// ============================================================================
window.budgetPlansCache = [];
let currentSelectedActivity = null;

// ตัวแปรสำหรับจัดการสภาวะการแก้ไขรายการ (Edit Mode)
let currentEditingLogNo = null;
let originalEditingAmount = 0;
let disburseHistoryCache = [];

// ============================================================================
// 🛠️ HELPER FUNCTIONS
// ============================================================================

function formatThaiDateShort(dateVal) {
  if (!dateVal) return '-';
  
  let d;
  if (typeof dateVal === 'object' && dateVal !== null && typeof dateVal.toDate === 'function') {
    d = dateVal.toDate();
  } else {
    d = new Date(dateVal);
  }

  if (isNaN(d.getTime())) return String(dateVal);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const yearBE = d.getFullYear() + 543;

  return `${day}-${month}-${yearBE}`;
}

// ============================================================================
// 1. DATA FETCHING (COMMITTEES & DIVISION PLANS)
// ============================================================================

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
          <td class="text-center align-middle p-1"> 
            <span class="badge bg-secondary text-wrap" style="max-width: 100%; white-space: normal; line-height: 1.3;"> ${item.fund_type} </span> 
          </td>
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
  
  cancelEditMode();

  const total = Number(item.total_budget || 0);
  const used = Number(item.used_budget || 0);
  const remain = Number(item.remaining_budget || 0);

  document.getElementById('calcTotalBudget').innerText = total.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';
  document.getElementById('calcUsedBudget').innerText = used.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';
  document.getElementById('calcBeforeRemain').innerText = remain.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' ฿';
  
  calculateDisburseBalance();

  loadDisburseHistory(item.id || item.project_id);

  const modalElem = document.getElementById('disburseModal');
  if (modalElem) {
    const modal = bootstrap.Modal.getOrCreateInstance(modalElem);
    modal.show();
  }
}

async function loadDisburseHistory(projectId) {
  const tbody = document.getElementById('mdDisburseHistoryBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="text-center py-3 text-muted">กำลังดึงข้อมูล...</td></tr>';

  try {
    const q = query(collection(db, "log_budget"), where("project_id", "==", String(projectId)));
    const qSnap = await getDocs(q);

    disburseHistoryCache = [];

    if (!qSnap.empty) {
      qSnap.forEach(docSnap => disburseHistoryCache.push(docSnap.data()));

      // เรียงตามเวลาจากล่าสุดไปหาเก่าสุด
      disburseHistoryCache.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
      });

      const html = disburseHistoryCache.map(h => {
        const logNo = h.log_no || h.id || '-';
        const displayDate = formatThaiDateShort(h.createdAt || h.date);
        const method = h.method || h.purchase_type || '-';
        const details = h.details || h.remark || '-';
        const applicant = h.buyer || h.requested_by || h.applicant || '-';
        const amount = Number(h.budget_use || h.amount || 0);

        return `
          <tr class="align-middle">
            <td class="fw-bold text-primary text-nowrap"><i class="bi bi-file-earmark-text me-1"></i>${logNo}</td>
            <td class="small fw-semibold text-nowrap text-center">${displayDate}</td>
            <td class="text-center"><span class="badge bg-secondary">${method}</span></td>
            <td class="small">${details}</td>
            <td class="small">${applicant}</td>
            <td class="text-end fw-bold text-danger text-nowrap">${amount.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td class="text-center">
              <button type="button" class="btn btn-warning btn-sm p-1 px-2 text-dark shadow-sm fw-bold" title="แก้ไขรายการนี้" onclick="editDisburseLog('${logNo}')">
                <i class="bi bi-pencil-square"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.innerHTML = html;
    } else {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-3 text-muted">ยังไม่เคยมีประวัติการตัดจ่ายในกิจกรรมนี้</td></tr>';
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3 text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

// 🎯 ฟังก์ชันดึงรายการเดิมมาแก้ไข + Auto Scroll ลงไปที่ฟอร์มด้านล่าง
export function editDisburseLog(logNo) {
  const item = disburseHistoryCache.find(h => String(h.log_no) === String(logNo));
  if (!item) {
    alert("❌ ไม่พบข้อมูลรายการที่เลือก");
    return;
  }

  currentEditingLogNo = logNo;
  originalEditingAmount = Number(item.budget_use || item.amount || 0);

  // ใส่ค่าเดิมลงในฟอร์ม
  document.getElementById('mdSelPurchase').value = item.method || item.purchase_type || 'ซื้อ';
  document.getElementById('mdInpAmount').value = originalEditingAmount;
  document.getElementById('mdSelCommittee').value = item.buyer || item.requested_by || item.applicant || '';
  document.getElementById('mdInpRemark').value = item.details || item.remark || '';

  // แสดงแถบสภาวะกำลังแก้ไข
  const editNotice = document.getElementById('editModeNotice');
  const editLabel = document.getElementById('editingLogNoLabel');
  const modeTitle = document.getElementById('formModeTitle');
  const btnSubmit = document.getElementById('btnSubmitDisburseDoc');

  if (editNotice) editNotice.classList.remove('d-none');
  if (editLabel) editLabel.innerText = logNo;
  if (modeTitle) {
    modeTitle.innerText = "โหมด: แก้ไขรายการเดิม (" + logNo + ")";
    modeTitle.className = "badge bg-warning text-dark";
  }
  if (btnSubmit) {
    btnSubmit.className = "btn btn-warning px-5 fw-bold shadow text-dark";
    btnSubmit.innerHTML = `<i class="bi bi-save-fill me-1"></i> บันทึกการแก้ไขเอกสาร`;
  }

  calculateDisburseBalance();

  // 🎯 เลื่อนหน้าจอลงไปยังฟอร์มแก้ไขด้านล่างแบบ Smooth
  setTimeout(() => {
    const formTarget = document.getElementById('disburseFormSection');
    if (formTarget) {
      formTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
}

export function cancelEditMode() {
  currentEditingLogNo = null;
  originalEditingAmount = 0;

  const form = document.getElementById('disburseForm');
  if (form) form.reset();

  const editNotice = document.getElementById('editModeNotice');
  const modeTitle = document.getElementById('formModeTitle');
  const btnSubmit = document.getElementById('btnSubmitDisburseDoc');

  if (editNotice) editNotice.classList.add('d-none');
  if (modeTitle) {
    modeTitle.innerText = "โหมด: สร้างรายการใหม่";
    modeTitle.className = "badge bg-success";
  }
  if (btnSubmit) {
    btnSubmit.className = "btn btn-navy px-5 fw-bold shadow";
    btnSubmit.innerHTML = `<i class="bi bi-file-earmark-check-fill me-1"></i> ยืนยันและสร้างเอกสาร`;
  }

  calculateDisburseBalance();
}

export function calculateDisburseBalance() {
  if (!currentSelectedActivity) return;

  const remain = Number(currentSelectedActivity.remaining_budget || 0);
  const reqAmount = Number(document.getElementById('mdInpAmount')?.value || 0);

  const effectiveAmount = currentEditingLogNo ? (reqAmount - originalEditingAmount) : reqAmount;
  const afterRemain = remain - effectiveAmount;

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
// 3. TRANSACTION & DISBURSEMENT SUBMISSION (NEW & EDIT)
// ============================================================================

export async function submitDisbursePlanDoc() {
  if (!currentSelectedActivity) {
    alert('❌ กรุณาเลือกกิจกรรมที่ต้องการตัดจ่ายก่อน');
    return;
  }

  const form = document.getElementById('disburseForm');
  if (form && !form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const purchaseType = document.getElementById('mdSelPurchase').value;
  const amount = Number(document.getElementById('mdInpAmount').value);
  const applicant = document.getElementById('mdSelCommittee').value.trim();
  const remark = document.getElementById('mdInpRemark').value.trim();

  if (!amount || amount <= 0) {
    alert('❌ กรุณากรอกจำนวนเงินขอตัดจ่ายให้ถูกต้อง');
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

    const now = new Date();
    const monthStr = String(now.getMonth() + 1).padStart(2, '0');
    const yearStr = String(now.getFullYear() + 543).slice(-2);
    const logNoDocId = `${yearStr}${monthStr}`;
    const logNoRef = doc(db, "log_no", logNoDocId);

    let logNo = currentEditingLogNo;
    let balanceBefore = 0;
    let balanceAfter = 0;
    let oldTotal = 0;
    let newUsedBudget = 0;
    let newRemainBudget = 0;

    await runTransaction(db, async (transaction) => {
      const planSnap = await transaction.get(planRef);
      if (!planSnap.exists()) {
        throw new Error("ไม่พบข้อมูลโครงการในระบบ");
      }

      const currentPlanData = planSnap.data();
      oldTotal = Number(currentPlanData.total_budget || currentPlanData.budget_set || 0);
      const oldUsed = Number(currentPlanData.used_budget || currentPlanData.budget_used || 0);
      const currentRemain = oldTotal - oldUsed;

      if (currentEditingLogNo) {
        // === กรณีแก้ไขรายการเดิม (EDIT LOG) ===
        const diffAmount = amount - originalEditingAmount;
        if (currentRemain < diffAmount) {
          throw new Error(`ยอดเงินคงเหลือไม่เพียงพอสำหรับการเพิ่มยอดตัดจ่าย (คงเหลือปัจจุบัน: ${currentRemain.toLocaleString()} บาท)`);
        }

        const logBudgetRef = doc(db, "log_budget", currentEditingLogNo);
        const logSnap = await transaction.get(logBudgetRef);
        if (!logSnap.exists()) {
          throw new Error("ไม่พบเอกสารการตัดจ่ายที่ต้องการแก้ไข");
        }

        const logData = logSnap.data();
        balanceBefore = Number(logData.balance_before || currentRemain + originalEditingAmount);
        balanceAfter = balanceBefore - amount;
        newUsedBudget = oldUsed + diffAmount;
        newRemainBudget = oldTotal - newUsedBudget;

        transaction.update(logBudgetRef, {
          method: purchaseType,
          buyer: applicant,
          details: remark,
          budget_use: amount,
          balance_after: balanceAfter,
          updatedAt: serverTimestamp()
        });

      } else {
        // === กรณีสร้างรายการใหม่ (NEW LOG) ===
        if (currentRemain < amount) {
          throw new Error(`ยอดเงินคงเหลือไม่เพียงพอ (คงเหลือปัจจุบัน: ${currentRemain.toLocaleString()} บาท)`);
        }

        const logDocSnap = await transaction.get(logNoRef);
        let nextNum = 1;
        if (logDocSnap.exists()) {
          nextNum = Number(logDocSnap.data().last_number || 0) + 1;
        }
        const paddedSeq = String(nextNum).padStart(4, '0');
        logNo = `นผ2${monthStr}${yearStr}${paddedSeq}`;

        balanceBefore = currentRemain;
        balanceAfter = balanceBefore - amount;
        newUsedBudget = oldUsed + amount;
        newRemainBudget = balanceAfter;

        transaction.set(logNoRef, {
          last_number: nextNum,
          month: monthStr,
          year: yearStr,
          updated_at: serverTimestamp()
        }, { merge: true });

        const logBudgetRef = doc(db, "log_budget", logNo);
        transaction.set(logBudgetRef, {
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
      }

      transaction.update(planRef, {
        used_budget: newUsedBudget,
        remaining_budget: newRemainBudget
      });
    });

    if (currentSelectedActivity) {
      currentSelectedActivity.used_budget = newUsedBudget;
      currentSelectedActivity.remaining_budget = newRemainBudget;
    }

    const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    const formattedDate = `${now.getDate()} ${thaiMonths[now.getMonth()]} พ.ศ. ${now.getFullYear() + 543}`;

    const pdfPayload = {
      action: "generatePDFFromSheet",
      log_no: logNo,
      project_name: currentSelectedActivity.project_name || '-',
      activity_name: currentSelectedActivity.activity_name || '-',
      activities: currentSelectedActivity.activity_name || '-',
      division: currentSelectedActivity.division || '-',
      fund_type: currentSelectedActivity.fund_type || 'รายได้สถานศึกษา',
      responsible_person: currentSelectedActivity.responsible_person || applicant,
      method: purchaseType,
      purchase_type: purchaseType,
      buyer: applicant,
      requested_by: applicant,
      applicant: applicant,
      details: remark,
      remark: remark,
      balance_before: balanceBefore,
      budget_use: amount,
      amount: amount,
      balance_after: balanceAfter,
      total_budget: oldTotal,
      formatted_date: formattedDate,
      date: formattedDate
    };

    let pdfUrl = null;
    const APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwX653dlaUHJmpcq6y-UOYJlDkN7u7UZhGeqRV-egjEtMEDUk1O-EWm6Db7ZbD66HkAxQ/exec";

    if (APPS_SCRIPT_WEB_APP_URL && !APPS_SCRIPT_WEB_APP_URL.includes("YOUR_SCRIPT_ID")) {
      try {
        const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(pdfPayload)
        });

        const resJson = await response.json();
        if (resJson && (resJson.pdfUrl || resJson.status === 'success')) {
          pdfUrl = resJson.pdfUrl;
        }
      } catch (errPdf) {
        console.error("❌ Fetch to GAS failed:", errPdf);
      }
    }

    const btnPdf = document.getElementById('btnOpenPdf');
    if (btnPdf) {
      if (pdfUrl) {
        btnPdf.href = pdfUrl;
        btnPdf.target = "_blank";
        btnPdf.classList.remove('disabled');
        btnPdf.style.pointerEvents = 'auto';
        btnPdf.style.opacity = '1';
      } else {
        btnPdf.href = '#';
        btnPdf.classList.add('disabled');
        btnPdf.style.pointerEvents = 'none';
        btnPdf.style.opacity = '0.5';
      }
    }

    const modalEl = document.getElementById('disburseModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    const isEditMode = Boolean(currentEditingLogNo);
    cancelEditMode();

    document.getElementById('successModalTitle').innerText = isEditMode ? "แก้ไขรายการสำเร็จ!" : "ตัดแผนสำเร็จ!";
    document.getElementById('successLogNo').innerText = logNo;
    
    const successModal = new bootstrap.Modal(document.getElementById('disburseSuccessModal'));
    successModal.show();

    const currentDept = document.getElementById('selectedDeptName').innerText || 'ทั้งหมด';
    filterByDept(currentDept);

  } catch (err) {
    alert('❌ เกิดข้อผิดพลาดในการบันทึก: ' + err.message);
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
    }
  }
}

export function resetFormToMain() {
  window.location.href = "index.html";
}

export function resetAndReopenDisburse() {
  const successModal = bootstrap.Modal.getInstance(document.getElementById('disburseSuccessModal'));
  if (successModal) successModal.hide();

  if (currentSelectedActivity) {
    const projId = currentSelectedActivity.project_id || currentSelectedActivity.id;
    openDisburseModalById(projId);
  }
}

// ============================================================================
// 🚀 DOM READY & INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  populateCommitteesDropdown();
});

// ============================================================================
// 🌐 GLOBAL EXPORTS
// ============================================================================
window.filterByDept = filterByDept;
window.openDisburseModalById = openDisburseModalById;
window.calculateDisburseBalance = calculateDisburseBalance;
window.submitDisbursePlanDoc = submitDisbursePlanDoc;
window.editDisburseLog = editDisburseLog;
window.cancelEditMode = cancelEditMode;
window.resetFormToMain = resetFormToMain;
window.resetAndReopenDisburse = resetAndReopenDisburse;