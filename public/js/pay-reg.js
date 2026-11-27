// js/pay-reg.js
import { db, insertAuditLog } from "./firestore.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 GLOBAL STATE & CACHE
// ============================================================================
let allPayRegCache = [];
let filteredPayRegCache = [];
let fundTypeListCache = [];

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

// ============================================================================
// ⚙️ 1. HELPER FUNCTIONS (DATE พ.ศ., STATUS, DROPDOWNS)
// ============================================================================

function normalizeDocType(typeInput) {
  if (!typeInput) return "po";
  const t = String(typeInput).trim().toLowerCase();
  if (t === "b" || t === "wo" || t.includes("จ้าง")) return "wo";
  if (t === "c" || t === "fpo" || t.includes("น้ำมัน")) return "fpo";
  if (t === "d" || t === "co" || t === "contract" || t.includes("สัญญา")) return "co";
  return "po";
}

function getStatusBadge(status) {
  const s = status || "รอตรวจจ่าย";
  if (s === "ตรวจจ่ายแล้ว") {
    return '<span class="badge bg-success"><i class="bi bi-check-circle-fill me-1"></i>ตรวจจ่ายแล้ว</span>';
  }
  return '<span class="badge bg-warning text-dark"><i class="bi bi-clock-history me-1"></i>รอตรวจจ่าย</span>';
}

