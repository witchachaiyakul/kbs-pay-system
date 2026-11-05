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
let currentPoTab = 'po'; // 'po', 'wo', 'fpo'
let allPoCache = [];
let suppliersCache = [];

const TYPE_PREFIX = {
  po: 'ซ.',
  wo: 'จ.',
  fpo: 'น.'
};

const TYPE_LABEL = {
  po: '(ใบสั่งซื้อ)',
  wo: '(ใบสั่งจ้าง)',
  fpo: '(สั่งซื้อน้ำมัน)'
};

// ============================================================================
// 🎯 1. ดึงข้อมูล log_po ทั้งหมดจาก FIRESTORE
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
    return list;
  } catch (err) {
    console.error("❌ Error getLogPoDataFromFirestore:", err);
    return [];
  }
}

// ============================================================================
// 🎯 2. ดึงข้อมูลวันหยุด HOLIDAYS ทั้งหมดจาก FIRESTORE
// ============================================================================
export async function getHolidaysFromFirestore() {
  try {
    const querySnapshot = await getDocs(collection(db, "holidays"));
    const list = [];

    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      list.push(data.date || docSnap.id);
    });

    return list;
  } catch (err) {
    console.error("❌ Error getHolidaysFromFirestore:", err);
    return [];
  }
}

// ============================================================================
// 🎯 3. ดึงข้อมูลผู้ขาย/ร้านค้า (SUPPLIERS) สำหรับ Auto-complete
// ============================================================================
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
// 🎯 4. บันทึกข้อมูล LOG_PO และอัปเดต COUNTER
// ============================================================================
export async function saveLogPoToFirestore(poData, docId) {
  try {
    if (!poData || !docId) {
      return { success: false, error: 'ข้อมูลไม่สมบูรณ์ (Missing poData or docId)' };
    }

    const cleanData = {
      ...poData,
      base_no: Number(poData.base_no) || 0,
      sub_no: Number(poData.sub_no) || 0,
      year_be: Number(poData.year_be) || (new Date().getFullYear() + 543),
      total: Number(String(poData.total || 0).replace(/,/g, '')) || 0,
      postid: Number(poData.postid) || 0,
      seller2: poData.seller2 || '',
      seller3: poData.seller3 || '',
      updated_at: new Date().toISOString()
    };

    // 1. บันทึกเข้าคอลเลกชัน log_po
    const poRef = doc(db, "log_po", docId);
    await setDoc(poRef, cleanData, { merge: true });

    // 2. อัปเดตตัวนับ Counter
    await updatePoCounter(cleanData.doc_type, cleanData.year_be, cleanData.base_no, cleanData.sub_no, cleanData.pr_date);

    return { success: true };
  } catch (err) {
    console.error("❌ Error saveLogPoToFirestore:", err);
    return { success: false, error: err.message };
  }
}

// ============================================================================
// 🎯 5. อัปเดต PO COUNTER
// ============================================================================
export async function updatePoCounter(docType, yearBe, baseNo, subNo, prDate) {
  try {
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
      console.log(`✅ อัปเดต po_counter [${counterDocId}] เป็น base_no: ${newBase}, sub_no: ${newSub}`);
    }
  } catch (err) {
    console.warn("⚠️ Warning updatePoCounter:", err);
  }
}

// ============================================================================
// 🎯 6. อัปเดตข้อมูล LOG_PO เอกสารเดิม
// ============================================================================
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

// ============================================================================
// 🎯 7. ลบข้อมูล LOG_PO
// ============================================================================
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
// 🖥️ 8. UI HANDLERS & TABLE RENDER
// ============================================================================

export function switchPoTab(type, btnElement) {
  currentPoTab = type;

  // ปรับ active class ของปุ่ม Tab
  document.querySelectorAll('.nav-po-type').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');

  // อัปเดต Label แสดงประเภทปัจจุบัน
  const labelElem = document.getElementById('currentTypeLabel');
  if (labelElem) labelElem.innerText = TYPE_LABEL[type] || '(ใบสั่งซื้อ)';

  renderPoTable();
}

