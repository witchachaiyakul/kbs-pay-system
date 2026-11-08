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
let fundTypeCache = {};
let assetCategoriesCache = [];
// ============================================================================
// 🔍 1. ดึงข้อมูลจาก log_pay เพื่อนำไปบริหารพัสดุ (Backend)
// ============================================================================
// Global Cache สำหรับเก็บ Map [ชื่อประเภทเงิน -> คำย่อ] (เช่น "เงินบริจาค": "บร.")

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
    assetCategoriesCache = list;
    
    // 🎯 เติมข้อมูลใส่ Dropdown ส่วนหัวตาราง
    populateHeaderAssetDropdown();

    console.log("✅ โหลดหมวดหมู่ assets และ subcategories สำเร็จ:", assetCategoriesCache);
  } catch (err) {
    console.error("❌ โหลดข้อมูลหมวดหมู่ assets ล้มเหลว:", err);
  }
}

// 🎯 ฟังก์ชันทำงานเมื่อเลือกหมวดหมู่หลัก -> สร้างตัวเลือกหมวดหมู่ย่อย (subcategories)
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

/**
 * 🔄 ดึงข้อมูลประเภทเงินทั้งหมดจาก Collection "fund_type" บน Firestore
 */
export async function loadFundTypesToDropdown() {
  const selectElem = document.getElementById("parcelFundType");
  if (!selectElem) return;

  selectElem.innerHTML = `<option value="">-- กำลังดึงประเภทเงิน... --</option>`;

  try {
    const snap = await getDocs(collection(db, "fund_type"));
    if (snap.empty) {
      selectElem.innerHTML = `<option value="">-- ไม่พบข้อมูลประเภทเงิน --</option>`;
      return;
    }

    const list = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      list.push({
        id: docSnap.id,           // เช่น "fund03"
        name: data.name || "",     // เช่น "เงินบริจาค"
        prefix: data.prefix || "", // เช่น "บร."
        order: Number(data.order) || 99
      });
    });

    // เรียงลำดับตามฟิลด์ order (1, 2, 3...)
    list.sort((a, b) => a.order - b.order);

    selectElem.innerHTML = "";
    fundTypeCache = {};

    list.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.name;
      option.dataset.prefix = item.prefix;
      option.textContent = item.prefix ? `${item.name} (${item.prefix})` : item.name;
      selectElem.appendChild(option);

      // บันทึกลง Cache เพื่อใช้แปลงชื่อประเภทเงินเป็นรหัสย่อขณะออกเลขพัสดุ
      if (item.name) {
        fundTypeCache[item.name.trim()] = item.prefix ? item.prefix.trim() : item.name.trim();
      }
    });

    console.log("✅ โหลดประเภทเงินจาก Firestore คอลเลกชัน fund_type สำเร็จ:", list);
  } catch (error) {
    console.error("❌ เกิดข้อผิดพลาดในการโหลด fund_type:", error);
    selectElem.innerHTML = `<option value="">-- เกิดข้อผิดพลาดในการโหลด --</option>`;
  }
}

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
export async function generateParcelNumbersBackend(selectedItems, fundType, yearBE) {
  try {
    if (!selectedItems || selectedItems.length === 0) {
      return { success: false, message: 'ไม่ได้เลือกรายการพัสดุ' };
    }

    const year2Digits = String(yearBE).slice(-2); // เช่น "69" หรือ "70"

    // จัดกลุ่มรายการที่จะออกเลขตาม log_no
    const logNoGroups = {};
    selectedItems.forEach(item => {
      if (!logNoGroups[item.log_no]) {
        logNoGroups[item.log_no] = [];
      }
      logNoGroups[item.log_no].push(item);
    });

    await runTransaction(db, async (transaction) => {
      for (const logNo of Object.keys(logNoGroups)) {
        const itemsToProcess = logNoGroups[logNo];
        const logParcelRef = doc(db, "log_parcels", logNo);
        const logParcelSnap = await transaction.get(logParcelRef);

        let existingParcelArray = [];
        if (logParcelSnap.exists() && Array.isArray(logParcelSnap.data().parcel_no)) {
          existingParcelArray = [...logParcelSnap.data().parcel_no];
        }

        for (const item of itemsToProcess) {
          const subcatCode = item.subcategories_code || "01";
          const nameId = item.name_id || "01";

          // 🎯 Collection ตรงกลางนับจำนวนชิ้นตามประเภทและปี: asset_counters/{subcatCode}_{year2Digits}
          const counterDocId = `${nameId}_${subcatCode}_${year2Digits}`;
          const counterRef = doc(db, "asset_counters", counterDocId);
          const counterSnap = await transaction.get(counterRef);

          let currentSeq = 0;
          if (counterSnap.exists()) {
            currentSeq = Number(counterSnap.data().seq) || 0;
          }
          currentSeq++;

          // 🎯 ออกเลขพัสดุรูปแบบ: กภกบ.{name_id}-{subcategories_code}-{seq}/{year2Digits}
          const seqFormatted = String(currentSeq).padStart(2, '0'); // หรือ 4 หลัก ตามต้องการ
          const generatedParcelNo = `กภกบ.${nameId}-${subcatCode}-${seqFormatted}/${year2Digits}`;

          // อัปเดตคาวน์เตอร์ตัวนับ
          transaction.set(counterRef, {
            name_id: nameId,
            subcategories_code: subcatCode,
            year_be_short: year2Digits,
            seq: currentSeq,
            updated_at: serverTimestamp()
          }, { merge: true });

          // เพิ่มหรืออัปเดต Map ใน Array parcel_no
          const newParcelMapObj = {
            id: generatedParcelNo,
            uid: item.uid,
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

        // 🎯 บันทึกเอกสารลง log_parcels โดยตั้งชื่อ document ตาม log_no
        transaction.set(logParcelRef, {
          created_at: new Date().toISOString(),
          fund_type: fundType,
          log_no_ref: logNo,
          status: "registered",
          year_be: yearBE,
          parcel_no: existingParcelArray
        }, { merge: true });
      }
    });

    return { success: true, message: 'ออกเลขพัสดุสำเร็จ' };
  } catch (err) {
    console.error("❌ Error generateParcelNumbersBackend:", err);
    return { success: false, message: err.message };
  }
}

// ============================================================================
// 📤 3. บันทึกการเบิกจ่ายพัสดุ (Backend)
// ============================================================================
export async function issueParcelsBackend(selectedUids, recipient, issueDate) {
  try {
    if (!selectedUids || selectedUids.length === 0) {
      return { success: false, message: 'ไม่ได้เลือกรายการพัสดุที่ต้องการเบิก' };
    }

    const targetDate = issueDate || new Date().toISOString().split('T')[0];

    // จัดกลุ่มตาม log_no
    const logNoGroups = {};
    selectedUids.forEach(uid => {
      const logNo = uid.split('_')[0];
      if (!logNoGroups[logNo]) logNoGroups[logNo] = [];
      logNoGroups[logNo].push(uid);
    });

    await runTransaction(db, async (transaction) => {
      for (const logNo of Object.keys(logNoGroups)) {
        const uidsInLog = logNoGroups[logNo];
        const logParcelRef = doc(db, "log_parcels", logNo);
        const logParcelSnap = await transaction.get(logParcelRef);

        if (logParcelSnap.exists()) {
          const data = logParcelSnap.data();
          const parcelArray = Array.isArray(data.parcel_no) ? [...data.parcel_no] : [];

          parcelArray.forEach(p => {
            if (uidsInLog.includes(p.uid)) {
              p.status = 'issued';
              p.issued_to = recipient;
              p.issued_date = targetDate;
            }
          });

          // ตรวจสอบว่าถ้าเบิกจ่ายครบทุกชิ้นแล้ว ให้เปลี่ยน status รวมของเอกสารเป็น issued
          const allIssued = parcelArray.every(p => p.status === 'issued');

          transaction.update(logParcelRef, {
            parcel_no: parcelArray,
            status: allIssued ? 'issued' : data.status,
            updated_at: serverTimestamp()
          });
        }
      }
    });

    return { success: true, message: 'บันทึกการเบิกจ่ายเรียบร้อย' };
  } catch (err) {
    console.error("❌ Error issueParcelsBackend:", err);
    return { success: false, message: err.message };
  }
}

// ============================================================================
// 🖥️ 4. FRONTEND UI & DATA LOADING
// ============================================================================

export async function loadParcelDataFromLogPay(isRefresh = false) {
  const tbody = document.getElementById("parcelTableBody");
  const searchLogNo = (document.getElementById("parcelSearchLogNo")?.value || "").trim().toLowerCase();
  
  // 🎯 ดึงสถานะที่เลือก หากยังไม่เลือกให้ Default เป็น "pending"
  const currentStatusFilter = document.getElementById("parcelFilterStatus")?.value || "pending";

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center py-4 text-muted">
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
    const recipientOptions = new Set();

    // ------------------------------------------------------------------------
    // 1. ดึงข้อมูลจาก log_parcels (กรณีเลือก: registered, issued หรือ ดูทุกสถานะ)
    // ------------------------------------------------------------------------
    if (currentStatusFilter === "registered" || currentStatusFilter === "issued" || currentStatusFilter === "") {
      const parcelSnap = await getDocs(collection(db, "log_parcels"));
      parcelSnap.forEach(docSnap => {
        const data = docSnap.data();
        const logNo = data.log_no_ref || docSnap.id;
        const division = data.division || '-';
        const parcelArray = Array.isArray(data.parcel_no) ? data.parcel_no : [];

        parcelArray.forEach(p => {
          if (p.uid) registeredUidSet.add(p.uid);
          if (p.issued_to) recipientOptions.add(p.issued_to);

          const pStatus = p.status || data.status || 'registered';

          // กรองข้อมูลเฉพาะสถานะที่เลือก
          if (!currentStatusFilter || pStatus === currentStatusFilter) {
            expandedList.push({
              uid: p.uid || `${logNo}_registered_${Math.random()}`,
              log_no: logNo,
              division: p.division || division,
              cr_date: p.cr_date || data.cr_date || formatThaiDateShort(data.created_at) || '-',
              item_name: p.item_name || 'พัสดุ',
              unit_index: p.unit_index || '1/1',
              unit_price: Number(p.unit_price || 0),
              unit_name: p.unit_name || 'รายการ',
              selected_asset_id: p.asset_id || '',
              parcel_no_str: p.id || p.parcel_no || '-',
              status: pStatus,
              issued_to: p.issued_to || '',
              issued_date: p.issued_date || ''
            });
          }
        });
      });
    } else {
      // ถ้าเลือก "pending" ให้เก็บ UID ที่ออกเลขไปแล้วก่อน เพื่อไม่ให้ดึงมาแสดงซ้ำ
      const parcelSnap = await getDocs(collection(db, "log_parcels"));
      parcelSnap.forEach(docSnap => {
        const data = docSnap.data();
        const parcelArray = Array.isArray(data.parcel_no) ? data.parcel_no : [];
        parcelArray.forEach(p => {
          if (p.uid) registeredUidSet.add(p.uid);
        });
      });
    }

    // ------------------------------------------------------------------------
    // 2. ดึงข้อมูลจาก log_pay (กรณีเลือก: pending หรือ ดูทุกสถานะ)
    // ------------------------------------------------------------------------
if (currentStatusFilter === "pending" || currentStatusFilter === "") {
  const logPayRes = await getLogPayForParcels(document.getElementById("parcelSearchLogNo")?.value || "");
  if (logPayRes.success && Array.isArray(logPayRes.data)) {
    logPayRes.data.forEach(payDoc => {
      const logNo = payDoc.log_no || payDoc.id;
      const division = payDoc.division || payDoc.dept || payDoc.department || payDoc.ฝ่าย || '-';
      
      // ✅ 1. ดึงวันตรวจรับจาก cr_date หรือ date
      let crDate = '-';
      if (payDoc.cr_date && payDoc.cr_date !== 'cr_date') {
        crDate = payDoc.cr_date;
      } else if (payDoc.date) {
        crDate = payDoc.date;
      } else if (payDoc.createdAt) {
        crDate = formatThaiDateShort(payDoc.createdAt);
      }

      // ดึงรายชื่อคณะกรรมการ/ผู้ขาย
      if (payDoc.sell_name) recipientOptions.add(payDoc.sell_name);
      if (payDoc.buyer) recipientOptions.add(payDoc.buyer);
      if (payDoc.applicant) recipientOptions.add(payDoc.applicant);
      if (Array.isArray(payDoc.committee)) {
        payDoc.committee.forEach(c => {
          if (c.name) recipientOptions.add(c.name);
        });
      }

      // ✅ 2. ดึงรายการสิ่งของจากฟิลด์ items (Array of Map) เป็นอันดับแรก
      let items = [];
      if (Array.isArray(payDoc.items) && payDoc.items.length > 0) {
        items = payDoc.items; // ดึงจาก items [ { list, equipment, qu, pr, un, am }, ... ]
      } else if (Array.isArray(payDoc.equipmentItems) && payDoc.equipmentItems.length > 0) {
        items = payDoc.equipmentItems;
      } else {
        // Fallback กรณีเป็นฟิลด์รายข้อ list1..list50
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

      // ✅ 3. Fallback กรณีไม่มีรายการแยกย่อย (ดึงจากฟิลด์ to หรือ details)
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

            // ✅ 4. แตกรายการพัสดุตามจำนวนชิ้น (qu)
      items.forEach((item, itemIdx) => {
        const qty = parseInt(item.qu, 10) || 1;
        const itemName = item.list || item.equipment || 'พัสดุ';
        const price = parseFloat(item.pr) || 0;
        const unit = item.un || 'หน่วย';

        // 🎯 ดึง pr_type (ตรวจสอบว่าตรงกับ "จ้าง" หรือไม่ ถ้าไม่ใช่ให้แสดงเป็น "ซื้อ")
        const rawPrType = item.pr_type || payDoc.method || payDoc.purchase_type || 'ซื้อ';
        const cleanPrType = String(rawPrType).includes('จ้าง') ? 'จ้าง' : 'ซื้อ';

        for (let u = 1; u <= qty; u++) {
          const uid = `${logNo}_item${itemIdx + 1}_unit${u}`;

          if (!registeredUidSet.has(uid)) {
            expandedList.push({
              uid: uid,
              log_no: logNo,
              division: division,
              cr_date: crDate,
              pr_type: cleanPrType, // 🎯 เพิ่มฟิลด์ pr_type
              item_name: itemName,
              unit_index: `${u}/${qty}`,
              unit_price: price,
              unit_name: unit,
              selected_asset_id: '',
              parcel_no_str: '-',
              status: 'pending',
              issued_to: '',
              issued_date: ''
            });
          }
        }
      });
    });
  }
}

    allParcelsCache = expandedList;
    populateRecipientOptions(Array.from(recipientOptions));
    filterParcelTable();

  } catch (err) {
    console.error("❌ Error loadParcelDataFromLogPay:", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-danger">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-muted">ไม่พบรายการพัสดุที่ตรงตามเงื่อนไข</td></tr>`;
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

    // ตัวเลือกหมวดหมู่หลัก
    const categoryOptions = assetCategoriesCache.map(cat => {
      const selected = item.selected_asset_id === cat.id ? 'selected' : '';
      return `<option value="${cat.id}" data-nameid="${cat.name_id}" ${selected}>${cat.name} (${cat.name_id})</option>`;
    }).join('');

    // สร้างตัวเลือกหมวดหมู่ย่อยเดิม (กรณีดึงมาจากประวัติเก่า)
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
      }
    }

    const isInputDisabled = item.status !== 'pending' ? 'disabled' : '';

    const prTypeBadge = item.pr_type === 'จ้าง' 
      ? `<span class="badge bg-warning text-dark fw-bold">จ้าง</span>` 
      : `<span class="badge bg-info text-dark fw-bold">ซื้อ</span>`;

    return `
  <tr>
    <td class="text-center">
      <input type="checkbox" class="parcel-checkbox" data-uid="${item.uid}" data-logno="${item.log_no}" data-status="${item.status}" onchange="onParcelCheckboxChange()">
    </td>
    <td class="text-center fw-bold text-primary">${item.log_no}</td>
    <td class="small">${item.division}</td>
    <td class="text-center small">${item.cr_date}</td>
    <td class="text-center">${prTypeBadge}</td>
    <td class="fw-bold">${item.item_name}</td>
    <td class="text-center small">${item.unit_index}</td>
    <td>
      <!-- Select 1: หมวดหมู่หลัก -->
      <select class="form-select form-select-sm parcel-asset-select mb-1" data-uid="${item.uid}" onchange="onMainAssetChange(this, '${item.uid}')" ${isInputDisabled}>
        <option value="">-- เลือกหมวดหมู่หลัก --</option>
        ${categoryOptions}
      </select>
      <!-- Select 2: หมวดหมู่ย่อย (เมื่อเปลี่ยนจะคำนวณเลขพรีวิวทันที) -->
      <select class="form-select form-select-sm parcel-subcat-select" data-uid="${item.uid}" onchange="previewParcelNumber('${item.uid}')" ${subcatDisabled} ${isInputDisabled}>
        ${subcatOptions}
      </select>
    </td>
    <td class="text-end fw-bold">${formattedPrice}</td>
    <td class="text-center small">${item.unit_name}</td>
    <!-- 🎯 เพิ่ม class parcel-no-display และ data-uid เพื่อแสดงผลเลขพรีวิว -->
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
        item_name: cacheItem?.item_name || 'พัสดุ',
        unit_index: cacheItem?.unit_index || '1/1',
        unit_price: cacheItem?.unit_price || 0,
        unit_name: cacheItem?.unit_name || 'รายการ',
        asset_id: mainSelect.value,
        name_id: mainOpt?.dataset.nameid || '01',
        subcategories_code: subcatCode // 🎯 รหัสหมวดหมู่ย่อยที่ผู้ใช้เลือก
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

  const fundType = document.getElementById("parcelFundType")?.value || "งบประมาณ";
  const yearBE = document.getElementById("parcelYearBE")?.value || "2569";

  const confirmRes = await Swal.fire({
    title: 'ยืนยันการออกเลขพัสดุ',
    text: `ต้องการออกเลขพัสดุจำนวน ${selectedItems.length} รายการ ใช่หรือไม่?`,
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

  const res = await generateParcelNumbersBackend(selectedItems, fundType, yearBE);

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

export async function updateAllParcelPreviews() {
  const rows = Array.from(document.querySelectorAll('.parcel-asset-select:not([disabled])'));
  if (rows.length === 0) return;

  const yearBE = document.getElementById("parcelYearBE")?.value || "2569";
  const year2Digits = String(yearBE).slice(-2);
  
  // 1. เก็บค่าตั้งต้นจาก Firestore แยกตามหมวดหมู่
  const baseCounterMap = {};

  // แสดง Spinner สถานะชั่วคราวขณะคำนวณ
  rows.forEach(mainSelect => {
    const uid = mainSelect.dataset.uid;
    const displayTd = document.querySelector(`.parcel-no-display[data-uid="${uid}"]`);
    const subcatSelect = document.querySelector(`.parcel-subcat-select[data-uid="${uid}"]`);
    if (displayTd && mainSelect.value && subcatSelect?.value) {
      displayTd.innerHTML = `<span class="spinner-border spinner-border-sm text-secondary" role="status"></span>`;
    }
  });

  // 2. ดึงค่า Counter ตั้งต้นจาก Firestore (ดึงครั้งเดียวต่อหมวดหมู่)
  for (const mainSelect of rows) {
    const uid = mainSelect.dataset.uid;
    const subcatSelect = document.querySelector(`.parcel-subcat-select[data-uid="${uid}"]`);
    if (!subcatSelect) continue;

    const mainOpt = mainSelect.options[mainSelect.selectedIndex];
    const nameId = mainOpt?.dataset.nameid || "";
    const subcatCode = subcatSelect.value;

    if (!nameId || !subcatCode) continue;

    const counterKey = `${nameId}_${subcatCode}_${year2Digits}`;
    if (baseCounterMap[counterKey] === undefined) {
      try {
        const counterRef = doc(db, "asset_counters", counterKey);
        const counterSnap = await getDoc(counterRef);
        baseCounterMap[counterKey] = counterSnap.exists() ? (Number(counterSnap.data().seq) || 0) : 0;
      } catch (e) {
        baseCounterMap[counterKey] = 0;
      }
    }
  }

  // 3. วนลูปเรียงแถวจากบนลงล่าง แล้วรันเลขสะสมต่อกัน (+1 ไปเรื่อยๆ สำหรับหมวดซ้ำ)
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
    
    // บวกเพิ่มทีละ 1 สำหรับทุกรายการที่เจอกลุ่มหมวดหมู่เดียวกัน
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

// 🎯 เติมตัวเลือกหมวดหมู่หลักในส่วนหัวตาราง (Header Dropdown)
export function populateHeaderAssetDropdown() {
  const headerMain = document.getElementById("headerMainAsset");
  if (!headerMain) return;

  const options = assetCategoriesCache.map(cat => {
    return `<option value="${cat.id}" data-nameid="${cat.name_id}">${cat.name} (${cat.name_id})</option>`;
  }).join('');

  headerMain.innerHTML = `<option value="">-- เปลี่ยนหมวดหมู่หลักทั้งหมด --</option>` + options;
}

// 🎯 ฟังก์ชันเมื่อเปลี่ยนหมวดหมู่หลักที่ส่วนหัวตาราง -> ปรับหมวดหมู่หลักของทุกแถวทันที
export async function onHeaderMainAssetChange(headerSelect) {
  const assetId = headerSelect.value;
  const headerSubSelect = document.getElementById("headerSubcatAsset");
  const loadingStatus = document.getElementById("headerAssetLoadingStatus");

  if (!assetId) return;

  // 1. แสดงสถานะกำลังเปลี่ยน และล็อก UI ป้องกันการกดซ้ำ
  headerSelect.disabled = true;
  if (headerSubSelect) headerSubSelect.disabled = true;
  if (loadingStatus) loadingStatus.classList.remove("d-none");

  // หน่วงเวลาเล็กน้อยเพื่อให้เบราว์เซอร์วาดหน้าจอ "กำลังเปลี่ยน..." ทันที
  await new Promise(resolve => setTimeout(resolve, 50));

  try {
    // 2. อัปเดตตัวเลือกหมวดหมู่ย่อยส่วนหัว
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

    // 3. อัปเดต Dropdown ของทุกแถวในตารางพร้อมกัน
    const rowMainSelects = Array.from(document.querySelectorAll('.parcel-asset-select:not([disabled])'));
    for (const selectElem of rowMainSelects) {
      selectElem.value = assetId;
      const uid = selectElem.dataset.uid;
      if (uid) {
        updateRowSubcatOptionsOnly(selectElem, uid);
      }
    }
  } finally {
    // 4. ปลดล็อก UI เมื่อประมวลผลเสร็จสิ้น
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

// 🎯 ฟังก์ชันเมื่อเปลี่ยนหมวดหมู่ย่อยที่ส่วนหัวตาราง -> ปรับหมวดหมู่ย่อยของทุกแถวทันที
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

    // เรียกประมวลผลคำนวณเลขแบบ Batch รวดเร็ว
    await previewAllParcelNumbersBatch();
  } finally {
    if (headerMainSelect) headerMainSelect.disabled = false;
    headerSubSelect.disabled = false;
    if (loadingStatus) loadingStatus.classList.add("d-none");
  }
}

export async function previewAllParcelNumbersBatch() {
  await updateAllParcelPreviews();
}

// ============================================================================
// 🚀 AUTO-LOAD ON DOM READY
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  await loadAssetCategories();
  loadFundTypesToDropdown();
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
window.loadFundTypesToDropdown = loadFundTypesToDropdown;
window.previewParcelNumber = previewParcelNumber;
window.onMainAssetChange = onMainAssetChange;
window.onHeaderMainAssetChange = onHeaderMainAssetChange;
window.onHeaderSubcatAssetChange = onHeaderSubcatAssetChange;
window.updateAllParcelPreviews = updateAllParcelPreviews;