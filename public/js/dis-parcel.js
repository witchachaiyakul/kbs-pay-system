// public/js/dis-parcel.js
import { db } from "./firestore.js";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 GLOBAL STATE
// ============================================================================
let allRegisteredParcels = []; // เก็บรายการพัสดุที่มีเลขแล้วทั้งหมดจาก log_parcels
let currentTab = "registered"; // 'registered' = ยังไม่ได้เบิกจ่าย | 'issued' = เบิกจ่ายแล้ว

// ============================================================================
// 🛠️ HELPER FUNCTIONS
// ============================================================================
function formatThaiDateShort(dateVal) {
  if (!dateVal) return '-';
  if (typeof dateVal === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateVal.trim())) {
    return dateVal.trim();
  }
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
  return `${day}/${month}/${yearBE}`;
}

// ============================================================================
// 👥 1. โหลดรายชื่อบุคลากรสำหรับเลือก "ผู้รับ" (Collection: committees)
// ============================================================================
export async function loadRecipientOptions() {
  const dataList = document.getElementById("recipientDataList");
  if (!dataList) return;

  try {
    const snap = await getDocs(collection(db, "committees"));
    const names = new Set();

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const name = (data.name || data.fullname || "").trim();
      if (name) names.add(name);
    });

    dataList.innerHTML = Array.from(names)
      .sort((a, b) => a.localeCompare(b, 'th'))
      .map(name => `<option value="${name}">`)
      .join('');
  } catch (err) {
    console.warn("⚠️ โหลดรายชื่อผู้รับจาก committees ไม่สำเร็จ:", err);
  }
}