export function renderPoTable() {
  const tbody = document.getElementById('poDataTableBody');
  if (!tbody) return;

  const filtered = allPoCache.filter(item => {
    const dType = (item.doc_type || '').toLowerCase();
    const logPo = (item.log_po || item.id || '').toLowerCase();

    if (currentPoTab === 'po') {
      return dType === 'po' || logPo.startsWith('ซ.');
    } else if (currentPoTab === 'wo') {
      return dType === 'wo' || logPo.startsWith('จ.');
    } else if (currentPoTab === 'fpo') {
      return dType === 'fpo' || logPo.startsWith('น.');
    }
    return true;
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

  tbody.innerHTML = filtered.map(item => {
    const docId = item.id || item.log_po;
    const poNum = item.log_po || item.id || '-';
    const prDate = item.pr_date || '-';
    const details = item.details || item.list || '-';
    const seller = item.seller || item.seller_name || '-';
    const total = Number(item.total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
    const division = item.division || '-';
    const egpNo = item.egp_no || item.egp || '-';
    const source = item.source || 'Manual';

    return `
      <tr>
        <td class="fw-bold text-primary">${poNum}</td>
        <td class="small text-nowrap">${prDate}</td>
        <td class="text-start small text-wrap text-break" style="max-width: 240px;">${details}</td>
        <td class="small text-start text-wrap text-break" style="max-width: 180px;">${seller}</td>
        <td class="text-end fw-bold text-dark text-nowrap">${total}</td>
        <td class="small text-nowrap">${division}</td>
        <td class="small text-nowrap">${egpNo}</td>
        <td><span class="badge ${source === 'Manual' ? 'bg-secondary' : 'bg-info text-dark'}">${source}</span></td>
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
// 🔢 9. คำนวณเลข PO/WO/FPO ถัดไปอัตโนมัติ
// ============================================================================

export async function previewAutoPoNumber() {
  const previewElem = document.getElementById('previewPoNumber');
  if (!previewElem) return;

  const docType = document.getElementById('modal_doc_type')?.value || 'po';
  const prDateVal = document.getElementById('modal_pr_date')?.value;

  let yearBe = new Date().getFullYear() + 543;
  if (prDateVal) {
    const d = new Date(prDateVal);
    if (!isNaN(d.getTime())) {
      yearBe = d.getFullYear() + 543;
    }
  }

  const shortYear = String(yearBe).slice(-2);
  const prefix = TYPE_PREFIX[docType] || 'ซ.';

  try {
    // 1. ลองดึงจาก po_counters
    const counterDocId = `${docType}_${yearBe}`;
    const counterRef = doc(db, "po_counters", counterDocId);
    const counterSnap = await getDoc(counterRef);

    let nextBaseNo = 1;
    if (counterSnap.exists()) {
      const data = counterSnap.data();
      nextBaseNo = (Number(data.last_base_no) || 0) + 1;
    } else {
      // 2. ถ้าไม่มี counter ให้ค้นหาเลขสูงสุดจาก log_po ในปีนั้น
      const sameTypeItems = allPoCache.filter(item => {
        return (item.doc_type === docType || (item.log_po || '').startsWith(prefix)) &&
               Number(item.year_be) === yearBe;
      });

      if (sameTypeItems.length > 0) {
        const maxBase = Math.max(...sameTypeItems.map(i => Number(i.base_no) || 0));
        nextBaseNo = maxBase + 1;
      }
    }

    const generatedPoNo = `${prefix}${nextBaseNo}/${shortYear}`;
    previewElem.innerText = generatedPoNo;
    previewElem.dataset.baseNo = nextBaseNo;
    previewElem.dataset.yearBe = yearBe;
    previewElem.dataset.logPo = generatedPoNo;

  } catch (err) {
    console.warn("⚠️ คํานวณเลข PO อัตโนมัติล้มเหลว:", err);
    previewElem.innerText = `${prefix}1/${String(yearBe).slice(-2)}`;
  }
}

// ============================================================================
// ➕ 10. OPEN MODAL & SAVE MANUAL LOG PO
// ============================================================================

export function openManualPoModal() {
  const form = document.getElementById('poManualForm');
  if (form) form.reset();

  const modalDocType = document.getElementById('modal_doc_type');
  if (modalDocType) modalDocType.value = currentPoTab;

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
    const previewElem = document.getElementById('previewPoNumber');
    const logPo = previewElem?.dataset.logPo || previewElem?.innerText;
    const baseNo = Number(previewElem?.dataset.baseNo || 1);
    const yearBe = Number(previewElem?.dataset.yearBe || (new Date().getFullYear() + 543));

    const docType = document.getElementById('modal_doc_type').value;
    const prDate = document.getElementById('modal_pr_date').value;
    const details = document.getElementById('modal_details').value;
    const total = Number(document.getElementById('modal_total').value || 0);
    const division = document.getElementById('modal_division').value;
    const egpNo = document.getElementById('modal_egp_no').value || '';
    const poDate = document.getElementById('modal_po_date').value || '';
    const seller = document.getElementById('modal_seller').value;
    const taxid = document.getElementById('modal_taxid').value || '';
    const adPh = document.getElementById('modal_ad_ph').value || '';
    const adNo = document.getElementById('modal_ad_no').value || '';
    const adM = document.getElementById('modal_ad_m').value || '';
    const adRd = document.getElementById('modal_ad_rd').value || '';
    const adTb = document.getElementById('modal_ad_tb').value || '';
    const adMu = document.getElementById('modal_ad_mu').value || '';
    const adPr = document.getElementById('modal_ad_pr').value || '';
    const postid = document.getElementById('modal_postid').value || '';
    const bidderName = document.getElementById('modal_bidder_name').value || '';

    const poData = {
      log_po: logPo,
      doc_type: docType,
      base_no: baseNo,
      sub_no: 0,
      year_be: yearBe,
      pr_date: prDate,
      po_date: poDate,
      details: details,
      total: total,
      division: division,
      egp_no: egpNo,
      seller: seller,
      taxid: taxid,
      ad_ph: adPh,
      ad_no: adNo,
      ad_m: adM,
      ad_rd: adRd,
      ad_tb: adTb,
      ad_mu: adMu,
      ad_pr: adPr,
      postid: postid,
      bidder_name: bidderName,
      source: 'Manual',
      createdAt: new Date().toISOString()
    };

    const res = await saveLogPoToFirestore(poData, logPo);
    if (!res.success) throw new Error(res.error);

    alert(`✅ บันทึกและออกเลขเอกสารสำเร็จ: ${logPo}`);

    const modalElem = document.getElementById('manualPoModal');
    const modal = bootstrap.Modal.getInstance(modalElem);
    if (modal) modal.hide();

    await refreshAllData();

  } catch (err) {
    alert('❌ เกิดข้อผิดพลาดในการบันทึก: ' + err.message);
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="bi bi-save me-1"></i> ยืนยันออกเลขและบันทึก';
    }
  }
}

// ============================================================================
// ✏️ 11. EDIT & UPDATE LOG PO
// ============================================================================

export function openEditPoModal(docId) {
  const item = allPoCache.find(i => String(i.id || i.log_po) === String(docId));
  if (!item) {
    alert('❌ ไม่พบข้อมูลเอกสารรายการนี้');
    return;
  }

  document.getElementById('edit_doc_id').value = item.id || item.log_po;
  document.getElementById('edit_doc_type').value = item.doc_type || 'po';
  document.getElementById('edit_log_po').value = item.log_po || item.id || '';
  document.getElementById('edit_pr_date').value = item.pr_date || '';
  document.getElementById('edit_details').value = item.details || item.list || '';
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

    alert('✅ แก้ไขข้อมูลเรียบร้อยแล้ว');

    const modalElem = document.getElementById('editPoModal');
    const modal = bootstrap.Modal.getInstance(modalElem);
    if (modal) modal.hide();

    await refreshAllData();

  } catch (err) {
    alert('❌ เกิดข้อผิดพลาดในการแก้ไข: ' + err.message);
  } finally {
    if (btnUpdate) {
      btnUpdate.disabled = false;
      btnUpdate.innerHTML = '<i class="bi bi-save me-1"></i> บันทึกการแก้ไข';
    }
  }
}

// ============================================================================
// 🗑️ 12. DELETE LOG PO
// ============================================================================

export async function deleteLogPo(docId) {
  if (!docId) return;
  if (!confirm(`⚠️ คุณต้องการลบรายการเอกสารเลขที่ "${docId}" ใช่หรือไม่?`)) return;

  try {
    const res = await deleteLogPoFromFirestore(docId);
    if (!res.success) throw new Error(res.error);

    alert('✅ ลบรายการสำเร็จ');
    await refreshAllData();
  } catch (err) {
    alert('❌ เกิดข้อผิดพลาดในการลบ: ' + err.message);
  }
}

// ============================================================================
// 🏪 13. AUTO-FILL SUPPLIER DATA
// ============================================================================

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

// ============================================================================
// 🔄 14. REFRESH & NAVIGATE
// ============================================================================

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
    getSuppliersFromFirestore()
  ]);
  renderPoTable();
});

// ============================================================================
// 🌐 ATTACH TO WINDOW FOR HTML EVENT HANDLERS
// ============================================================================
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