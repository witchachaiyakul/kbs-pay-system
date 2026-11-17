// public/js/parcel.js
import { db } from "./firestore.js";
import { 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    query, 
    limit,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 PARCEL MANAGEMENT GLOBAL STATE & CACHE
// ============================================================================
let allParcelsCache = [];      // เก็บรายการพัสดุที่แตกแถว (Expanded Units)
let assetCategoriesCache = []; // เก็บหมวดหมู่หลักและหมวดหมู่ย่อยจาก collection "asset"

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
  return `${yearBE}-${month}-${day}`;
}

// ============================================================================
// 📂 1. โหลดหมวดหมู่พัสดุ (Collection: asset)
// ============================================================================
export async function loadAssetCategories() {
  try {
    const snap = await getDocs(collection(db, "asset"));
    const list = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      list.push({
        id: docSnap.id,
        name: data.name || data.category_name || docSnap.id,
        name_id: data.name_id || "01",
        subcategories: Array.isArray(data.subcategories) ? data.subcategories : []
      });
    });

    // เรียงตามรหัสหมวดหมู่หลัก name_id
    list.sort((a, b) => String(a.name_id).localeCompare(String(b.name_id)));
    assetCategoriesCache = list;

    populateHeaderAssetDropdown();
    console.log("✅ โหลดหมวดหมู่ assets และ subcategories สำเร็จ:", assetCategoriesCache);
  } catch (err) {
    console.error("❌ โหลดข้อมูลหมวดหมู่ assets ล้มเหลว:", err);
  }
}

// 🎯 ฟังก์ชันทำงานเมื่อเลือกหมวดหมู่หลักรายแถว -> สร้างตัวเลือกหมวดหมู่ย่อย
export function onMainAssetChange(selectElem, uid) {
  const assetId = selectElem.value;
  const subcatSelect = document.querySelector(`.parcel-subcat-select[data-uid="${uid}"]`);
  if (!subcatSelect) return;

  if (!assetId) {
    subcatSelect.innerHTML = `<option value="">-- เลือกหมวดหมู่ย่อย --</option>`;
    subcatSelect.disabled = true;
    updateAllParcelPreviews();
    return;
  }

  const selectedAsset = assetCategoriesCache.find(a => a.id === assetId);
  const subList = selectedAsset ? selectedAsset.subcategories : [];

  if (subList.length > 0) {
    const options = subList.map(sub => {
      const subCode = sub.code || sub.subcategories_code || "01";
      const subName = sub.name || sub.subcategories_name || subCode;
      return `<option value="${subCode}">${subName} (${subCode})</option>`;
    }).join('');

    subcatSelect.innerHTML = `<option value="">-- เลือกหมวดหมู่ย่อย --</option>` + options;
    subcatSelect.disabled = false;
  } else {
    subcatSelect.innerHTML = `<option value="01">ทั่วไป (01)</option>`;
    subcatSelect.disabled = false;
  }

  updateAllParcelPreviews();
}

