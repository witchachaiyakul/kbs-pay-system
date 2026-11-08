// js/log-pay.js
import { db } from "./firestore.js";
import { 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    setDoc, 
    updateDoc, 
    deleteDoc,
    query, 
    limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 GLOBAL STATE & CACHE
// ============================================================================
let currentDocType = 'po'; // 'po', 'wo', 'fpo'
let allPoCache = [];
let holidaysCache = [];
let suppliersCache = [];

const TYPE_LABEL = {
  po: '(ใบสั่งซื้อ)',
  wo: '(ใบสั่งจ้าง)',
  fpo: '(สั่งซื้อน้ำมัน)'
};

// ============================================================================
// ⚙️ 1. HELPER & ALGORITHM FUNCTIONS (ยกมาจากระบบเดิม 100%)
// ============================================================================

export function normalizeDocType(typeInput) {
  if (!typeInput) return 'po';
  const t = String(typeInput).trim().toLowerCase();
  if (t === 'b' || t === 'wo' || t.includes('จ้าง')) return 'wo';
  if (t === 'c' || t === 'fpo' || t.includes('น้ำมัน')) return 'fpo';
  return 'po';
}

export function isWorkingDay(dateObj, holidayList = []) {
  const day = dateObj.getDay();
  if (day === 0 || day === 6) return false; // เสาร์-อาทิตย์
  const dateStr = dateObj.toISOString().split('T')[0];
  if (holidayList.includes(dateStr)) return false;
  return true;
}

export function countWorkingDaysBetween(startDateStr, endDateStr, holidayList = []) {
  let count = 0;
  let curDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  curDate.setDate(curDate.getDate() + 1);

  while (curDate <= endDate) {
    if (isWorkingDay(curDate, holidayList)) {
      count++;
    }
    curDate.setDate(curDate.getDate() + 1);
  }

  return count;
}

/**
 * 🎯 ฟังก์ชันหลักคำนวณเลข PO/WO/FPO ตามอัลกอริทึมวันทำการของระบบเดิม
 */
export function generateLogPoNumber(docTypeInput, prDateStr, existingLogs = [], holidayList = []) {
  const docType = normalizeDocType(docTypeInput);
  const prDate = prDateStr ? new Date(prDateStr) : new Date();
  const yearBE = prDate.getFullYear() + 543;
  const targetDateStr = prDateStr || new Date().toISOString().split('T')[0];

  const getSubNo = (item) => {
    if (!item) return 0;
    if (item.sub_no !== undefined && item.sub_no !== null && item.sub_no !== '') return Number(item.sub_no);
    if (item.po_sub_no !== undefined && item.po_sub_no !== null && item.po_sub_no !== '') return Number(item.po_sub_no);
    return 0;
  };

  const getBaseNo = (item) => {
    if (!item) return 1;
    return Number(item.base_no || item.po_base_no) || 1;
  };

  // 1. กรองเฉพาะหมวดและปีเดียวกัน
  const sameTypeAndYearLogs = existingLogs.filter(item => {
    if (!item) return false;
    const itemType = normalizeDocType(item.doc_type);
    const itemYear = Number(item.year_be || item.po_year_be) || 0;
    let y = itemYear;
    if (y === 0 && item.pr_date) y = new Date(item.pr_date).getFullYear() + 543;
    return itemType === docType && (y === 0 || y === yearBE);
  });

  if (sameTypeAndYearLogs.length === 0) {
    return {
      log_po: `${1}/${yearBE}`,
      base_no: 1,
      sub_no: 1,
      year_be: yearBE,
      doc_type: docType
    };
  }

  // 2. ตรวจสอบรายการในวันเดียวกัน (targetDateStr)
  const sameDateLogs = sameTypeAndYearLogs.filter(item => item.pr_date === targetDateStr);

  if (sameDateLogs.length > 0) {
    sameDateLogs.sort((a, b) => getSubNo(b) - getSubNo(a));
    const maxSameDate = sameDateLogs[0];
    const baseNo = getBaseNo(maxSameDate);
    const maxSubNo = getSubNo(maxSameDate);
    const newSubNo = maxSubNo + 1; 

    return {
      log_po: `${baseNo}/${newSubNo}/${yearBE}`,
      base_no: baseNo,
      sub_no: newSubNo,
      year_be: yearBE,
      doc_type: docType
    };
  }

  // 3. ถ้าวันนั้นยังไม่มีรายการ ให้หารายการล่าสุดก่อนหน้านั้น
  const pastLogs = sameTypeAndYearLogs.filter(item => item.pr_date && item.pr_date <= targetDateStr);

  if (pastLogs.length > 0) {
    pastLogs.sort((a, b) => {
      if (a.pr_date !== b.pr_date) return a.pr_date.localeCompare(b.pr_date);
      return getBaseNo(a) - getBaseNo(b);
    });

    const lastPast = pastLogs[pastLogs.length - 1];
    const lastBaseNo = getBaseNo(lastPast);
    
    const workingDays = countWorkingDaysBetween(lastPast.pr_date, targetDateStr, holidayList);
    const newBaseNo = lastBaseNo + (workingDays > 0 ? workingDays : 1);
    
    return {
      log_po: `${newBaseNo}/${yearBE}`,
      base_no: newBaseNo,
      sub_no: 1,
      year_be: yearBE,
      doc_type: docType
    };
  } else {
    return {
      log_po: `1/${yearBE}`,
      base_no: 1,
      sub_no: 1,
      year_be: yearBE,
      doc_type: docType
    };
  }
}

// ============================================================================
// 🎯 2. ดึงข้อมูลจาก FIRESTORE
// ============================================================================

export async function getLogPoDataFromFirestore() {
  try {
    const q = query(collection(db, "log_po"), limit(500));
    const querySnapshot = await getDocs(q);
    const list = [];

    querySnapshot.forEach(docSnap => {
      list.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    allPoCache = list;
    window.allPoLogs = list; // ผูกไว้ใช้งานข้ามโมดูล
    return list;
  } catch (err) {
    console.error("❌ Error getLogPoDataFromFirestore:", err);
    return [];
  }
}

export async function getHolidaysFromFirestore() {
  try {
    const querySnapshot = await getDocs(collection(db, "holidays"));
    const list = [];

    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      list.push(data.date || docSnap.id);
    });

    holidaysCache = list;
    window.allHolidays = list;
    return list;
  } catch (err) {
    console.error("❌ Error getHolidaysFromFirestore:", err);
    return [];
  }
}

export async function getSuppliersFromFirestore() {
  try {
    const querySnapshot = await getDocs(collection(db, "suppliers"));
    const list = [];

    querySnapshot.forEach(docSnap => {
      list.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    suppliersCache = list;
    populateSellerDatalist(list);
    return list;
  } catch (err) {
    console.warn("⚠️ ไม่สามารถดึงข้อมูลร้านค้า (suppliers):", err);
    return [];
  }
}

function populateSellerDatalist(suppliers) {
  const datalist = document.getElementById('seller_list');
  if (!datalist) return;
  datalist.innerHTML = '';

  suppliers.forEach(s => {
    const name = s.seller || s.name || s.supplier_name || '';
    if (name) {
      const opt = document.createElement('option');
      opt.value = name;
      datalist.appendChild(opt);
    }
  });
}

// ============================================================================
// 🎯 3. บันทึกข้อมูล LOG_PO และอัปเดต COUNTER (ใช้โครงสร้างตามระบบเดิม)
// ============================================================================

export async function saveLogPoToFirestore(poData, docIdInput) {
  try {
    if (!poData) {
      return { success: false, error: 'ข้อมูลไม่สมบูรณ์ (Missing poData)' };
    }

    const docType = normalizeDocType(poData.doc_type);
    const baseNo = Number(poData.base_no) || 1;
    const subNo = Number(poData.sub_no) || 1;
    const yearBe = Number(poData.year_be) || (new Date().getFullYear() + 543);

    // 🎯 สร้าง Document ID ในรูปแบบเดียวกับระบบเดิม: ${docType}_${base}_${sub}_${year}
    const safeDocId = docIdInput || `${docType}_${baseNo}_${subNo}_${yearBe}`;

    const cleanData = {
      ...poData,
      doc_type: docType,
      base_no: baseNo,
      sub_no: subNo,
      year_be: yearBe,
      total: Number(String(poData.total || 0).replace(/,/g, '')) || 0,
      postid: Number(poData.postid) || 0,
      seller2: poData.seller2 || '',
      seller3: poData.seller3 || '',
      updated_at: new Date().toISOString()
    };

    const poRef = doc(db, "log_po", safeDocId);
    await setDoc(poRef, cleanData, { merge: true });

    // อัปเดต po_counters
    await updatePoCounter(docType, yearBe, baseNo, subNo, poData.pr_date);

    return { success: true, docId: safeDocId };
  } catch (err) {
    console.error("❌ Error saveLogPoToFirestore:", err);
    return { success: false, error: err.message };
  }
}

export async function updatePoCounter(docTypeInput, yearBe, baseNo, subNo, prDate) {
  try {
    const docType = normalizeDocType(docTypeInput);
    const counterDocId = `${docType}_${yearBe}`;
    const newBase = Number(baseNo) || 0;
    const newSub = Number(subNo) || 0;

    const counterRef = doc(db, "po_counters", counterDocId);
    const counterSnap = await getDoc(counterRef);
    let currentCounter = counterSnap.exists() ? counterSnap.data() : null;

    let shouldUpdate = false;
    if (!currentCounter) {
      shouldUpdate = true;
    } else {
      const currBase = Number(currentCounter.last_base_no) || 0;
      const currSub = Number(currentCounter.last_sub_no) || 0;

      if (newBase > currBase) {
        shouldUpdate = true;
      } else if (newBase === currBase && newSub >= currSub) {
        shouldUpdate = true;
      }
    }

    if (shouldUpdate) {
      const counterData = {
        doc_type: docType,
        year_be: Number(yearBe),
        last_base_no: newBase,
        last_sub_no: newSub,
        last_pr_date: prDate || "",
        updated_at: new Date().toISOString()
      };

      await setDoc(counterRef, counterData, { merge: true });
      console.log(`✅ อัปเดต po_counters [${counterDocId}] base_no: ${newBase}, sub_no: ${newSub}`);
    }
  } catch (err) {
    console.warn("⚠️ Warning updatePoCounter:", err);
  }
}

export async function updateLogPoInFirestore(docId, poData) {
  try {
    if (!docId || !poData) {
      return { success: false, error: 'ไม่ได้ระบุ docId หรือ poData' };
    }

    const cleanData = {
      ...poData,
      total: Number(String(poData.total || 0).replace(/,/g, '')) || 0,
      postid: Number(poData.postid) || 0,
      seller2: poData.seller2 || '',
      seller3: poData.seller3 || '',
      updated_at: new Date().toISOString()
    };

    const docRef = doc(db, "log_po", docId);
    await updateDoc(docRef, cleanData);

    return { success: true };
  } catch (err) {
    console.error("❌ Error updateLogPoInFirestore:", err);
    return { success: false, error: err.message };
  }
}

export async function deleteLogPoFromFirestore(docId) {
  try {
    await deleteDoc(doc(db, "log_po", docId));
    return { success: true };
  } catch (err) {
    console.error("❌ Error deleteLogPoFromFirestore:", err);
    return { success: false, error: err.message };
  }
}

// ============================================================================
// 🖥️ 4. UI HANDLERS & TABLE RENDER
// ============================================================================

export function switchPoTab(type, btnElement) {
  currentDocType = normalizeDocType(type);

  document.querySelectorAll('.nav-po-type').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  const labelElem = document.getElementById('currentTypeLabel');
  if (labelElem) labelElem.innerText = TYPE_LABEL[currentDocType] || '(ใบสั่งซื้อ)';

  renderPoTable();
}

export function renderPoTable() {
  const tbody = document.getElementById('poDataTableBody');
  if (!tbody) return;

  const targetType = normalizeDocType(currentDocType);

  const filtered = allPoCache.filter(item => {
    if (!item) return false;
    const itemType = normalizeDocType(item.doc_type);
    const detailText = String(item.details || item.list || item.objective || '').trim();
    return (itemType === targetType) && (detailText !== '' && detailText !== '-');
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-4 text-muted">
          <i class="bi bi-inbox fs-2 d-block mb-2"></i>ไม่พบรายการข้อมูลในหมวดนี้
        </td>
      </tr>
    `;
    return;
  }

  // เรียงลำดับรายการล่าสุดขึ้นก่อน
  filtered.sort((a, b) => {
    const dateA = a.pr_date || '';
    const dateB = b.pr_date || '';
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return (Number(b.base_no) || 0) - (Number(a.base_no) || 0) || (Number(b.sub_no) || 0) - (Number(a.sub_no) || 0);
  });

  tbody.innerHTML = filtered.map(item => {
    const docId = item.id || item.log_po;
    const poNum = item.log_po || item.id || '-';
    const prDate = item.pr_date || '-';
    const details = item.details || item.list || item.objective || '-';
    const seller = item.seller || item.seller_name || '-';
    const total = Number(item.total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
    const division = item.division || '-';
    const egpNo = item.egp_no || item.egp || '-';
    const isManual = item.is_manual !== false;

    return `
      <tr>
        <td class="fw-bold text-primary">${poNum}</td>
        <td class="small text-nowrap">${prDate}</td>
        <td class="text-start small text-wrap text-break" style="max-width: 240px;">${details}</td>
        <td class="small text-start text-wrap text-break" style="max-width: 180px;">${seller}</td>
        <td class="text-end fw-bold text-dark text-nowrap">${total}</td>
        <td class="small text-nowrap">${division}</td>
        <td class="small text-nowrap">${egpNo}</td>
        <td><span class="badge ${isManual ? 'bg-secondary' : 'bg-success'}">${isManual ? 'กรอกเอง' : 'KBSPAY'}</span></td>
        <td class="text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-primary me-1" onclick="openEditPoModal('${docId}')" title="แก้ไข">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteLogPo('${docId}')" title="ลบ">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// 🔢 5. PREVIEW & SAVE MANUAL LOG PO
// ============================================================================

export function previewAutoPoNumber() {
  const previewElem = document.getElementById('previewPoNumber');
  const btnSubmit = document.getElementById('btnSaveManualPo');
  if (!previewElem) return;

  const docTypeVal = document.getElementById('modal_doc_type')?.value || currentDocType;
  const prDateVal = document.getElementById('modal_pr_date')?.value || new Date().toISOString().split('T')[0];

  const generated = generateLogPoNumber(docTypeVal, prDateVal, allPoCache, holidaysCache);

  previewElem.innerText = generated.log_po;
  previewElem.dataset.baseNo = generated.base_no;
  previewElem.dataset.subNo = generated.sub_no;
  previewElem.dataset.yearBe = generated.year_be;
  previewElem.dataset.logPo = generated.log_po;
  previewElem.dataset.docType = generated.doc_type;

  if (btnSubmit) btnSubmit.disabled = false;
}

export async function openManualPoModal() {
  const form = document.getElementById('poManualForm');
  if (form) form.reset();

  const modalDocType = document.getElementById('modal_doc_type');
  if (modalDocType) modalDocType.value = currentDocType;

  const modalPrDate = document.getElementById('modal_pr_date');
  if (modalPrDate) modalPrDate.value = new Date().toISOString().split('T')[0];

  previewAutoPoNumber();

  const modalElem = document.getElementById('manualPoModal');
  if (modalElem) {
    const modal = new bootstrap.Modal(modalElem);
    modal.show();
  }
}

export async function saveManualLogPo() {
  const btnSubmit = document.getElementById('btnSaveManualPo');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '⏳ กำลังบันทึก...';
  }

  try {
    const docType = document.getElementById('modal_doc_type').value;
    const prDate = document.getElementById('modal_pr_date').value;
    const details = document.getElementById('modal_details').value;
    const total = Number(document.getElementById('modal_total').value || 0);
    const division = document.getElementById('modal_division').value;

    if (!prDate || !details || total <= 0) {
      Swal.fire({
        icon: 'warning',
        title: 'ข้อมูลไม่ครบถ้วน',
        text: 'กรุณากรอกข้อมูลสำคัญ (วันที่, รายการ, จำนวนเงิน) ให้ถูกต้อง',
        confirmButtonColor: '#0f172a'
      });
      return;
    }

    // คำนวณรันเลขตามอัลกอริทึมวันทำการ
    const generated = generateLogPoNumber(docType, prDate, allPoCache, holidaysCache);

    const poData = {
      log_po: generated.log_po,
      doc_type: generated.doc_type,
      base_no: generated.base_no,
      sub_no: generated.sub_no,
      year_be: generated.year_be,
      pr_date: prDate,
      po_date: document.getElementById('modal_po_date')?.value || prDate,
      details: details,
      total: total,
      division: division,
      egp_no: document.getElementById('modal_egp_no')?.value || '',
      seller: document.getElementById('modal_seller')?.value || '',
      taxid: document.getElementById('modal_taxid')?.value || '',
      ad_ph: document.getElementById('modal_ad_ph')?.value || '',
      ad_no: document.getElementById('modal_ad_no')?.value || '',
      ad_m: document.getElementById('modal_ad_m')?.value || '',
      ad_rd: document.getElementById('modal_ad_rd')?.value || '',
      ad_tb: document.getElementById('modal_ad_tb')?.value || '',
      ad_mu: document.getElementById('modal_ad_mu')?.value || '',
      ad_pr: document.getElementById('modal_ad_pr')?.value || '',
      postid: document.getElementById('modal_postid')?.value || '',
      bidder_name: document.getElementById('modal_bidder_name')?.value || '',
      is_manual: true,
      createdAt: new Date().toISOString()
    };

    const res = await saveLogPoToFirestore(poData);
    if (!res.success) throw new Error(res.error);

    Swal.fire({
      icon: 'success',
      title: 'ออกเลขสำเร็จ!',
      html: `ได้รับเลขที่เอกสาร: <strong class="text-primary fs-4">${generated.log_po}</strong>`,
      confirmButtonColor: '#0f172a'
    });

    const modalElem = document.getElementById('manualPoModal');
    const modal = bootstrap.Modal.getInstance(modalElem);
    if (modal) modal.hide();

    await refreshAllData();

  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาดในการบันทึก',
      text: err.message,
      confirmButtonColor: '#0f172a'
    });
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="bi bi-save me-1"></i> ยืนยันออกเลขและบันทึก';
    }
  }
}

// ============================================================================
// ✏️ 6. EDIT, UPDATE, DELETE & AUTO-FILL SUPPLIER
// ============================================================================

export function openEditPoModal(docId) {
  const item = allPoCache.find(i => String(i.id || i.log_po) === String(docId));
  if (!item) {
    alert('❌ ไม่พบข้อมูลเอกสารรายการนี้');
    return;
  }

  document.getElementById('edit_doc_id').value = item.id || item.log_po;
  document.getElementById('edit_doc_type').value = item.doc_type || currentDocType;
  document.getElementById('edit_log_po').value = item.log_po || item.id || '';
  document.getElementById('edit_pr_date').value = item.pr_date || '';
  document.getElementById('edit_details').value = item.details || item.list || item.objective || '';
  document.getElementById('edit_total').value = item.total || 0;
  document.getElementById('edit_division').value = item.division || '';
  document.getElementById('edit_egp_no').value = item.egp_no || item.egp || '';
  document.getElementById('edit_po_date').value = item.po_date || '';
  document.getElementById('edit_seller').value = item.seller || item.seller_name || '';
  document.getElementById('edit_taxid').value = item.taxid || '';
  document.getElementById('edit_ad_ph').value = item.ad_ph || '';
  document.getElementById('edit_ad_no').value = item.ad_no || '';
  document.getElementById('edit_ad_m').value = item.ad_m || '';
  document.getElementById('edit_ad_rd').value = item.ad_rd || '';
  document.getElementById('edit_ad_tb').value = item.ad_tb || '';
  document.getElementById('edit_ad_mu').value = item.ad_mu || '';
  document.getElementById('edit_ad_pr').value = item.ad_pr || '';
  document.getElementById('edit_postid').value = item.postid || '';
  document.getElementById('edit_bidder_name').value = item.bidder_name || '';

  const modalElem = document.getElementById('editPoModal');
  if (modalElem) {
    const modal = new bootstrap.Modal(modalElem);
    modal.show();
  }
}

export async function updateLogPoData() {
  const docId = document.getElementById('edit_doc_id').value;
  if (!docId) return;

  const btnUpdate = document.getElementById('btnUpdatePo');
  if (btnUpdate) {
    btnUpdate.disabled = true;
    btnUpdate.innerHTML = '⏳ กำลังบันทึกการแก้ไข...';
  }

  try {
    const poData = {
      pr_date: document.getElementById('edit_pr_date').value,
      details: document.getElementById('edit_details').value,
      total: Number(document.getElementById('edit_total').value || 0),
      division: document.getElementById('edit_division').value,
      egp_no: document.getElementById('edit_egp_no').value || '',
      po_date: document.getElementById('edit_po_date').value || '',
      seller: document.getElementById('edit_seller').value,
      taxid: document.getElementById('edit_taxid').value || '',
      ad_ph: document.getElementById('edit_ad_ph').value || '',
      ad_no: document.getElementById('edit_ad_no').value || '',
      ad_m: document.getElementById('edit_ad_m').value || '',
      ad_rd: document.getElementById('edit_ad_rd').value || '',
      ad_tb: document.getElementById('edit_ad_tb').value || '',
      ad_mu: document.getElementById('edit_ad_mu').value || '',
      ad_pr: document.getElementById('edit_ad_pr').value || '',
      postid: document.getElementById('edit_postid').value || '',
      bidder_name: document.getElementById('edit_bidder_name').value || ''
    };

    const res = await updateLogPoInFirestore(docId, poData);
    if (!res.success) throw new Error(res.error);

    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ!',
      text: 'อัปเดตข้อมูลเรียบร้อยแล้ว',
      timer: 1800,
      showConfirmButton: false
    });

    const modalElem = document.getElementById('editPoModal');
    const modal = bootstrap.Modal.getInstance(modalElem);
    if (modal) modal.hide();

    await refreshAllData();

  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาดในการแก้ไข',
      text: err.message,
      confirmButtonColor: '#0f172a'
    });
  } finally {
    if (btnUpdate) {
      btnUpdate.disabled = false;
      btnUpdate.innerHTML = '<i class="bi bi-save me-1"></i> บันทึกการแก้ไข';
    }
  }
}

