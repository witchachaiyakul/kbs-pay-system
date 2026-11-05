// public/js/parcel.js
import { db } from "./firestore.js";
import { 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    setDoc, 
    updateDoc, 
    query, 
    limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 PARCEL MANAGEMENT GLOBAL STATE & CACHE
// ============================================================================
let allParcelsCache = []; // เก็บรายการพัสดุที่แตกแถว (Expanded Units)

// ============================================================================
// 🔍 1. ดึงข้อมูลจาก log_pay เพื่อนำไปบริหารพัสดุ (Backend)
// ============================================================================
export async function getLogPayForParcels(logNo) {
  try {
    if (logNo && logNo.trim() !== '') {
      const cleanLogNo = logNo.trim();
      const docRef = doc(db, "log_pay", cleanLogNo);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return { success: true, data: [{ id: docSnap.id, ...docSnap.data() }] };
      }
      return { success: false, message: `ไม่พบข้อมูล log_no: ${cleanLogNo}` };
    } else {
      const q = query(collection(db, "log_pay"), limit(50));
      const querySnap = await getDocs(q);
      const list = [];

      querySnap.forEach(d => {
        list.push({ id: d.id, ...d.data() });
      });

      return { success: true, data: list };
    }
  } catch (err) {
    console.error("❌ Error getLogPayForParcels:", err);
    return { success: false, message: err.message };
  }
}

// ============================================================================
// 🏷️ 2. ออกเลขพัสดุอัตโนมัติ (Backend)
// ============================================================================
export async function generateParcelNumbersBackend(uids, fundType, yearBE) {
  try {
    if (!uids || !Array.isArray(uids) || uids.length === 0) {
      return { success: false, message: 'ไม่ได้เลือกรายการพัสดุ' };
    }

    const counterDocId = `parcel_counter_${fundType}_${yearBE}`;
    const counterRef = doc(db, "counters", counterDocId);
    const counterSnap = await getDoc(counterRef);
    let currentSeq = 0;

    if (counterSnap.exists()) {
      currentSeq = Number(counterSnap.data().seq) || 0;
    }

    for (const uid of uids) {
      currentSeq++;
      const formattedSeq = String(currentSeq).padStart(4, '0');
      const generatedParcelNo = `${fundType}/${formattedSeq}/${yearBE}`;
      const logNo = uid.split('_')[0];

      const parcelData = {
        uid: uid,
        log_no_ref: logNo,
        parcel_no: generatedParcelNo,
        status: 'registered',
        fund_type: fundType,
        year_be: yearBE,
        created_at: new Date().toISOString()
      };

      const parcelRef = doc(db, "log_parcels", uid);
      await setDoc(parcelRef, parcelData, { merge: true });
    }

    await setDoc(counterRef, { seq: currentSeq, updated_at: new Date().toISOString() }, { merge: true });

    return { success: true, message: 'ออกเลขพัสดุสำเร็จ' };
  } catch (err) {
    console.error("❌ Error generateParcelNumbersBackend:", err);
    return { success: false, message: err.message };
  }
}

// ============================================================================
// 📤 3. บันทึกการเบิกจ่ายพัสดุ (Backend)
// ============================================================================
export async function issueParcelsBackend(uids, recipient, issueDate) {
  try {
    if (!uids || !Array.isArray(uids) || uids.length === 0) {
      return { success: false, message: 'ไม่ได้เลือกรายการพัสดุที่ต้องการเบิก' };
    }

    const targetDate = issueDate || new Date().toISOString().split('T')[0];

    for (const uid of uids) {
      const issueData = {
        status: 'issued',
        issued_to: recipient,
        issued_date: targetDate,
        updated_at: new Date().toISOString()
      };

      const parcelRef = doc(db, "log_parcels", uid);
      await updateDoc(parcelRef, issueData);
    }

    return { success: true, message: 'บันทึกการเบิกจ่ายเรียบร้อย' };
  } catch (err) {
    console.error("❌ Error issueParcelsBackend:", err);
    return { success: false, message: err.message };
  }
}

// ============================================================================
// 🖥️ 4. FRONTEND UI & DATA LOADING
// ============================================================================

/**
 * 🔄 โหลดข้อมูลพัสดุจาก log_pay และผูกสถานะเดิมจาก log_parcels
 */