// ============================================================================
// 🔍 2. ดึงข้อมูลเอกสาร นผ.2 จาก log_pay (Backend)
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
// 🏷️ 3. ออกเลขพัสดุอัตโนมัติ (Backend Transaction)
// ============================================================================
export async function generateParcelNumbersBackend(selectedItems, yearBE) {
  try {
    if (!selectedItems || selectedItems.length === 0) {
      return { success: false, message: 'ไม่ได้เลือกรายการพัสดุ' };
    }

    const year2Digits = String(yearBE).slice(-2);

    // จัดกลุ่มรายการตาม log_no
    const logNoGroups = {};
    const uniqueCounterKeys = new Set();

    selectedItems.forEach(item => {
      if (!logNoGroups[item.log_no]) {
        logNoGroups[item.log_no] = [];
      }
      logNoGroups[item.log_no].push(item);

      const nameId = item.name_id || "01";
      const subcatCode = item.subcategories_code || "01";
      uniqueCounterKeys.add(`${nameId}_${subcatCode}_${year2Digits}`);
    });

    const logNos = Object.keys(logNoGroups);
    const counterKeys = Array.from(uniqueCounterKeys);

    await runTransaction(db, async (transaction) => {
      // ✅ 1. อ่านเอกสาร log_parcels และ asset_counters ทั้งหมดพร้อมกันในรอบเดียว (Parallel Reads)
      const logParcelRefs = logNos.map(logNo => doc(db, "log_parcels", logNo));
      const counterRefs = counterKeys.map(key => doc(db, "asset_counters", key));

      const [logParcelSnaps, counterSnaps] = await Promise.all([
        Promise.all(logParcelRefs.map(ref => transaction.get(ref))),
        Promise.all(counterRefs.map(ref => transaction.get(ref)))
      ]);

      // เก็บค่าลำดับล่าสุดของแต่ละหมวดหมู่ไว้ใน RAM
      const seqMap = {};
      counterKeys.forEach((key, idx) => {
        const snap = counterSnaps[idx];
        seqMap[key] = snap.exists() ? (Number(snap.data().seq) || 0) : 0;
      });

      // ✅ 2. คำนวณเลขและเตรียมข้อมูลทั้งหมดใน RAM (ไม่ต้องรอ Network)
      logNos.forEach((logNo, idx) => {
        const itemsToProcess = logNoGroups[logNo];
        const logParcelSnap = logParcelSnaps[idx];
        const logParcelRef = logParcelRefs[idx];

        let existingParcelArray = [];
        if (logParcelSnap.exists() && Array.isArray(logParcelSnap.data().parcel_no)) {
          existingParcelArray = [...logParcelSnap.data().parcel_no];
        }

        const firstItem = itemsToProcess[0];

        for (const item of itemsToProcess) {
          const subcatCode = item.subcategories_code || "01";
          const nameId = item.name_id || "01";
          const counterDocId = `${nameId}_${subcatCode}_${year2Digits}`;

          // รันเลขใน RAM ทันที
          seqMap[counterDocId]++;
          const seqFormatted = String(seqMap[counterDocId]).padStart(2, '0');
          const generatedParcelNo = `กภกบ.${nameId}-${subcatCode}-${seqFormatted}/${year2Digits}`;

          const newParcelMapObj = {
            id: generatedParcelNo,
            uid: item.uid,
            division: item.division || '-',
            cr_date: item.cr_date || '-',
            pr_type: item.pr_type || 'ซื้อ',
            asset_id: item.asset_id,
            name_id: nameId,
            subcategories_code: subcatCode,
            item_name: item.item_name,
            unit_index: item.unit_index,
            unit_price: item.unit_price,
            unit_name: item.unit_name,
            status: "registered",
            issued_to: "",
            issued_date: ""
          };

          const existingIdx = existingParcelArray.findIndex(p => p.uid === item.uid);
          if (existingIdx >= 0) {
            existingParcelArray[existingIdx] = newParcelMapObj;
          } else {
            existingParcelArray.push(newParcelMapObj);
          }
        }

        // สั่งเขียน log_parcels (1 เอกสารต่อ 1 เลข นผ.2)
        transaction.set(logParcelRef, {
          created_at: serverTimestamp(),
          fund_type: firstItem.fund_type || "งบประมาณ",
          division: firstItem.division || "-",
          cr_date: firstItem.cr_date || "-",
          log_no_ref: logNo,
          status: "registered",
          year_be: yearBE,
          parcel_no: existingParcelArray
        }, { merge: true });
      });

      // ✅ 3. สั่งเขียนอัปเดตตัวนับล่าสุดเฉพาะหมวดหมู่ที่ถูกใช้งาน (1 เอกสารต่อ 1 หมวดหมู่)
      counterKeys.forEach((key, idx) => {
        const [nameId, subcatCode] = key.split('_');
        transaction.set(counterRefs[idx], {
          name_id: nameId,
          subcategories_code: subcatCode,
          year_be_short: year2Digits,
          seq: seqMap[key],
          updated_at: serverTimestamp()
        }, { merge: true });
      });
    });

    return { success: true, message: `ออกเลขพัสดุสำเร็จจำนวน ${selectedItems.length} รายการ` };
  } catch (err) {
    console.error("❌ Error generateParcelNumbersBackend:", err);
    return { success: false, message: err.message };
  }
}