export async function deleteLogPo(docId) {
  if (!docId) return;

  const confirmRes = await Swal.fire({
    title: 'ยืนยันการลบ',
    text: `คุณต้องการลบรายการเอกสารเลขที่ "${docId}" ใช่หรือไม่?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'ยืนยันลบ',
    cancelButtonText: 'ยกเลิก'
  });

  if (!confirmRes.isConfirmed) return;

  try {
    const res = await deleteLogPoFromFirestore(docId);
    if (!res.success) throw new Error(res.error);

    Swal.fire({
      icon: 'success',
      title: 'ลบสำเร็จ',
      text: 'ลบรายการเรียบร้อยแล้ว',
      timer: 1500,
      showConfirmButton: false
    });

    await refreshAllData();
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาดในการลบ',
      text: err.message,
      confirmButtonColor: '#0f172a'
    });
  }
}

export function autoFillSupplierData(prefix = 'modal') {
  const searchInput = document.getElementById(`${prefix}_seller_search`);
  if (!searchInput || !searchInput.value) return;

  const queryVal = searchInput.value.trim().toLowerCase();
  const found = suppliersCache.find(s => {
    const name = (s.seller || s.name || s.supplier_name || '').toLowerCase();
    return name === queryVal || name.includes(queryVal);
  });

  if (found) {
    document.getElementById(`${prefix}_seller`).value = found.seller || found.name || found.supplier_name || '';
    document.getElementById(`${prefix}_taxid`).value = found.taxid || '';
    document.getElementById(`${prefix}_ad_ph`).value = found.ad_ph || found.phone || '';
    document.getElementById(`${prefix}_ad_no`).value = found.ad_no || '';
    document.getElementById(`${prefix}_ad_m`).value = found.ad_m || '';
    document.getElementById(`${prefix}_ad_rd`).value = found.ad_rd || '';
    document.getElementById(`${prefix}_ad_tb`).value = found.ad_tb || '';
    document.getElementById(`${prefix}_ad_mu`).value = found.ad_mu || '';
    document.getElementById(`${prefix}_ad_pr`).value = found.ad_pr || '';
    document.getElementById(`${prefix}_postid`).value = found.postid || '';
    document.getElementById(`${prefix}_bidder_name`).value = found.bidder_name || '';
  }
}

async function refreshAllData() {
  await getLogPoDataFromFirestore();
  renderPoTable();
}

export function resetFormToMain() {
  window.location.href = "index.html";
}

// ============================================================================
// 🚀 DOM READY & INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([
    getLogPoDataFromFirestore(),
    getHolidaysFromFirestore(),
    getSuppliersFromFirestore()
  ]);
  renderPoTable();
});

// ============================================================================
// 🌐 ATTACH TO WINDOW FOR HTML EVENT HANDLERS & GLOBAL USAGE
// ============================================================================
window.generateLogPoNumber = generateLogPoNumber;
window.normalizeDocType = normalizeDocType;
window.isWorkingDay = isWorkingDay;
window.countWorkingDaysBetween = countWorkingDaysBetween;

window.getLogPoDataFromFirestore = getLogPoDataFromFirestore;
window.getHolidaysFromFirestore = getHolidaysFromFirestore;
window.saveLogPoToFirestore = saveLogPoToFirestore;
window.updatePoCounter = updatePoCounter;
window.updateLogPoInFirestore = updateLogPoInFirestore;
window.deleteLogPoFromFirestore = deleteLogPoFromFirestore;

window.switchPoTab = switchPoTab;
window.openManualPoModal = openManualPoModal;
window.previewAutoPoNumber = previewAutoPoNumber;
window.saveManualLogPo = saveManualLogPo;
window.openEditPoModal = openEditPoModal;
window.updateLogPoData = updateLogPoData;
window.deleteLogPo = deleteLogPo;
window.autoFillSupplierData = autoFillSupplierData;
window.resetFormToMain = resetFormToMain;