// ============================================================================
// 📥 2. ดึงเฉพาะพัสดุที่มีเลขแล้วจาก Firestore (Collection: log_parcels)
// ============================================================================
export async function loadRegisteredParcels(isRefresh = false) {
  const tbody = document.getElementById("disburseTableBody");
  const searchInput = document.getElementById("disSearchInput");

  if (isRefresh && searchInput) {
    searchInput.value = "";
  }

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center py-4 text-muted">
          <div class="spinner-border spinner-border-sm text-primary me-2"></div> กำลังโหลดรายการพัสดุที่มีเลขทะเบียน...
        </td>
      </tr>
    `;
  }

  try {
    const parcelSnap = await getDocs(collection(db, "log_parcels"));
    const list = [];
    const locationSet = new Set();

    parcelSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const logNo = data.log_no_ref || docSnap.id;
      const docDivision = data.division || '-';
      const docCrDate = data.cr_date || '-';
      const yearBE = String(data.year_be || '');
      const parcelArray = Array.isArray(data.parcel_no) ? data.parcel_no : [];

      parcelArray.forEach((p, idx) => {
        const parcelCode = (p.id || p.parcel_no || "").trim();
        if (!parcelCode || parcelCode === "-") return;

        const status = p.status === "issued" ? "issued" : "registered";
        const loc = (p.location || p.used_at || "").trim();
        if (loc) locationSet.add(loc);

        list.push({
          uid: p.uid || `${logNo}_idx_${idx}`,
          log_no: logNo,
          cr_date: p.cr_date || docCrDate || '-',
          division: p.division || docDivision || '-',
          item_name: p.item_name || 'พัสดุ',
          unit_index: p.unit_index || '',
          unit_price: Number(p.unit_price || 0),
          parcel_no: parcelCode,
          issued_to: p.issued_to || '',
          location: loc,
          issued_date: p.issued_date || '',
          status: status,
          year_be: yearBE
        });
      });
    });

    appendSavedLocationsToDatalist(locationSet);

    list.sort((a, b) => {
      const cmpLog = a.log_no.localeCompare(b.log_no, 'th');
      if (cmpLog !== 0) return cmpLog;
      return a.parcel_no.localeCompare(b.parcel_no, 'th');
    });

    allRegisteredParcels = list;
    filterDisburseTable();

  } catch (err) {
    console.error("❌ Error loadRegisteredParcels:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
  }
}

function appendSavedLocationsToDatalist(locationSet) {
  const locList = document.getElementById("locationDataList");
  if (!locList || locationSet.size === 0) return;

  const existingValues = new Set(Array.from(locList.options).map(o => o.value));
  locationSet.forEach(loc => {
    if (!existingValues.has(loc)) {
      const opt = document.createElement("option");
      opt.value = loc;
      locList.appendChild(opt);
    }
  });
}

// ============================================================================
// 🔄 3. สลับแท็บ "ยังไม่ได้เบิกจ่าย" / "เบิกจ่ายแล้ว" & กรองตาราง
// ============================================================================
export function switchDisburseTab(tabStatus) {
  currentTab = tabStatus;

  const btnPending = document.getElementById("tabBtnPending");
  const btnIssued = document.getElementById("tabBtnIssued");
  const actionGroup = document.getElementById("actionDisburseGroup");
  const modeLabel = document.getElementById("tableModeLabel");

  if (tabStatus === "registered") {
    btnPending?.classList.replace("btn-outline-secondary", "btn-navy");
    btnPending?.classList.add("active");
    btnIssued?.classList.replace("btn-navy", "btn-outline-secondary");
    btnIssued?.classList.remove("active");
    if (actionGroup) actionGroup.classList.remove("d-none");
    if (modeLabel) modeLabel.textContent = "แสดง: พัสดุที่ยังไม่ได้เบิกจ่าย";
  } else {
    btnIssued?.classList.replace("btn-outline-secondary", "btn-navy");
    btnIssued?.classList.add("active");
    btnPending?.classList.replace("btn-navy", "btn-outline-secondary");
    btnPending?.classList.remove("active");
    if (actionGroup) actionGroup.classList.add("d-none");
    if (modeLabel) modeLabel.textContent = "แสดง: ประวัติพัสดุที่เบิกจ่ายแล้ว";
  }

  filterDisburseTable();
}

export function filterDisburseTable() {
  const searchVal = (document.getElementById("disSearchInput")?.value || "").trim().toLowerCase();
  const divFilter = document.getElementById("disFilterDivision")?.value || "";
  const yearFilter = document.getElementById("disFilterYear")?.value || "";

  const baseMatched = allRegisteredParcels.filter(item => {
    const matchDiv = !divFilter || (item.division || "").includes(divFilter);
    const matchYear = !yearFilter || item.year_be === yearFilter || item.parcel_no.endsWith(`/${yearFilter.slice(-2)}`);
    const matchSearch = !searchVal ||
      item.log_no.toLowerCase().includes(searchVal) ||
      item.item_name.toLowerCase().includes(searchVal) ||
      item.parcel_no.toLowerCase().includes(searchVal) ||
      item.issued_to.toLowerCase().includes(searchVal) ||
      item.location.toLowerCase().includes(searchVal);

    return matchDiv && matchYear && matchSearch;
  });

  const pendingCount = baseMatched.filter(i => i.status === "registered").length;
  const issuedCount = baseMatched.filter(i => i.status === "issued").length;

  const spanPending = document.getElementById("countPendingBadge");
  const spanIssued = document.getElementById("countIssuedBadge");
  if (spanPending) spanPending.textContent = pendingCount;
  if (spanIssued) spanIssued.textContent = issuedCount;

  const tabFiltered = baseMatched.filter(item => item.status === currentTab);
  renderDisburseTable(tabFiltered);
}

// ============================================================================
// 🖥️ 4. RENDER ตารางแยกกลุ่มตาม นผ.2 (ครบทุกคอลัมน์ + ปุ่มพิมพ์ QR รายชิ้น)
// ============================================================================
function renderDisburseTable(list) {
  const tbody = document.getElementById("disburseTableBody");
  const selectAllCb = document.getElementById("selectAllDisburse");
  if (!tbody) return;

  if (selectAllCb) {
    selectAllCb.checked = false;
  }

  if (list.length === 0) {
    const emptyMsg = currentTab === "registered"
      ? "ไม่พบรายการพัสดุที่มีเลขและรอเบิกจ่าย"
      : "ยังไม่มีรายการพัสดุที่เบิกจ่ายแล้ว";
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">${emptyMsg}</td></tr>`;
    updateSelectedDisburseCount();
    return;
  }

  const groupedByLogNo = {};
  list.forEach(item => {
    if (!groupedByLogNo[item.log_no]) {
      groupedByLogNo[item.log_no] = [];
    }
    groupedByLogNo[item.log_no].push(item);
  });

  let htmlRows = "";

  Object.keys(groupedByLogNo).forEach(logNo => {
    const groupItems = groupedByLogNo[logNo];
    const first = groupItems[0];

    htmlRows += `
      <tr class="table-primary">
        <td colspan="10" class="py-2 px-3">
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <i class="bi bi-folder2-open text-primary me-1"></i>
              <strong>เลข นผ.2 : ${logNo}</strong>
              <span class="text-muted ms-2 small">| ฝ่าย: ${first.division} | วันตรวจรับ: ${first.cr_date}</span>
            </div>
            <div>
              <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold" onclick="selectGroupByLogNo('${logNo}')">
                <i class="bi bi-check2-all me-1"></i>เลือกทั้ง นผ.2 นี้ (${groupItems.length} รายการ)
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;

    groupItems.forEach(item => {
      const isPending = item.status === "registered";
      const unitLabel = item.unit_index ? ` <span class="text-muted small">(${item.unit_index})</span>` : "";

      const recipientCell = isPending
        ? `<span class="text-muted small">- รอระบุผู้รับ -</span>`
        : `<span class="fw-bold text-dark">${item.issued_to || '-'}</span>`;

      const locationCell = isPending
        ? `<span class="text-muted small">- รอระบุสถานที่ -</span>`
        : `<span class="text-primary fw-semibold"><i class="bi bi-geo-alt-fill me-1"></i>${item.location || '-'}</span>`;

      const statusCell = isPending
        ? `<span class="badge bg-warning text-dark">ยังไม่ได้เบิกจ่าย</span>`
        : `<div>
             <span class="badge bg-success">เบิกจ่ายแล้ว</span>
             <div class="small text-muted mt-1" style="font-size: 11px;">วันที่: ${formatThaiDateShort(item.issued_date)}</div>
             <button type="button" class="btn btn-link text-danger p-0 mt-1" style="font-size: 11px;" onclick="cancelDisburseItem('${item.log_no}', '${item.uid}', '${item.parcel_no}')">
               ยกเลิกการจ่าย
             </button>
           </div>`;

      htmlRows += `
        <tr>
          <td class="text-center">
            <input type="checkbox" class="disburse-checkbox" data-uid="${item.uid}" data-logno="${item.log_no}"
                   onchange="updateSelectedDisburseCount()">
          </td>
          <td class="text-center fw-bold text-primary">${item.log_no}</td>
          <td class="text-center small">${item.cr_date}</td>
          <td class="small">${item.division}</td>
          <td class="fw-bold">${item.item_name}${unitLabel}</td>
          <td class="text-center fw-bold text-dark">${item.parcel_no}</td>
          <td class="text-center">${recipientCell}</td>
          <td class="text-center">${locationCell}</td>
          <td class="text-center">${statusCell}</td>
          <td class="text-center">
            <button type="button" class="btn btn-sm btn-outline-dark" title="พิมพ์ QR Code รายการนี้" onclick="printSingleQr('${item.uid}')">
              <i class="bi bi-qr-code"></i>
            </button>
          </td>
        </tr>
      `;
    });
  });

  tbody.innerHTML = htmlRows;
  updateSelectedDisburseCount();
}

// ============================================================================
// ☑️ 5. CHECKBOX SELECTION HANDLERS
// ============================================================================
export function toggleSelectAllDisburse(masterCb) {
  const checkboxes = document.querySelectorAll(".disburse-checkbox");
  checkboxes.forEach(cb => {
    cb.checked = masterCb.checked;
  });
  updateSelectedDisburseCount();
}

export function selectGroupByLogNo(logNo) {
  const groupCbs = document.querySelectorAll(`.disburse-checkbox[data-logno="${logNo}"]`);
  const allChecked = Array.from(groupCbs).every(cb => cb.checked);
  groupCbs.forEach(cb => {
    cb.checked = !allChecked;
  });
  updateSelectedDisburseCount();
}

export function updateSelectedDisburseCount() {
  const checkedCount = document.querySelectorAll(".disburse-checkbox:checked").length;
  const spanCount = document.getElementById("selectedDisburseCount");
  const spanQrCount = document.getElementById("selectedQrCount");
  if (spanCount) spanCount.textContent = checkedCount;
  if (spanQrCount) spanQrCount.textContent = checkedCount;
}

// ============================================================================
// 🖨️ 6. QR CODE STICKER GENERATOR & PRINT MODAL
// ============================================================================
export function printSingleQr(uid) {
  const item = allRegisteredParcels.find(p => p.uid === uid);
  if (!item) return;
  renderQrStickersAndShowModal([item]);
}

export function openQrPrintModal() {
  const checkedBoxes = Array.from(document.querySelectorAll(".disburse-checkbox:checked"));
  if (checkedBoxes.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'ยังไม่ได้เลือกรายการ',
      text: 'กรุณาติ๊กเลือกรายการพัสดุที่ต้องการพิมพ์ QR Code อย่างน้อย 1 รายการ',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  const selectedUids = new Set(checkedBoxes.map(cb => cb.dataset.uid));
  const targetItems = allRegisteredParcels.filter(item => selectedUids.has(item.uid));

  renderQrStickersAndShowModal(targetItems);
}

async function renderQrStickersAndShowModal(items) {
  const container = document.getElementById("qrStickerContainer");
  const totalSpan = document.getElementById("qrTotalLabels");
  if (!container) return;

  if (totalSpan) totalSpan.textContent = items.length;
  container.innerHTML = "";

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const card = document.createElement("div");
    card.className = "qr-sticker-card";

    const qrImgId = `qrcode_img_${index}`;
    const unitText = item.unit_index ? ` (${item.unit_index})` : "";
    const recipientText = item.issued_to ? item.issued_to : "-";
    const locationText = item.location ? item.location : "-";

    card.innerHTML = `
      <div class="qr-code-box">
        <img id="${qrImgId}" alt="QR Code" style="width: 96px; height: 96px;" />
      </div>
      <div class="qr-info-box">
        <div class="qr-parcel-no">${item.parcel_no}</div>
        <div class="fw-bold text-truncate" style="max-width: 220px;" title="${item.item_name}">
          ${item.item_name}${unitText}
        </div>
        <div><span class="text-muted">นผ.2:</span> ${item.log_no} | <span class="text-muted">ตรวจรับ:</span> ${item.cr_date}</div>
        <div><span class="text-muted">ฝ่าย:</span> ${item.division}</div>
        <div><span class="text-muted">ผู้รับ:</span> ${recipientText}</div>
        <div><span class="text-muted">ใช้งานที่:</span> <strong>${locationText}</strong></div>
      </div>
    `;

    container.appendChild(card);

    const qrPayload = [
      `เลขพัสดุ: ${item.parcel_no}`,
      `รายการ: ${item.item_name}${unitText}`,
      `นผ.2: ${item.log_no} (${item.cr_date})`,
      `ฝ่าย: ${item.division}`,
      `ผู้รับ: ${recipientText}`,
      `ใช้งานที่: ${locationText}`
    ].join("\n");

    const imgElem = document.getElementById(qrImgId);
    if (imgElem && typeof QRCode !== "undefined" && QRCode.toDataURL) {
      try {
        imgElem.src = await QRCode.toDataURL(qrPayload, {
          width: 160,
          margin: 1,
          errorCorrectionLevel: 'M'
        });
      } catch (err) {
        console.error("❌ สร้าง QR Code ไม่สำเร็จ:", err);
      }
    }
  }

  const modalElem = document.getElementById("qrPrintModal");
  if (modalElem) {
    const modal = bootstrap.Modal.getOrCreateInstance(modalElem);
    modal.show();
  }
}

// ============================================================================
// 📤 7. MODAL & BACKEND: บันทึกการจ่ายพัสดุ + สถานที่ใช้งาน
// ============================================================================
export function openDisburseModal() {
  const checkedBoxes = Array.from(document.querySelectorAll(".disburse-checkbox:checked"));
  if (checkedBoxes.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'ยังไม่ได้เลือกรายการ',
      text: 'กรุณาเลือกรายการพัสดุที่ต้องการจ่ายอย่างน้อย 1 รายการ',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  const qtySpan = document.getElementById("modalSelectedQty");
  if (qtySpan) qtySpan.textContent = checkedBoxes.length;

  const dateInput = document.getElementById("disIssueDateInput");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  const modalElem = document.getElementById("disburseModal");
  if (modalElem) {
    const modal = bootstrap.Modal.getOrCreateInstance(modalElem);
    modal.show();
  }
}

export async function executeDisburseParcels() {
  const checkedBoxes = Array.from(document.querySelectorAll(".disburse-checkbox:checked"));
  const recipient = (document.getElementById("disRecipientInput")?.value || "").trim();
  const location = (document.getElementById("disLocationInput")?.value || "").trim();
  const issueDate = document.getElementById("disIssueDateInput")?.value || "";

  if (checkedBoxes.length === 0) return;

  if (!recipient) {
    Swal.fire({
      icon: 'warning',
      title: 'ข้อมูลไม่ครบถ้วน',
      text: 'กรุณาระบุชื่อผู้รับพัสดุ',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  if (!location) {
    Swal.fire({
      icon: 'warning',
      title: 'ข้อมูลไม่ครบถ้วน',
      text: 'กรุณาระบุสถานที่ใช้งาน (ใช้งานที่)',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  if (!issueDate) {
    Swal.fire({
      icon: 'warning',
      title: 'ข้อมูลไม่ครบถ้วน',
      text: 'กรุณาระบุวันที่จ่ายพัสดุ',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  const modalElem = document.getElementById("disburseModal");
  const modal = bootstrap.Modal.getInstance(modalElem);
  if (modal) modal.hide();

  Swal.fire({
    title: 'กำลังบันทึกการจ่ายพัสดุ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const logNoGroups = {};
    checkedBoxes.forEach(cb => {
      const logNo = cb.dataset.logno;
      const uid = cb.dataset.uid;
      if (!logNoGroups[logNo]) logNoGroups[logNo] = [];
      logNoGroups[logNo].push(uid);
    });

    const logNos = Object.keys(logNoGroups);

    await runTransaction(db, async (transaction) => {
      const refs = logNos.map(logNo => doc(db, "log_parcels", logNo));
      const snaps = await Promise.all(refs.map(ref => transaction.get(ref)));

      snaps.forEach((snap, idx) => {
        if (!snap.exists()) return;
        const logNo = logNos[idx];
        const targetUids = logNoGroups[logNo];
        const data = snap.data();
        const parcelArray = Array.isArray(data.parcel_no) ? [...data.parcel_no] : [];

        parcelArray.forEach(p => {
          if (targetUids.includes(p.uid)) {
            p.status = "issued";
            p.issued_to = recipient;
            p.location = location;
            p.issued_date = issueDate;
          }
        });

        const allIssued = parcelArray.every(p => p.status === "issued");

        transaction.update(refs[idx], {
          parcel_no: parcelArray,
          status: allIssued ? "issued" : "registered",
          updated_at: serverTimestamp()
        });
      });
    });

    Swal.fire({
      icon: 'success',
      title: 'บันทึกการจ่ายพัสดุสำเร็จ',
      html: `จ่ายพัสดุจำนวน <b>${checkedBoxes.length}</b> รายการ<br>ผู้รับ: <b>${recipient}</b> | ใช้งานที่: <b>${location}</b>`,
      timer: 2000,
      showConfirmButton: false
    });

    await loadRegisteredParcels();

  } catch (err) {
    console.error("❌ Error executeDisburseParcels:", err);
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาด',
      text: err.message,
      confirmButtonColor: '#0f172a'
    });
  }
}

// ============================================================================
// ↩️ 8. ยกเลิกการเบิกจ่าย (ล้างทั้ง ผู้รับ และ สถานที่ใช้งาน)
// ============================================================================
export async function cancelDisburseItem(logNo, uid, parcelNo) {
  const confirmRes = await Swal.fire({
    title: 'ยืนยันยกเลิกการจ่ายพัสดุ?',
    html: `ต้องการคืนสถานะเลขพัสดุ <b>${parcelNo}</b> (${logNo}) กลับเป็น <b>"ยังไม่ได้เบิกจ่าย"</b> ใช่หรือไม่?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'ยืนยันยกเลิก',
    cancelButtonText: 'ปิด'
  });

  if (!confirmRes.isConfirmed) return;

  Swal.fire({
    title: 'กำลังอัปเดตสถานะ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const docRef = doc(db, "log_parcels", logNo);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return;

      const data = snap.data();
      const parcelArray = Array.isArray(data.parcel_no) ? [...data.parcel_no] : [];

      parcelArray.forEach(p => {
        if (p.uid === uid) {
          p.status = "registered";
          p.issued_to = "";
          p.location = "";
          p.issued_date = "";
        }
      });

      transaction.update(docRef, {
        parcel_no: parcelArray,
        status: "registered",
        updated_at: serverTimestamp()
      });
    });

    Swal.fire({
      icon: 'success',
      title: 'ยกเลิกการจ่ายเรียบร้อย',
      timer: 1500,
      showConfirmButton: false
    });

    await loadRegisteredParcels();
  } catch (err) {
    console.error("❌ Error cancelDisburseItem:", err);
    Swal.fire({
      icon: 'error',
      title: 'ล้มเหลว',
      text: err.message
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
  loadRecipientOptions();
  loadRegisteredParcels();
});

// ============================================================================
// 🌐 ATTACH TO WINDOW FOR HTML EVENT LISTENERS
// ============================================================================
window.loadRegisteredParcels = loadRegisteredParcels;
window.switchDisburseTab = switchDisburseTab;
window.filterDisburseTable = filterDisburseTable;
window.toggleSelectAllDisburse = toggleSelectAllDisburse;
window.selectGroupByLogNo = selectGroupByLogNo;
window.updateSelectedDisburseCount = updateSelectedDisburseCount;
window.printSingleQr = printSingleQr;
window.openQrPrintModal = openQrPrintModal;
window.openDisburseModal = openDisburseModal;
window.executeDisburseParcels = executeDisburseParcels;
window.cancelDisburseItem = cancelDisburseItem;
window.resetFormToMain = resetFormToMain;