// ============================================================================
// 🖥️ 4. FRONTEND UI & DATA LOADING
// ============================================================================
export async function loadParcelDataFromLogPay(isRefresh = false) {
  const tbody = document.getElementById("parcelTableBody");
  const searchInput = document.getElementById("parcelSearchLogNo");

  // หากกดปุ่ม "รีเฟรชข้อมูล" ให้ล้างช่องค้นหาและรีเซ็ตตัวเลือกส่วนหัวตาราง
  if (isRefresh && searchInput) {
    searchInput.value = "";
  }
  resetHeaderAssetDropdowns();

  const currentStatusFilter = document.getElementById("parcelFilterStatus")?.value ?? "pending";

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" class="text-center py-4 text-muted">
          <div class="spinner-border spinner-border-sm text-primary me-2"></div> กำลังดึงและประมวลผลรายการพัสดุ...
        </td>
      </tr>
    `;
  }

  try {
    if (assetCategoriesCache.length === 0) {
      await loadAssetCategories();
    }

    const expandedList = [];
    const registeredUidSet = new Set();

    // ------------------------------------------------------------------------
    // 1. ดึงข้อมูลจาก log_parcels (รายการที่ออกเลขแล้ว)
    // ------------------------------------------------------------------------
    const parcelSnap = await getDocs(collection(db, "log_parcels"));
    parcelSnap.forEach(docSnap => {
      const data = docSnap.data();
      const logNo = data.log_no_ref || docSnap.id;
      const division = data.division || '-';
      const parcelArray = Array.isArray(data.parcel_no) ? data.parcel_no : [];

      parcelArray.forEach(p => {
        if (p.uid) registeredUidSet.add(p.uid);

        if (currentStatusFilter === "registered" || currentStatusFilter === "") {
          expandedList.push({
            uid: p.uid || `${logNo}_registered_${Math.random()}`,
            log_no: logNo,
            division: p.division || division,
            cr_date: p.cr_date || data.cr_date || formatThaiDateShort(data.created_at) || '-',
            pr_type: p.pr_type || 'ซื้อ',
            item_name: p.item_name || 'พัสดุ',
            unit_index: p.unit_index || '1/1',
            unit_price: Number(p.unit_price || 0),
            unit_name: p.unit_name || 'รายการ',
            selected_asset_id: p.asset_id || '',
            subcategories_code: p.subcategories_code || '',
            parcel_no_str: p.id || p.parcel_no || '-',
            status: 'registered'
          });
        }
      });
    });

    // ------------------------------------------------------------------------
    // 2. ดึงข้อมูลจาก log_pay (รายการที่รอออกเลขพัสดุ)
    // ------------------------------------------------------------------------
    if (currentStatusFilter === "pending" || currentStatusFilter === "") {
      const logPayRes = await getLogPayForParcels(searchInput?.value || "");
      if (logPayRes.success && Array.isArray(logPayRes.data)) {
        logPayRes.data.forEach(payDoc => {
          const logNo = payDoc.log_no || payDoc.id;
          const division = payDoc.division || payDoc.dept || payDoc.department || payDoc.ฝ่าย || '-';
          const fundType = payDoc.fund_type || payDoc.budget_type || 'งบประมาณ';

          let crDate = '-';
          if (payDoc.cr_date && payDoc.cr_date !== 'cr_date') {
            crDate = payDoc.cr_date;
          } else if (payDoc.date) {
            crDate = payDoc.date;
          } else if (payDoc.createdAt) {
            crDate = formatThaiDateShort(payDoc.createdAt);
          }

          let items = [];
          if (Array.isArray(payDoc.items) && payDoc.items.length > 0) {
            items = payDoc.items;
          } else if (Array.isArray(payDoc.equipmentItems) && payDoc.equipmentItems.length > 0) {
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

          if (items.length === 0) {
            const detailName = payDoc.to || payDoc.details || payDoc.activities || payDoc.project_name || payDoc.remark || 'พัสดุจัดซื้อ';
            const priceVal = payDoc.financial?.total || payDoc.budget_use || payDoc.amount || payDoc.total || payDoc.price || 0;
            items.push({
              list: detailName,
              qu: payDoc.quantity || payDoc.qty || 1,
              pr: priceVal,
              un: payDoc.unit || payDoc.unit_name || 'รายการ'
            });
          }

          items.forEach((item, itemIdx) => {
            const qty = parseInt(item.qu, 10) || 1;
            const itemName = item.list || item.equipment || 'พัสดุ';
            const price = parseFloat(item.pr) || 0;
            const unit = item.un || 'หน่วย';

            const rawPrType = item.pr_type || payDoc.method || payDoc.purchase_type || 'ซื้อ';
            const cleanPrType = String(rawPrType).includes('จ้าง') ? 'จ้าง' : 'ซื้อ';

            for (let u = 1; u <= qty; u++) {
              const uid = `${logNo}_item${itemIdx + 1}_unit${u}`;

              if (!registeredUidSet.has(uid)) {
                expandedList.push({
                  uid: uid,
                  log_no: logNo,
                  division: division,
                  fund_type: fundType,
                  cr_date: crDate,
                  pr_type: cleanPrType,
                  item_name: itemName,
                  unit_index: `${u}/${qty}`,
                  unit_price: price,
                  unit_name: unit,
                  selected_asset_id: '',
                  subcategories_code: '',
                  parcel_no_str: '-',
                  status: 'pending'
                });
              }
            }
          });
        });
      }
    }

    allParcelsCache = expandedList;
    filterParcelTable();

  } catch (err) {
    console.error("❌ Error loadParcelDataFromLogPay:", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

// ============================================================================
// 🎯 5. FILTERING & TABLE RENDER
// ============================================================================
export function filterParcelTable() {
  const divFilter = document.getElementById("parcelFilterDivision")?.value || "";
  const statusFilter = document.getElementById("parcelFilterStatus")?.value || "";
  const searchVal = (document.getElementById("parcelSearchLogNo")?.value || "").trim().toLowerCase();

  const filtered = allParcelsCache.filter(item => {
    const matchDiv = !divFilter || (item.division || "").includes(divFilter);
    const matchStatus = !statusFilter || item.status === statusFilter;
    const matchSearch = !searchVal ||
                        (item.log_no || "").toLowerCase().includes(searchVal) ||
                        (item.item_name || "").toLowerCase().includes(searchVal) ||
                        (item.parcel_no_str || "").toLowerCase().includes(searchVal);

    return matchDiv && matchStatus && matchSearch;
  });

  renderParcelTable(filtered);
}

function renderParcelTable(list) {
  const tbody = document.getElementById("parcelTableBody");
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-muted">ไม่พบรายการพัสดุที่ตรงตามเงื่อนไข</td></tr>`;
    updateSelectionCounts();
    return;
  }

  tbody.innerHTML = list.map(item => {
    const isPending = item.status === 'pending';
    const statusBadge = isPending
      ? `<span class="badge bg-secondary">รอออกเลขพัสดุ</span>`
      : `<span class="badge bg-success">ออกเลขพัสดุแล้ว</span>`;

    const formattedPrice = Number(item.unit_price).toLocaleString('th-TH', { minimumFractionDigits: 2 });

    const categoryOptions = assetCategoriesCache.map(cat => {
      const selected = item.selected_asset_id === cat.id ? 'selected' : '';
      return `<option value="${cat.id}" data-nameid="${cat.name_id}" ${selected}>${cat.name} (${cat.name_id})</option>`;
    }).join('');

    let subcatOptions = `<option value="">-- เลือกหมวดหมู่ย่อย --</option>`;
    let subcatDisabled = 'disabled';

    if (item.selected_asset_id) {
      const selectedAsset = assetCategoriesCache.find(a => a.id === item.selected_asset_id);
      if (selectedAsset && selectedAsset.subcategories.length > 0) {
        subcatOptions += selectedAsset.subcategories.map(sub => {
          const subCode = sub.code || sub.subcategories_code || "01";
          const subName = sub.name || sub.subcategories_name || subCode;
          const selected = item.subcategories_code === subCode ? 'selected' : '';
          return `<option value="${subCode}" ${selected}>${subName} (${subCode})</option>`;
        }).join('');
        subcatDisabled = '';
      } else {
        subcatOptions = `<option value="01" selected>ทั่วไป (01)</option>`;
        subcatDisabled = '';
      }
    }

    const isInputDisabled = !isPending ? 'disabled' : '';

    const prTypeBadge = item.pr_type === 'จ้าง'
      ? `<span class="badge bg-warning text-dark fw-bold">จ้าง</span>`
      : `<span class="badge bg-info text-dark fw-bold">ซื้อ</span>`;

    return `
      <tr>
        <td class="text-center">
          <input type="checkbox" class="parcel-checkbox" data-uid="${item.uid}" data-logno="${item.log_no}" data-status="${item.status}" 
                 ${!isPending ? 'disabled' : ''} onchange="onParcelCheckboxChange()">
        </td>
        <td class="text-center fw-bold text-primary">${item.log_no}</td>
        <td class="small">${item.division}</td>
        <td class="text-center small">${item.cr_date}</td>
        <td class="text-center">${prTypeBadge}</td>
        <td class="fw-bold">${item.item_name}</td>
        <td class="text-center small">${item.unit_index}</td>
        <td>
          <select class="form-select form-select-sm parcel-asset-select mb-1" data-uid="${item.uid}" onchange="onMainAssetChange(this, '${item.uid}')" ${isInputDisabled}>
            <option value="">-- เลือกหมวดหมู่หลัก --</option>
            ${categoryOptions}
          </select>
          <select class="form-select form-select-sm parcel-subcat-select" data-uid="${item.uid}" onchange="previewParcelNumber('${item.uid}')" ${subcatDisabled} ${isInputDisabled}>
            ${subcatOptions}
          </select>
        </td>
        <td class="text-end fw-bold">${formattedPrice}</td>
        <td class="text-center small">${item.unit_name}</td>
        <td class="text-center fw-bold text-dark parcel-no-display" data-uid="${item.uid}">${item.parcel_no_str}</td>
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
  const checkboxes = document.querySelectorAll(".parcel-checkbox:not(:disabled)");
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

  checkboxes.forEach(cb => {
    if (cb.dataset.status === 'pending') regCount++;
  });

  const spanReg = document.getElementById("selectedCountReg");
  if (spanReg) spanReg.textContent = regCount;
}

// ============================================================================
// ⚡ 7. ACTION HANDLER: GENERATE PARCEL NUMBERS
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

  const selectedItems = [];
  let missingCategory = false;

  pendingBoxes.forEach(cb => {
    const uid = cb.dataset.uid;
    const logNo = cb.dataset.logno;
    const cacheItem = allParcelsCache.find(i => i.uid === uid);

    const mainSelect = document.querySelector(`.parcel-asset-select[data-uid="${uid}"]`);
    const subcatSelect = document.querySelector(`.parcel-subcat-select[data-uid="${uid}"]`);

    const mainOpt = mainSelect ? mainSelect.options[mainSelect.selectedIndex] : null;
    const subcatCode = subcatSelect ? subcatSelect.value : "";

    if (!mainSelect || !mainSelect.value || !subcatCode) {
      missingCategory = true;
    } else {
      selectedItems.push({
        uid: uid,
        log_no: logNo,
        division: cacheItem?.division || '-',
        fund_type: cacheItem?.fund_type || 'งบประมาณ',
        cr_date: cacheItem?.cr_date || '-',
        pr_type: cacheItem?.pr_type || 'ซื้อ',
        item_name: cacheItem?.item_name || 'พัสดุ',
        unit_index: cacheItem?.unit_index || '1/1',
        unit_price: cacheItem?.unit_price || 0,
        unit_name: cacheItem?.unit_name || 'รายการ',
        asset_id: mainSelect.value,
        name_id: mainOpt?.dataset.nameid || '01',
        subcategories_code: subcatCode
      });
    }
  });

  if (missingCategory) {
    Swal.fire({
      icon: 'warning',
      title: 'ข้อมูลไม่ครบถ้วน',
      text: 'กรุณาเลือกทั้ง "หมวดหมู่หลัก" และ "หมวดหมู่ย่อย" ให้ครบถ้วนทุกรายการที่เลือก',
      confirmButtonColor: '#0f172a'
    });
    return;
  }

  const yearBE = document.getElementById("parcelYearBE")?.value || "2569";

  const confirmRes = await Swal.fire({
    title: 'ยืนยันการออกเลขพัสดุ',
    text: `ต้องการออกเลขพัสดุจำนวน ${selectedItems.length} รายการ (ปีงบประมาณ ${yearBE}) ใช่หรือไม่?`,
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

  const res = await generateParcelNumbersBackend(selectedItems, yearBE);

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
// 🔢 8. PREVIEW & HEADER BULK CATEGORY CHANGE
// ============================================================================
export async function updateAllParcelPreviews() {
  const rows = Array.from(document.querySelectorAll('.parcel-asset-select:not([disabled])'));
  if (rows.length === 0) return;

  const yearBE = document.getElementById("parcelYearBE")?.value || "2569";
  const year2Digits = String(yearBE).slice(-2);

  // 1. รวบรวม Key ของหมวดหมู่ที่ไม่ซ้ำกันทั้งหมดก่อน
  const uniqueKeys = new Set();
  rows.forEach(mainSelect => {
    const uid = mainSelect.dataset.uid;
    const subcatSelect = document.querySelector(`.parcel-subcat-select[data-uid="${uid}"]`);
    const mainOpt = mainSelect.options[mainSelect.selectedIndex];
    const nameId = mainOpt?.dataset.nameid || "";
    const subcatCode = subcatSelect?.value || "";

    if (nameId && subcatCode) {
      uniqueKeys.add(`${nameId}_${subcatCode}_${year2Digits}`);
    }
  });

  // 2. ดึงค่า Counter จาก Firestore พร้อมกันทุกหมวดหมู่ในครั้งเดียว
  const baseCounterMap = {};
  const keysArray = Array.from(uniqueKeys);
  if (keysArray.length > 0) {
    const snaps = await Promise.all(
      keysArray.map(key => getDoc(doc(db, "asset_counters", key)))
    );
    keysArray.forEach((key, idx) => {
      baseCounterMap[key] = snaps[idx].exists() ? (Number(snaps[idx].data().seq) || 0) : 0;
    });
  }

  // 3. คำนวณและแสดงผลบนตารางทันที
  for (const mainSelect of rows) {
    const uid = mainSelect.dataset.uid;
    const subcatSelect = document.querySelector(`.parcel-subcat-select[data-uid="${uid}"]`);
    const displayTd = document.querySelector(`.parcel-no-display[data-uid="${uid}"]`);

    if (!subcatSelect || !displayTd) continue;

    const mainOpt = mainSelect.options[mainSelect.selectedIndex];
    const nameId = mainOpt?.dataset.nameid || "";
    const subcatCode = subcatSelect.value;

    if (!nameId || !subcatCode) {
      displayTd.innerHTML = `-`;
      continue;
    }

    const counterKey = `${nameId}_${subcatCode}_${year2Digits}`;
    baseCounterMap[counterKey]++;

    const seqFormatted = String(baseCounterMap[counterKey]).padStart(2, '0');
    const previewNo = `กภกบ.${nameId}-${subcatCode}-${seqFormatted}/${year2Digits}`;

    displayTd.innerHTML = `
      <div class="text-warning-emphasis fw-bold">
        ${previewNo}
        <br><small class="text-muted fw-normal" style="font-size: 0.75rem;">(เลขที่จะได้รับ)</small>
      </div>
    `;
  }
}

export function previewParcelNumber(uid) {
  updateAllParcelPreviews();
}

export function populateHeaderAssetDropdown() {
  const headerMain = document.getElementById("headerMainAsset");
  if (!headerMain) return;

  const options = assetCategoriesCache.map(cat => {
    return `<option value="${cat.id}" data-nameid="${cat.name_id}">${cat.name} (${cat.name_id})</option>`;
  }).join('');

  headerMain.innerHTML = `<option value="">-- เปลี่ยนหมวดหมู่หลักทั้งหมด --</option>` + options;
}

function resetHeaderAssetDropdowns() {
  const headerMain = document.getElementById("headerMainAsset");
  const headerSub = document.getElementById("headerSubcatAsset");
  if (headerMain) headerMain.value = "";
  if (headerSub) {
    headerSub.innerHTML = `<option value="">-- เปลี่ยนหมวดหมู่ย่อยทั้งหมด --</option>`;
    headerSub.disabled = true;
  }
}

export async function onHeaderMainAssetChange(headerSelect) {
  const assetId = headerSelect.value;
  const headerSubSelect = document.getElementById("headerSubcatAsset");
  const loadingStatus = document.getElementById("headerAssetLoadingStatus");

  if (!assetId) return;

  headerSelect.disabled = true;
  if (headerSubSelect) headerSubSelect.disabled = true;
  if (loadingStatus) loadingStatus.classList.remove("d-none");

  await new Promise(resolve => setTimeout(resolve, 50));

  try {
    if (headerSubSelect) {
      const selectedAsset = assetCategoriesCache.find(a => a.id === assetId);
      const subList = selectedAsset ? selectedAsset.subcategories : [];

      if (subList.length > 0) {
        const options = subList.map(sub => {
          const subCode = sub.code || sub.subcategories_code || "01";
          const subName = sub.name || sub.subcategories_name || subCode;
          return `<option value="${subCode}">${subName} (${subCode})</option>`;
        }).join('');
        headerSubSelect.innerHTML = `<option value="">-- เปลี่ยนหมวดหมู่ย่อยทั้งหมด --</option>` + options;
      } else {
        headerSubSelect.innerHTML = `<option value="01">ทั่วไป (01)</option>`;
      }
      headerSubSelect.disabled = false;
    }

    const rowMainSelects = Array.from(document.querySelectorAll('.parcel-asset-select:not([disabled])'));
    for (const selectElem of rowMainSelects) {
      selectElem.value = assetId;
      const uid = selectElem.dataset.uid;
      if (uid) {
        updateRowSubcatOptionsOnly(selectElem, uid);
      }
    }
  } finally {
    headerSelect.disabled = false;
    if (loadingStatus) loadingStatus.classList.add("d-none");
  }
}

function updateRowSubcatOptionsOnly(mainSelectElem, uid) {
  const assetId = mainSelectElem.value;
  const subcatSelect = document.querySelector(`.parcel-subcat-select[data-uid="${uid}"]`);
  if (!subcatSelect) return;

  if (!assetId) {
    subcatSelect.innerHTML = `<option value="">-- เลือกหมวดหมู่ย่อย --</option>`;
    subcatSelect.disabled = true;
    return;
  }

  const selectedAsset = assetCategoriesCache.find(a => a.id === assetId);
  const subList = selectedAsset ? selectedAsset.subcategories : [];

  if (subList.length > 0) {
    const options = subList.map(sub => {
      const subCode = sub.code || sub.subcategories_code || "01";
      const subName = sub.name || sub.subcategories_name || subCode;
      return `<option value="${subCode}">${subName} (${subCode})</option>`;
    }).join('');
    subcatSelect.innerHTML = `<option value="">-- เลือกหมวดหมู่ย่อย --</option>` + options;
    subcatSelect.disabled = false;
  } else {
    subcatSelect.innerHTML = `<option value="01">ทั่วไป (01)</option>`;
    subcatSelect.disabled = false;
  }
}

export async function onHeaderSubcatAssetChange(headerSubSelect) {
  const subcatCode = headerSubSelect.value;
  const headerMainSelect = document.getElementById("headerMainAsset");
  const loadingStatus = document.getElementById("headerAssetLoadingStatus");

  if (!subcatCode) return;

  if (headerMainSelect) headerMainSelect.disabled = true;
  headerSubSelect.disabled = true;
  if (loadingStatus) loadingStatus.classList.remove("d-none");

  await new Promise(resolve => setTimeout(resolve, 50));

  try {
    const rowSubSelects = Array.from(document.querySelectorAll('.parcel-subcat-select:not([disabled])'));
    for (const subSelect of rowSubSelects) {
      subSelect.value = subcatCode;
    }

    await updateAllParcelPreviews();
  } finally {
    if (headerMainSelect) headerMainSelect.disabled = false;
    headerSubSelect.disabled = false;
    if (loadingStatus) loadingStatus.classList.add("d-none");
  }
}

// ============================================================================
// 🚀 AUTO-LOAD ON DOM READY
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  await loadAssetCategories();
  loadParcelDataFromLogPay();
});

// ============================================================================
// 🌐 ATTACH TO WINDOW FOR HTML EVENT LISTENERS
// ============================================================================
window.getLogPayForParcels = getLogPayForParcels;
window.generateParcelNumbersBackend = generateParcelNumbersBackend;
window.loadParcelDataFromLogPay = loadParcelDataFromLogPay;
window.filterParcelTable = filterParcelTable;
window.toggleSelectAllParcels = toggleSelectAllParcels;
window.onParcelCheckboxChange = onParcelCheckboxChange;
window.confirmGenerateParcelIDs = confirmGenerateParcelIDs;
window.resetFormToMain = resetFormToMain;
window.previewParcelNumber = previewParcelNumber;
window.onMainAssetChange = onMainAssetChange;
window.onHeaderMainAssetChange = onHeaderMainAssetChange;
window.onHeaderSubcatAssetChange = onHeaderSubcatAssetChange;
window.updateAllParcelPreviews = updateAllParcelPreviews;