export async function loadParcelDataFromLogPay(isRefresh = false) {
  const tbody = document.getElementById("parcelTableBody");
  const searchLogNo = document.getElementById("parcelSearchLogNo")?.value || "";

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center py-4 text-muted">
          <div class="spinner-border spinner-border-sm text-primary me-2"></div> กำลังดึงและประมวลผลรายการพัสดุ...
        </td>
      </tr>
    `;
  }

  try {
    // 1. ดึงข้อมูล log_pay
    const logPayRes = await getLogPayForParcels(searchLogNo);
    if (!logPayRes.success || !logPayRes.data || logPayRes.data.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">ไม่พบข้อมูลเอกสาร นผ.2</td></tr>`;
      allParcelsCache = [];
      updateSelectionCounts();
      return;
    }

    // 2. ดึงข้อมูลสถานะเลขพัสดุที่เคยออกไว้จาก log_parcels
    const parcelMap = {};
    const parcelSnap = await getDocs(collection(db, "log_parcels"));
    parcelSnap.forEach(d => {
      parcelMap[d.id] = d.data();
    });

    const expandedList = [];
    const recipientOptions = new Set();

    // 3. วนลูปแตกรายการพัสดุตามจำนวนชิ้น (Expanded Parcels)
    logPayRes.data.forEach(payDoc => {
      const logNo = payDoc.log_no || payDoc.id;
      const division = payDoc.division || '-';
      const crDate = payDoc.cr_date || payDoc.date || '-';

      if (payDoc.buyer) recipientOptions.add(payDoc.buyer);
      if (Array.isArray(payDoc.committee)) {
        payDoc.committee.forEach(c => {
          if (c.name) recipientOptions.add(c.name);
        });
      }

      // ดึงรายการสิ่งของ
      let items = [];
      if (Array.isArray(payDoc.equipmentItems) && payDoc.equipmentItems.length > 0) {
        items = payDoc.equipmentItems;
      } else {
        for (let i = 1; i <= 50; i++) {
          if (payDoc[`list${i}`]) {
            items.push({
              list: payDoc[`list${i}`],
              qu: payDoc[`qu${i}`] || 1,
              pr: payDoc[`pr${i}`] || 0,
              un: payDoc[`un${i}`] || 'หน่วย'
            });
          }
        }
      }

      // Fallback ถ้าไม่มีรายการแยกย่อย
      if (items.length === 0) {
        items.push({
          list: payDoc.details || payDoc.activities || 'พัสดุจัดซื้อ',
          qu: payDoc.quantity || 1,
          pr: payDoc.budget_use || payDoc.total || 0,
          un: 'รายการ'
        });
      }

      // แตกรายการตามจำนวนชิ้น
      items.forEach((item, itemIdx) => {
        const qty = parseInt(item.qu, 10) || 1;
        const itemName = item.list || 'พัสดุ';
        const price = parseFloat(item.pr) || 0;
        const unit = item.un || 'หน่วย';

        for (let u = 1; u <= qty; u++) {
          const uid = `${logNo}_item${itemIdx + 1}_unit${u}`;
          const existing = parcelMap[uid] || {};

          expandedList.push({
            uid: uid,
            log_no: logNo,
            division: division,
            cr_date: crDate,
            item_name: itemName,
            unit_index: `${u}/${qty}`,
            unit_price: price,
            unit_name: unit,
            parcel_no: existing.parcel_no || '-',
            status: existing.status || 'pending',
            issued_to: existing.issued_to || '',
            issued_date: existing.issued_date || ''
          });
        }
      });
    });

    allParcelsCache = expandedList;

    // เติมรายชื่อผู้รับเบิกใน Modal
    populateRecipientOptions(Array.from(recipientOptions));

    // แสดงผลในตาราง
    filterParcelTable();

  } catch (err) {
    console.error("❌ Error loadParcelDataFromLogPay:", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

function populateRecipientOptions(options) {
  const select = document.getElementById("issueRecipientSelect");
  if (!select) return;

  select.innerHTML = `<option value="">-- เลือกจากรายชื่อผู้เกี่ยวข้อง --</option>`;
  options.forEach(opt => {
    if (opt && opt.trim()) {
      const el = document.createElement("option");
      el.value = opt.trim();
      el.textContent = opt.trim();
      select.appendChild(el);
    }
  });
}

// ============================================================================
// 🎯 5. FILTERING & TABLE RENDER
// ============================================================================

export function filterParcelTable() {
  const divFilter = document.getElementById("parcelFilterDivision")?.value || "";
  const statusFilter = document.getElementById("parcelFilterStatus")?.value || "";
  const searchVal = (document.getElementById("parcelSearchLogNo")?.value || "").trim().toLowerCase();

  const filtered = allParcelsCache.filter(item => {
    const matchDiv = !divFilter || item.division.includes(divFilter);
    const matchStatus = !statusFilter || item.status === statusFilter;
    const matchSearch = !searchVal || 
                        item.log_no.toLowerCase().includes(searchVal) || 
                        item.item_name.toLowerCase().includes(searchVal) ||
                        item.parcel_no.toLowerCase().includes(searchVal);

    return matchDiv && matchStatus && matchSearch;
  });

  renderParcelTable(filtered);
}

function renderParcelTable(list) {
  const tbody = document.getElementById("parcelTableBody");
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">ไม่พบรายการพัสดุที่ตรงตามเงื่อนไข</td></tr>`;
    updateSelectionCounts();
    return;
  }

  tbody.innerHTML = list.map(item => {
    let statusBadge = '';
    if (item.status === 'pending') {
      statusBadge = `<span class="badge bg-secondary">รอออกเลขพัสดุ</span>`;
    } else if (item.status === 'registered') {
      statusBadge = `<span class="badge bg-info text-dark">ออกเลขพัสดุแล้ว</span>`;
    } else if (item.status === 'issued') {
      statusBadge = `<span class="badge bg-success">เบิกแล้ว (${item.issued_to || '-'})</span>`;
    }

    const formattedPrice = Number(item.unit_price).toLocaleString('th-TH', { minimumFractionDigits: 2 });

    return `
      <tr>
        <td class="text-center">
          <input type="checkbox" class="parcel-checkbox" data-uid="${item.uid}" data-status="${item.status}" onchange="onParcelCheckboxChange()">
        </td>
        <td class="text-center fw-bold text-primary">${item.log_no}</td>
        <td class="small">${item.division}</td>
        <td class="text-center small">${item.cr_date}</td>
        <td class="fw-bold">${item.item_name}</td>
        <td class="text-center small">${item.unit_index}</td>
        <td class="text-end fw-bold">${formattedPrice}</td>
        <td class="text-center small">${item.unit_name}</td>
        <td class="text-center fw-bold text-dark">${item.parcel_no}</td>
        <td class="text-center">${statusBadge}</td>
      </tr>
    `;
  }).join('');

  const selectAll = document.getElementById("selectAllParcels");
  if (selectAll) selectAll.checked = false;

  updateSelectionCounts();
}

// ============================================================================
// ☑️ 6. CHECKBOX SELECTION HANDLERS
// ============================================================================

export function toggleSelectAllParcels(masterCb) {
  const checkboxes = document.querySelectorAll(".parcel-checkbox");
  checkboxes.forEach(cb => {
    cb.checked = masterCb.checked;
  });
  updateSelectionCounts();
}

export function onParcelCheckboxChange() {
  updateSelectionCounts();
}

function updateSelectionCounts() {
  const checkboxes = document.querySelectorAll(".parcel-checkbox:checked");
  let regCount = 0;
  let issueCount = 0;

  checkboxes.forEach(cb => {
    const status = cb.dataset.status;
    if (status === 'pending') regCount++;
    if (status === 'registered' || status === 'pending') issueCount++;
  });

  const spanReg = document.getElementById("selectedCountReg");
  const spanIssue = document.getElementById("selectedCountIssue");

  if (spanReg) spanReg.textContent = regCount;
  if (spanIssue) spanIssue.textContent = issueCount;
}

// ============================================================================
// ⚡ 7. ACTION HANDLERS: GENERATE & ISSUE
// ============================================================================

export async function confirmGenerateParcelIDs() {
  const checkedBoxes = Array.from(document.querySelectorAll(".parcel-checkbox:checked"));
  const pendingBoxes = checkedBoxes.filter(cb => cb.dataset.status === 'pending');

  if (pendingBoxes.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'คำเตือน',
      text: 'กรุณาเลือกรายการพัสดุที่ยังอยู่ในสถานะ "รอออกเลขพัสดุ"',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  const uids = pendingBoxes.map(cb => cb.dataset.uid);
  const fundType = document.getElementById("parcelFundType")?.value || "งบประมาณ";
  const yearBE = document.getElementById("parcelYearBE")?.value || "2569";

  const confirmRes = await Swal.fire({
    title: 'ยืนยันการออกเลขพัสดุ',
    text: `ต้องการออกเลขพัสดุจำนวน ${uids.length} รายการ (ประเภท: ${fundType}, ปี: ${yearBE}) ใช่หรือไม่?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#198754',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'ยืนยันออกเลข',
    cancelButtonText: 'ยกเลิก'
  });

  if (!confirmRes.isConfirmed) return;

  Swal.fire({
    title: 'กำลังออกเลขพัสดุ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const res = await generateParcelNumbersBackend(uids, fundType, yearBE);

  if (res.success) {
    Swal.fire({
      icon: 'success',
      title: 'สำเร็จ',
      text: res.message,
      timer: 1800,
      showConfirmButton: false
    });
    await loadParcelDataFromLogPay();
  } else {
    Swal.fire({
      icon: 'error',
      title: 'ล้มเหลว',
      text: res.message,
      confirmButtonColor: '#0f172a'
    });
  }
}

export function openIssueModal() {
  const checkedBoxes = Array.from(document.querySelectorAll(".parcel-checkbox:checked"));
  const eligible = checkedBoxes.filter(cb => cb.dataset.status === 'registered' || cb.dataset.status === 'pending');

  if (eligible.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'คำเตือน',
      text: 'กรุณาเลือกรายการพัสดุที่ต้องการเบิกจ่าย',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  const dateInput = document.getElementById("issueDateInput");
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  const modalElem = document.getElementById("issueParcelModal");
  if (modalElem) {
    const modal = new bootstrap.Modal(modalElem);
    modal.show();
  }
}

export function syncRecipientInput(selectElem) {
  const customInput = document.getElementById("issueRecipientCustom");
  if (customInput && selectElem.value) {
    customInput.value = selectElem.value;
  }
}

export async function executeIssueParcels() {
  const checkedBoxes = Array.from(document.querySelectorAll(".parcel-checkbox:checked"));
  const uids = checkedBoxes.map(cb => cb.dataset.uid);

  const recipient = (document.getElementById("issueRecipientCustom")?.value || "").trim();
  const issueDate = document.getElementById("issueDateInput")?.value || "";

  if (!recipient) {
    Swal.fire({
      icon: 'warning',
      title: 'ข้อมูลไม่ครบ',
      text: 'กรุณาระบุหรือเลือกชื่อผู้รับเบิกพัสดุ',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  const modalElem = document.getElementById("issueParcelModal");
  const modal = bootstrap.Modal.getInstance(modalElem);
  if (modal) modal.hide();

  Swal.fire({
    title: 'กำลังบันทึกเบิกจ่าย...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  const res = await issueParcelsBackend(uids, recipient, issueDate);

  if (res.success) {
    Swal.fire({
      icon: 'success',
      title: 'สำเร็จ',
      text: res.message,
      timer: 1800,
      showConfirmButton: false
    });
    await loadParcelDataFromLogPay();
  } else {
    Swal.fire({
      icon: 'error',
      title: 'ล้มเหลว',
      text: res.message,
      confirmButtonColor: '#0f172a'
    });
  }
}

export function resetFormToMain() {
  window.location.href = "index.html";
}

// ============================================================================
// 🚀 AUTO-LOAD ON DOM READY
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  loadParcelDataFromLogPay();
});

// ============================================================================
// 🌐 ATTACH TO WINDOW FOR HTML EVENT LISTENERS
// ============================================================================
window.getLogPayForParcels = getLogPayForParcels;
window.generateParcelNumbersBackend = generateParcelNumbersBackend;
window.issueParcelsBackend = issueParcelsBackend;

window.loadParcelDataFromLogPay = loadParcelDataFromLogPay;
window.filterParcelTable = filterParcelTable;
window.toggleSelectAllParcels = toggleSelectAllParcels;
window.onParcelCheckboxChange = onParcelCheckboxChange;
window.confirmGenerateParcelIDs = confirmGenerateParcelIDs;
window.openIssueModal = openIssueModal;
window.syncRecipientInput = syncRecipientInput;
window.executeIssueParcels = executeIssueParcels;
window.resetFormToMain = resetFormToMain;