function getCurrentUserSession() {
  try {
    const raw = sessionStorage.getItem("kbs_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function formatThaiDateBE(dateInput) {
  if (!dateInput || dateInput === "-") return "-";

  if (typeof dateInput === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateInput.trim())) {
    const [d, m, y] = dateInput.trim().split("/");
    const yr = Number(y) < 2400 ? Number(y) + 543 : Number(y);
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${yr}`;
  }

  let dateObj = null;
  if (typeof dateInput === "object" && typeof dateInput.toDate === "function") {
    dateObj = dateInput.toDate();
  } else if (typeof dateInput === "object" && dateInput.seconds) {
    dateObj = new Date(dateInput.seconds * 1000);
  } else if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const [y, m, d] = dateInput.trim().split("-").map(Number);
    dateObj = new Date(y, m - 1, d);
  } else {
    dateObj = new Date(dateInput);
  }

  if (!dateObj || isNaN(dateObj.getTime())) return String(dateInput);

  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yearBE = dateObj.getFullYear() + 543;
  return `${day}/${month}/${yearBE}`;
}

function parseToJSDate(dateInput) {
  if (!dateInput || dateInput === "-") return new Date();

  if (typeof dateInput === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateInput.trim())) {
    const [d, m, y] = dateInput.trim().split("/").map(Number);
    const yearAD = y > 2400 ? y - 543 : y;
    return new Date(yearAD, m - 1, d);
  }

  if (typeof dateInput === "object" && typeof dateInput.toDate === "function") {
    return dateInput.toDate();
  }
  if (typeof dateInput === "object" && dateInput.seconds) {
    return new Date(dateInput.seconds * 1000);
  }
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const [y, m, d] = dateInput.trim().split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  const parsed = new Date(dateInput);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function updateCalendarYearToBE(instance) {
  if (!instance || !instance.calendarContainer) return;
  const yearInputs = instance.calendarContainer.querySelectorAll(".cur-year");
  yearInputs.forEach((inp) => {
    const adYear = Number(instance.currentYear);
    if (adYear && adYear < 2400) {
      inp.value = adYear + 543;
    }
  });
}

function initThaiCalendarPicker(inputId, defaultDateInput) {
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;

  const initialDate = parseToJSDate(defaultDateInput);

  if (inputEl._flatpickr) {
    inputEl._flatpickr.setDate(initialDate, true);
    updateCalendarYearToBE(inputEl._flatpickr);
    return;
  }

  if (typeof flatpickr !== "undefined") {
    flatpickr(inputEl, {
      locale: "th",
      defaultDate: initialDate,
      dateFormat: "d/m/Y",
      disableMobile: true,
      formatDate: (date) => {
        const d = String(date.getDate()).padStart(2, "0");
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const yBE = date.getFullYear() + 543;
        return `${d}/${m}/${yBE}`;
      },
      onReady: (_, __, instance) => updateCalendarYearToBE(instance),
      onOpen: (_, __, instance) => updateCalendarYearToBE(instance),
      onMonthChange: (_, __, instance) => updateCalendarYearToBE(instance),
      onYearChange: (_, __, instance) => updateCalendarYearToBE(instance)
    });
  } else {
    inputEl.value = formatThaiDateBE(initialDate);
  }
}

// ============================================================================
// 🔢 2. AUTO-GENERATE VOUCHER NUMBER (บค.1/69, บจ.2/69)
// ============================================================================

function parseVoucherSequence(voucherStr, type, shortYear) {
  if (!voucherStr) return 0;
  const prefix = type === "bk" ? "บค\\." : "บจ\\.";
  const regex = new RegExp(`^${prefix}\\s*(\\d+)\\/${shortYear}$`);
  const match = String(voucherStr).trim().match(regex);
  return match ? Number(match[1]) : 0;
}

export async function generateNextVoucherNo(type, fiscalYearBE) {
  const cleanYear = String(fiscalYearBE || "2569").trim();
  const shortYear = cleanYear.slice(-2);
  const prefixLabel = type === "bk" ? "บค." : "บจ.";
  const counterDocId = `${type}_${cleanYear}`;

  let maxNo = 0;

  // 1. ตรวจสอบเลขล่าสุดจาก collection 'voucher_counters'
  try {
    const counterSnap = await getDoc(doc(db, "voucher_counters", counterDocId));
    if (counterSnap.exists()) {
      maxNo = Math.max(maxNo, Number(counterSnap.data().last_no || 0));
    }
  } catch (err) {
    console.warn("⚠️ อ่าน voucher_counters ไม่สำเร็จ:", err);
  }

  // 2. ตรวจสอบเลขสูงสุดที่มีอยู่จริงใน log_budget เพื่อป้องกันเลขซ้ำ
  allPayRegCache.forEach((item) => {
    const fieldVal = type === "bk" ? item.bk_no : item.bj_no;
    const seq = parseVoucherSequence(fieldVal, type, shortYear);
    if (seq > maxNo) maxNo = seq;
  });

  const nextNo = maxNo + 1;
  return {
    formatted: `${prefixLabel}${nextNo}/${shortYear}`,
    seqNo: nextNo,
    shortYear,
    prefixLabel
  };
}

export async function handleVoucherOptionChange(prefix) {
  const selectedRadio = document.querySelector(`input[name="${prefix}_voucher_type"]:checked`);
  const fiscalYear = document.getElementById(`${prefix}_fiscal_year`)?.value || "2569";
  const badge = document.getElementById(`${prefix}_voucher_prefix_badge`);
  const input = document.getElementById(`${prefix}_voucher_no`);

  if (!selectedRadio || !input) return;

  const type = selectedRadio.value; // 'bk' หรือ 'bj'
  if (badge) badge.textContent = type === "bk" ? "บค." : "บจ.";

  input.value = "กำลังออกเลข...";
  const result = await generateNextVoucherNo(type, fiscalYear);
  input.value = result.formatted;
}

async function updateVoucherCounterAfterSave(type, fiscalYearBE, voucherStr) {
  if (!type || !voucherStr) return;
  const cleanYear = String(fiscalYearBE || "2569").trim();
  const shortYear = cleanYear.slice(-2);
  const seq = parseVoucherSequence(voucherStr, type, shortYear);
  if (seq <= 0) return;

  const counterDocId = `${type}_${cleanYear}`;
  const counterRef = doc(db, "voucher_counters", counterDocId);
  const counterSnap = await getDoc(counterRef);
  const currentLast = counterSnap.exists() ? Number(counterSnap.data().last_no || 0) : 0;

  if (seq > currentLast) {
    await setDoc(
      counterRef,
      {
        voucher_type: type,
        prefix: type === "bk" ? "บค." : "บจ.",
        year_be: Number(cleanYear),
        short_year: shortYear,
        last_no: seq,
        updated_at: serverTimestamp()
      },
      { merge: true }
    );
  }
}

// ============================================================================
// 💰 3. REFUND CALCULATION & NOTIFY RESPONSIBLE PERSON
// ============================================================================

export function toggleRefundSection(prefix) {
  const mode = document.querySelector(`input[name="${prefix}_amount_check"]:checked`)?.value || "ok";
  const box = document.getElementById(`${prefix}_refund_box`);
  const refundInput = document.getElementById(`${prefix}_refund_amount`);

  if (!box) return;
  if (mode === "refund") {
    box.classList.remove("d-none");
  } else {
    box.classList.add("d-none");
    if (refundInput) refundInput.value = "";
  }
  calculateRefundSummary(prefix);
}

export function calculateRefundSummary(prefix) {
  const planAmount = Number(document.getElementById(`${prefix}_budget_use`)?.value || 0);
  const mode = document.querySelector(`input[name="${prefix}_amount_check"]:checked`)?.value || "ok";
  const refundAmount = mode === "refund" ? Number(document.getElementById(`${prefix}_refund_amount`)?.value || 0) : 0;
  const netPaid = Math.max(0, planAmount - refundAmount);

  const planEl = document.getElementById(`${prefix}_summary_plan`);
  const refundEl = document.getElementById(`${prefix}_summary_refund`);
  const netEl = document.getElementById(`${prefix}_summary_net`);

  if (planEl) planEl.textContent = `${planAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`;
  if (refundEl) refundEl.textContent = `${refundAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`;
  if (netEl) netEl.textContent = `${netPaid.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`;
}


// ============================================================================
// 🎯 4. ดึงข้อมูลจาก FIRESTORE (fund_type และ log_budget)
// ============================================================================

export async function loadFundTypes() {
  try {
    const snap = await getDocs(collection(db, "fund_type"));
    const list = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      list.push({
        id: docSnap.id,
        name: d.name || "",
        prefix: d.prefix || "",
        order: Number(d.order) || 99
      });
    });
    list.sort((a, b) => a.order - b.order);
    fundTypeListCache = list;

    ["add_fund_type", "edit_fund_type"].forEach((selectId) => {
      const el = document.getElementById(selectId);
      if (!el) return;
      el.innerHTML = '<option value="">--- เลือกประเภทเงิน ---</option>';
      list.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.name;
        opt.dataset.prefix = f.prefix;
        opt.textContent = f.prefix ? `${f.name} (${f.prefix})` : f.name;
        el.appendChild(opt);
      });
    });
  } catch (err) {
    console.warn("⚠️ โหลดประเภทเงิน (fund_type) ไม่สำเร็จ:", err);
  }
}

function selectFundTypeValue(selectId, rawVal) {
  const el = document.getElementById(selectId);
  if (!el) return;
  if (!rawVal) {
    el.value = "";
    return;
  }

  const cleanVal = String(rawVal).trim();
  const matched = fundTypeListCache.find(
    (f) => f.name === cleanVal || f.prefix === cleanVal || `${f.name} (${f.prefix})` === cleanVal
  );

  if (matched) {
    el.value = matched.name;
  } else {
    const opt = document.createElement("option");
    opt.value = cleanVal;
    opt.textContent = cleanVal;
    el.appendChild(opt);
    el.value = cleanVal;
  }
}

export async function getPayRegFromFirestore() {
  try {
    const [budgetSnap, paySnap] = await Promise.all([
      getDocs(collection(db, "log_budget")),
      getDocs(collection(db, "log_pay"))
    ]);

    const payMap = {};
    paySnap.forEach((docSnap) => {
      const d = docSnap.data();
      const key = String(d.log_no || d.LOG_NO || docSnap.id).trim();
      payMap[key] = { id: docSnap.id, ...d };
    });

    const list = [];

    budgetSnap.forEach((docSnap) => {
      const b = docSnap.data();
      const logNo = String(b.log_no || b.LOG_NO || b.logNo || docSnap.id).trim();
      const p = payMap[logNo] || {};

      list.push({
        id: docSnap.id,
        log_no: logNo,
        division: b.division || b.ฝ่าย || p.division || "",
        project: b.project_name || b.project || b.โครงการ || p.project || "",
        activities: b.activities || b.กิจกรรม || p.activities || "",
        details: b.details || b.รายละเอียด || b.objective || p.details || p.objective || "",
        fund_type: b.fund_type || b.budget_type || b.ประเภทเงิน || p.fund_type || "",
        budget_use: p.budget_use || p.total || b.budget_use || b.request || b.amount || 0,
        actual_paid_amount: b.actual_paid_amount ?? null,
        refund_amount: Number(b.refund_amount || 0),
        payment_check_status: b.payment_check_status || "ok",
        responsible_person: b.buyer || b.responsible_person || b.requested_by || "-",
        doc_type: p.doc_type || b.doc_type || "",
        paid_date: b.paid_date || p.paid_date || "",
        bk_no: b.bk_no || p.bk_no || "",
        bj_no: b.bj_no || p.bj_no || "",
        fiscal_year: b.fiscal_year || "2569",
        remark: b.remark || p.remark || "",
        reg_status: b.reg_status || p.reg_status || "รอตรวจจ่าย"
      });
    });

    allPayRegCache = list;
    return list;
  } catch (err) {
    console.error("❌ Error getPayRegFromFirestore:", err);
    return [];
  }
}

// ============================================================================
// 🖥️ 5. RENDER ตารางและสรุปยอด
// ============================================================================

export function renderPayRegTable() {
  const tbody = document.getElementById("payRegTableBody");
  if (!tbody) return;

  const docTypeVal = document.getElementById("filterDocType")?.value || "all";
  const divisionVal = document.getElementById("filterDivision")?.value || "all";
  const statusVal = document.getElementById("filterStatus")?.value || "all";
  const searchVal = (document.getElementById("filterSearch")?.value || "").trim().toLowerCase();

  const filtered = allPayRegCache.filter((item) => {
    if (!item) return false;

    if (docTypeVal !== "all" && normalizeDocType(item.doc_type) !== docTypeVal) return false;
    if (divisionVal !== "all" && (item.division || "") !== divisionVal) return false;

    const itemStatus = item.reg_status || "รอตรวจจ่าย";
    if (statusVal !== "all" && itemStatus !== statusVal) return false;

if (searchVal) {
  const haystack = [
    item.log_no,
    item.id,
    item.bk_no,
    item.bj_no,
    item.details,
    item.project,
    item.fund_type,
    item.remark
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!haystack.includes(searchVal)) return false;
}

    return true;
  });

  filtered.sort((a, b) => {
    const logA = String(a.log_no || a.id || "");
    const logB = String(b.log_no || b.id || "");
    return logB.localeCompare(logA, undefined, { numeric: true });
  });

  filteredPayRegCache = filtered;
  updateSummaryCards(filtered);

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="py-4 text-muted">
          <i class="bi bi-inbox fs-2 d-block mb-2"></i>ไม่พบรายการทะเบียนคุมหลักฐานการจ่ายตามเงื่อนไขที่เลือก
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((item, idx) => {
      const docId = item.id;
      const logNo = item.log_no || item.id || "-";
      const paidDate = formatThaiDateBE(item.paid_date);
      const bkNo = item.bk_no || "-";
      const bjNo = item.bj_no || "-";
      const details = item.details || "-";
      const fundType = item.fund_type || "-";
      const amount = Number(String(item.budget_use || 0).replace(/,/g, "")) || 0;
      const remark = item.remark || "-";
      const status = item.reg_status || "รอตรวจจ่าย";

      const refundBadge =
        item.payment_check_status === "refund" && item.refund_amount > 0
          ? `<div class="text-danger" style="font-size:11px;">(คืนเงิน ${Number(item.refund_amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })})</div>`
          : "";

      return `
        <tr>
          <td class="small text-muted">${idx + 1}</td>
          <td class="fw-bold text-primary text-nowrap">${logNo}</td>
          <td class="small text-nowrap">${paidDate}</td>
          <td class="small fw-semibold text-nowrap">${bkNo}</td>
          <td class="small fw-semibold text-nowrap">${bjNo}</td>
          <td class="text-start small text-wrap text-break" style="max-width: 260px;">${details}</td>
          <td class="small text-nowrap">${fundType}</td>
          <td class="text-end fw-bold text-dark text-nowrap">
            ${amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            ${refundBadge}
          </td>
          <td class="text-start small text-wrap text-break" style="max-width: 160px;">${remark}</td>
          <td class="text-nowrap">${getStatusBadge(status)}</td>
          <td class="text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-primary me-1" onclick="openEditPayRegModal('${docId}')" title="ตรวจสอบ/ออกเลขใบสำคัญ">
              <i class="bi bi-pencil-square"></i>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function updateSummaryCards(list) {
  const amountElem = document.getElementById("sumTotalAmount");
  const statusElem = document.getElementById("sumStatusCount");

  let totalAmount = 0;
  let completedCount = 0;
  let pendingCount = 0;

  list.forEach((item) => {
    const val = Number(String(item.budget_use || 0).replace(/,/g, "")) || 0;
    totalAmount += val;

    const st = item.reg_status || "รอตรวจจ่าย";
    if (st === "ตรวจจ่ายแล้ว") completedCount++;
    else pendingCount++;
  });

  if (amountElem) amountElem.textContent = `${totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`;
  if (statusElem) statusElem.textContent = `${completedCount} / ${pendingCount}`;
}

export function clearFilters() {
  const docType = document.getElementById("filterDocType");
  const division = document.getElementById("filterDivision");
  const status = document.getElementById("filterStatus");
  const search = document.getElementById("filterSearch");

  if (docType) docType.value = "all";
  if (division) division.value = "all";
  if (status) status.value = "รอตรวจจ่าย";
  if (search) search.value = "";
  renderPayRegTable();
}

// ============================================================================
// ➕ 6. ADD NEW PAY REGISTER RECORD
// ============================================================================

export function openAddPayRegModal() {
  const form = document.getElementById("addPayRegForm");
  if (form) form.reset();

  initThaiCalendarPicker("add_paid_date", new Date());
  document.getElementById("add_fiscal_year").value = "2569";
  document.getElementById("add_voucher_prefix_badge").textContent = "เลขที่";
  toggleRefundSection("add");

  const modalElem = document.getElementById("addPayRegModal");
  if (modalElem) {
    bootstrap.Modal.getOrCreateInstance(modalElem).show();
  }
}

export async function saveNewPayReg() {
  const btn = document.getElementById("btnSaveAddPayReg");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "⏳ กำลังบันทึก...";
  }

  try {
    const logNo = document.getElementById("add_log_no").value.trim();
    const paidDateBE = formatThaiDateBE(document.getElementById("add_paid_date").value);
    const voucherType = document.querySelector('input[name="add_voucher_type"]:checked')?.value || "";
    const fiscalYear = document.getElementById("add_fiscal_year").value.trim() || "2569";
    const voucherNo = document.getElementById("add_voucher_no").value.trim();
    const details = document.getElementById("add_details").value.trim();
    const fundType = document.getElementById("add_fund_type").value;
    const budgetUse = Number(document.getElementById("add_budget_use").value || 0);
    const checkMode = document.querySelector('input[name="add_amount_check"]:checked')?.value || "ok";
    const refundAmount = checkMode === "refund" ? Number(document.getElementById("add_refund_amount").value || 0) : 0;
    const actualPaid = Math.max(0, budgetUse - refundAmount);
    const remark = document.getElementById("add_remark").value.trim();

    if (!logNo || !voucherType || !voucherNo || !details || !fundType || budgetUse <= 0) {
      Swal.fire({
        icon: "warning",
        title: "ข้อมูลไม่ครบถ้วน",
        text: "กรุณากรอกเลขคุม นผ.2, เลือกประเภทใบสำคัญคู่จ่าย (บ.ค./บจ.), รายการจ่าย, ประเภทเงิน และจำนวนเงิน",
        confirmButtonColor: "#0f172a"
      });
      return;
    }

    const safeDocId = logNo.replace(/[\/\\#?]/g, "_");
    const record = {
      log_no: logNo,
      LOG_NO: logNo,
      paid_date: paidDateBE,
      fiscal_year: fiscalYear,
      voucher_type: voucherType,
      bk_no: voucherType === "bk" ? voucherNo : "",
      bj_no: voucherType === "bj" ? voucherNo : "",
      details: details,
      objective: details,
      fund_type: fundType,
      budget_use: budgetUse,
      payment_check_status: checkMode,
      refund_amount: refundAmount,
      actual_paid_amount: actualPaid,
      reg_status: "ตรวจจ่ายแล้ว",
      remark: remark,
      updated_at: new Date().toISOString()
    };

    await setDoc(doc(db, "log_budget", safeDocId), record, { merge: true });
    await updateVoucherCounterAfterSave(voucherType, fiscalYear, voucherNo);
    await insertAuditLog("ADD_PAY_REG", `บันทึกตรวจจ่าย ${logNo} เลขที่ ${voucherNo}`, getCurrentUserSession());

    Swal.fire({
      icon: "success",
      title: "บันทึกสำเร็จ!",
      text: `ออกเลข ${voucherNo} และเปลี่ยนสถานะเป็น "ตรวจจ่ายแล้ว" เรียบร้อย`,
      timer: 1800,
      showConfirmButton: false
    });

    bootstrap.Modal.getInstance(document.getElementById("addPayRegModal"))?.hide();
    await refreshPayRegData();
  } catch (err) {
    Swal.fire({ icon: "error", title: "เกิดข้อผิดพลาด", text: err.message, confirmButtonColor: "#0f172a" });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i> ยืนยันและบันทึกทะเบียนคุม';
    }
  }
}

// ============================================================================
// ✏️ 7. EDIT, UPDATE & DELETE PAY REGISTER RECORD
// ============================================================================

export function openEditPayRegModal(docId) {
  const item = allPayRegCache.find((i) => String(i.id) === String(docId));
  if (!item) {
    Swal.fire({ icon: "error", title: "ไม่พบข้อมูลรายการนี้" });
    return;
  }

  initThaiCalendarPicker("edit_paid_date", item.paid_date || new Date());

  document.getElementById("edit_doc_id").value = item.id;
  document.getElementById("edit_log_no").value = item.log_no || item.id || "";
  document.getElementById("edit_fiscal_year").value = item.fiscal_year || "2569";

  // ตั้งค่าประเภทใบสำคัญคู่จ่าย (บ.ค. / บจ.) หากเคยออกเลขไว้แล้ว
  document.getElementById("edit_type_bk").checked = false;
  document.getElementById("edit_type_bj").checked = false;
  if (item.bk_no) {
    document.getElementById("edit_type_bk").checked = true;
    document.getElementById("edit_voucher_prefix_badge").textContent = "บค.";
    document.getElementById("edit_voucher_no").value = item.bk_no;
  } else if (item.bj_no) {
    document.getElementById("edit_type_bj").checked = true;
    document.getElementById("edit_voucher_prefix_badge").textContent = "บจ.";
    document.getElementById("edit_voucher_no").value = item.bj_no;
  } else {
    document.getElementById("edit_voucher_prefix_badge").textContent = "เลขที่";
    document.getElementById("edit_voucher_no").value = "";
  }

  document.getElementById("edit_details").value = item.details || "";
  selectFundTypeValue("edit_fund_type", item.fund_type);
  document.getElementById("edit_budget_use").value = Number(String(item.budget_use || 0).replace(/,/g, "")) || 0;

  // ตั้งค่าการตรวจสอบยอดเงิน (ถูกต้อง / คืนเงิน)
  if (item.payment_check_status === "refund") {
    document.getElementById("edit_amt_refund").checked = true;
    document.getElementById("edit_refund_amount").value = Number(item.refund_amount || 0);
  } else {
    document.getElementById("edit_amt_ok").checked = true;
    document.getElementById("edit_refund_amount").value = "";
  }
  toggleRefundSection("edit");

  document.getElementById("edit_remark").value = item.remark || "";

  const modalElem = document.getElementById("editPayRegModal");
  if (modalElem) {
    bootstrap.Modal.getOrCreateInstance(modalElem).show();
  }
}

export async function updatePayRegData() {
  const docId = document.getElementById("edit_doc_id").value;
  if (!docId) return;

  const btn = document.getElementById("btnUpdatePayReg");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "⏳ กำลังบันทึก...";
  }

  try {
    const paidDateBE = formatThaiDateBE(document.getElementById("edit_paid_date").value);
    const voucherType = document.querySelector('input[name="edit_voucher_type"]:checked')?.value || "";
    const fiscalYear = document.getElementById("edit_fiscal_year").value.trim() || "2569";
    const voucherNo = document.getElementById("edit_voucher_no").value.trim();
    const details = document.getElementById("edit_details").value.trim();
    const fundType = document.getElementById("edit_fund_type").value;
    const budgetUse = Number(document.getElementById("edit_budget_use").value || 0);
    const checkMode = document.querySelector('input[name="edit_amount_check"]:checked')?.value || "ok";
    const refundAmount = checkMode === "refund" ? Number(document.getElementById("edit_refund_amount").value || 0) : 0;
    const actualPaid = Math.max(0, budgetUse - refundAmount);
    const remark = document.getElementById("edit_remark").value.trim();

    if (!voucherType || !voucherNo) {
      Swal.fire({
        icon: "warning",
        title: "กรุณาเลือกประเภทใบสำคัญคู่จ่าย",
        text: "กรุณาติ๊กเลือก บ.ค. หรือ บจ. เพื่อออกเลขใบสำคัญคู่จ่ายก่อนยืนยัน",
        confirmButtonColor: "#0f172a"
      });
      return;
    }

    const updatedData = {
      paid_date: paidDateBE,
      fiscal_year: fiscalYear,
      voucher_type: voucherType,
      bk_no: voucherType === "bk" ? voucherNo : "",
      bj_no: voucherType === "bj" ? voucherNo : "",
      details: details,
      objective: details,
      fund_type: fundType,
      budget_use: budgetUse,
      payment_check_status: checkMode,
      refund_amount: refundAmount,
      actual_paid_amount: actualPaid,
      reg_status: "ตรวจจ่ายแล้ว", // เปลี่ยนสถานะเป็นตรวจจ่ายแล้วอัตโนมัติเมื่อกดยืนยัน
      remark: remark,
      updated_at: new Date().toISOString()
    };

    await setDoc(doc(db, "log_budget", docId), updatedData, { merge: true });
    await updateVoucherCounterAfterSave(voucherType, fiscalYear, voucherNo);

    const payRef = doc(db, "log_pay", docId);
    const paySnap = await getDoc(payRef);
    if (paySnap.exists()) {
      await updateDoc(payRef, updatedData);
    }

    await insertAuditLog("UPDATE_PAY_REG", `ตรวจจ่าย ${docId} ออกเลข ${voucherNo} สถานะ: ตรวจจ่ายแล้ว`, getCurrentUserSession());

    Swal.fire({
      icon: "success",
      title: "ยืนยันตรวจจ่ายสำเร็จ!",
      text: `บันทึกเลข ${voucherNo} และอัปเดตสถานะเป็น "ตรวจจ่ายแล้ว"`,
      timer: 1600,
      showConfirmButton: false
    });

    bootstrap.Modal.getInstance(document.getElementById("editPayRegModal"))?.hide();
    await refreshPayRegData();
  } catch (err) {
    Swal.fire({ icon: "error", title: "เกิดข้อผิดพลาดในการแก้ไข", text: err.message, confirmButtonColor: "#0f172a" });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i> ยืนยันตรวจจ่ายและบันทึก';
    }
  }
}

// ============================================================================
// 📤 8. EXPORT CSV (EXCEL) & NAVIGATION
// ============================================================================

export function exportPayRegToCSV() {
  if (filteredPayRegCache.length === 0) {
    Swal.fire({ icon: "info", title: "ไม่มีข้อมูลสำหรับส่งออก" });
    return;
  }

  const headers = [
    "ลำดับ",
    "เลขคุม นผ.2",
    "วัน เดือน ปี จ่าย",
    "ใบสำคัญคู่จ่าย (บ.ค.)",
    "ใบสำคัญคู่จ่าย (บจ.)",
    "รายการจ่าย",
    "ประเภทเงิน",
    "จำนวนเงินตาม นผ.2 (บาท)",
    "เงินคืน (บาท)",
    "จ่ายจริงสุทธิ (บาท)",
    "หมายเหตุ",
    "สถานะ"
  ];

  const rows = filteredPayRegCache.map((item, idx) => {
    const amount = Number(String(item.budget_use || 0).replace(/,/g, "")) || 0;
    const refund = Number(item.refund_amount || 0);
    const net = Math.max(0, amount - refund);
    const dateStr = formatThaiDateBE(item.paid_date);

    return [
      idx + 1,
      item.log_no || item.id || "",
      dateStr === "-" ? "" : dateStr,
      item.bk_no || "",
      item.bj_no || "",
      item.details || "",
      item.fund_type || "",
      amount.toFixed(2),
      refund.toFixed(2),
      net.toFixed(2),
      item.remark || "",
      item.reg_status || "รอตรวจจ่าย"
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ทะเบียนคุมหลักฐานการจ่าย_${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function refreshPayRegData() {
  await getPayRegFromFirestore();
  renderPayRegTable();
}

export function resetFormToMain() {
  window.location.href = "index.html";
}

// ============================================================================
// 🚀 DOM READY & WINDOW EXPORTS
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadFundTypes(), getPayRegFromFirestore()]);
  renderPayRegTable();
});

window.renderPayRegTable = renderPayRegTable;
window.clearFilters = clearFilters;
window.openAddPayRegModal = openAddPayRegModal;
window.saveNewPayReg = saveNewPayReg;
window.openEditPayRegModal = openEditPayRegModal;
window.updatePayRegData = updatePayRegData;
window.exportPayRegToCSV = exportPayRegToCSV;
window.resetFormToMain = resetFormToMain;
window.handleVoucherOptionChange = handleVoucherOptionChange;
window.toggleRefundSection = toggleRefundSection;
window.calculateRefundSummary = calculateRefundSummary;