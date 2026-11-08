// public/js/pay.js
import { db, insertAuditLog } from "./firestore.js";
import { 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    orderBy,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { 
  generateLogPoNumber, 
  saveLogPoToFirestore, 
  getLogPoDataFromFirestore, 
  getHolidaysFromFirestore 
} from "./log-pay.js";

// 🌐 URL ของ Google Apps Script Web App Microservice (สำหรับออกเอกสาร Doc/PDF)
const GAS_DOC_MICROSERVICE_URL = "https://script.google.com/macros/s/AKfycbwX653dlaUHJmpcq6y-UOYJlDkN7u7UZhGeqRV-egjEtMEDUk1O-EWm6Db7ZbD66HkAxQ/exec";
const INTERNAL_SECRET_KEY = "witchachaiyakul"; // 🔑 รหัสลับสำหรับการสื่อสารกับ GAS Microservice

// 🎯 โหลด Master Data (รวมถึงรายชื่อลง datalist) ทันทีที่ DOM พร้อมทำงาน
document.addEventListener("DOMContentLoaded", () => {
    // 🎯 1. โหลดข้อมูล Master Data ของระบบ
    if (typeof loadKbsPayMasterData === 'function') {
        loadKbsPayMasterData();
    }

    // 🎯 2. ผูก Event Listener ตรวจสอบผู้เสนอราคาแบบ Real-time (เพื่อซ่อน/แสดงกล่องเตือน)
    const s2Input = document.getElementById('seller2');
    const s3Input = document.getElementById('seller3');

    if (s2Input) {
        s2Input.addEventListener('input', checkSellerValidation);
    }
    if (s3Input) {
        s3Input.addEventListener('input', checkSellerValidation);
    }

    // 🎯 3. เช็กสถานะการแสดงผลกล่องเตือนทันทีหลังจากโหลดหน้าเว็บเสร็จ
    if (typeof checkSellerValidation === 'function') {
        checkSellerValidation();
    }
});
// ============================================================================
// 🔍 1. ค้นหาข้อมูลจาก FIRESTORE (log_pay ก่อน -> แล้วค่อย log_budget)
// ============================================================================
async function fetchDocFromFirestore(collectionName, id) {
    if (!id) return null;
    const cleanId = String(id).trim();

    try {
        // 1. ลองดึงด้วย Document ID
        const docRef = doc(db, collectionName, cleanId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() };
        }

        // 2. ค้นด้วยฟิลด์ log_no
        const qLogNo = query(collection(db, collectionName), where("log_no", "==", cleanId));
        const querySnap1 = await getDocs(qLogNo);
        if (!querySnap1.empty) {
            return { id: querySnap1.docs[0].id, ...querySnap1.docs[0].data() };
        }

        // 3. ค้นด้วยฟิลด์ LOG_NO (กรณีพิมพ์ตัวใหญ่)
        const qLogNoUpper = query(collection(db, collectionName), where("LOG_NO", "==", cleanId));
        const querySnap2 = await getDocs(qLogNoUpper);
        if (!querySnap2.empty) {
            return { id: querySnap2.docs[0].id, ...querySnap2.docs[0].data() };
        }

        return null;
    } catch (err) {
        console.error(`❌ Error fetching ${collectionName}:`, err);
        return null;
    }
}

export async function searchBudgetInfo() {
    const logNoInput = document.getElementById('logNoInput');
    const status = document.getElementById('searchStatus');
    
    if (!logNoInput || !status) return;

    const logNo = logNoInput.value.trim();
    
    if (logNo.length === 0) {
        status.innerText = '* กรอกเลขเพื่อดึงข้อมูล';
        return;
    }
    
    if (typeof clearFormExceptLogNo === 'function') {
        clearFormExceptLogNo();
    }
    logNoInput.value = logNo;
    
    status.innerText = '⏳ กำลังค้นหาข้อมูล...';
    window.currentBudget = null; 

    try {
        const payData = await fetchDocFromFirestore("log_pay", logNo);
        const budgetData = await fetchDocFromFirestore("log_budget", logNo);

        let planData = null;
        const projectId = (budgetData && budgetData.project_id) || (payData && payData.project_id);
        if (projectId) {
            planData = await fetchDocFromFirestore("budget_plans", projectId);
        }

        let res = null;

        if (payData) {
            const addr = payData.seller_address || {};
            const fin = payData.financial || {};
            
            const rawCommittee = payData.committee || [];
            const formattedCommittee = Array.isArray(rawCommittee) ? rawCommittee.map(c => ({
                name: c.name || c.comm_name || '',
                pos: c.pos || c.position || ''
            })) : [];

            const rawItems = payData.items || [];
            const formattedItems = Array.isArray(rawItems) ? rawItems.map(item => ({
                list: item.equipment || item.list || '',
                torlist: item.torlist || '',
                qu: item.qu !== undefined ? item.qu : 0,
                un: item.un || '',
                pr: item.pr !== undefined ? item.pr : 0,
                am: item.am !== undefined ? item.am : 0,
                pr_type: item.pr_type || 'ซื้อ'
            })) : [];

            const poNoStr = payData.po_no || '';
            let poBaseNo = Number(payData.po_base_no || payData.base_no) || 0;
            let poSubNo = Number(payData.po_sub_no || payData.sub_no) || 0;
            let poYearBe = Number(payData.po_year_be || payData.year_be) || 0;
            let docType = payData.doc_type || 'po';

            if ((poBaseNo === 0 || poYearBe === 0) && poNoStr.includes('/')) {
                const parts = poNoStr.split('/');
                poBaseNo = Number(parts[0]) || 0;
                if (parts.length === 3) {
                    poSubNo = Number(parts[1]) || 1;
                    poYearBe = Number(parts[2]) || (new Date().getFullYear() + 543);
                } else if (parts.length === 2) {
                    poSubNo = 1;
                    poYearBe = Number(parts[1]) || (new Date().getFullYear() + 543);
                }
            }

            res = {
                success: true,
                isPaid: true,
                rowNumber: logNo,
                data: {
                    logNo: payData.log_no || payData.LOG_NO || logNo,
                    division: payData.division || payData.ฝ่าย || (budgetData ? (budgetData.division || budgetData.ฝ่าย) : '') || (planData ? planData.division : '') || '',
                    project: payData.project || payData.โครงการ || (budgetData ? (budgetData.project || budgetData.โครงการ) : '') || (planData ? planData.project_name : '') || '',
                    activities: payData.activities || payData.กิจกรรม || (budgetData ? (budgetData.activities || budgetData.กิจกรรม) : '') || (planData ? planData.activity_name : '') || '',
                    budget_use: fin.total || payData.budget_use || payData.amount || (budgetData ? budgetData.budget_use : '0.00'),
                    method: payData.method || payData.วิธีการ || (budgetData ? budgetData.method : '') || '',
                    details: payData.details || payData.รายละเอียด || (budgetData ? budgetData.details : '') || '',
                    buyer: payData.buyer || '',
                    pos_buyer: payData.pos_buyer || '',
                    memo_date: payData.memo_date || '',
                    ctor_date: payData.ctor_date || '',
                    tor_rp_date: payData.tor_rp_date || '',
                    to: payData.to || '',
                    delivery_days: payData.d_dateline || payData.delivery_days || '7',
                    seller_name: payData.seller || payData.seller_name || '',
                    seller2: payData.seller2 || '',
                    seller3: payData.seller3 || '',
                    bidder_name: payData.sell_name || payData.bidder_name || '',
                    tax_id: addr.taxid || payData.tax_id || payData.taxid || '',
                    tel_no: addr.ad_ph || payData.tel_no || '',
                    address_no: addr.ad_no || payData.address_no || '',
                    address_moo: addr.ad_m || payData.address_moo || '',
                    address_road: addr.ad_rd || payData.address_road || '',
                    address_subdistrict: addr.ad_tb || payData.address_subdistrict || '',
                    address_district: addr.ad_mu || payData.address_district || '',
                    address_province: addr.ad_pr || payData.address_province || '',
                    zip_code: addr.postid || payData.zip_code || '',
                    po_no: poNoStr,
                    po_date: payData.po_date || '',
                    doc_type: docType,
                    po_base_no: poBaseNo,
                    po_sub_no: poSubNo,
                    po_year_be: poYearBe,
                    invoice_type: payData.invoice_type || '',
                    doc_date: payData.invoice_date || payData.doc_date || payData.cr_date || '',
                    doc_no: payData.invoice_no || payData.doc_no || '',
                    book_no: payData.invoice_book || payData.book_no || '',
                    qu_date: payData.qu_date || '',
                    rc_date: payData.rc_date || '',
                    announce_date: payData.announce_date || '',
                    deadline: payData.deadline || '',
                    vat_type: fin.vat_type || payData.vat_type || 'no_vat',
                    items: formattedItems,
                    committee: formattedCommittee
                }
            };
        } 
        else if (budgetData) {
            res = {
                success: true,
                isPaid: false,
                rowNumber: logNo,
                data: {
                    logNo: budgetData.LOG_NO || budgetData.logNo || budgetData.log_no || logNo,
                    division: budgetData.division || budgetData.ฝ่าย || (planData ? planData.division : '') || '',
                    project: budgetData.project || budgetData.โครงการ || (planData ? planData.project_name : '') || '',
                    activities: budgetData.activities || budgetData.กิจกรรม || (planData ? planData.activity_name : '') || '',
                    budget_use: budgetData.budget_use || budgetData.request || budgetData.amount || '0.00',
                    method: budgetData.method || budgetData.วิธีการ || '',
                    details: budgetData.details || budgetData.รายละเอียด || '',
                    buyer: '', pos_buyer: '', memo_date: '', ctor_date: '', tor_rp_date: '',
                    to: '', delivery_days: '7', seller_name: '', seller2: '', seller3: '',
                    tax_id: '', tel_no: '', address_no: '', address_moo: '', address_road: '',
                    address_subdistrict: '', address_district: '', address_province: '', zip_code: '',
                    bidder_name: '', invoice_type: '', doc_date: '', doc_no: '', book_no: '',
                    po_no: '', po_date: '', doc_type: '', po_base_no: 0, po_sub_no: 0, po_year_be: '',
                    qu_date: '', rc_date: '', announce_date: '', deadline: '',
                    vat_type: 'no_vat', items: [], committee: []
                }
            };
        }

        if (res && res.success) {
            window.currentBudget = res.data;
            
            const rowNumInput = document.getElementById('row_number');
            if (rowNumInput) rowNumInput.value = res.rowNumber || 0;
            
            const saveBtn = document.getElementById('saveBtn');
            if (res.isPaid) {
                status.innerHTML = '<span style="color: #ff9800; font-weight: bold;">⚠️ มีการพิมพ์เบิกจ่ายแล้ว (โปรดตรวจสอบก่อนแก้ไข)</span>';
                if (saveBtn) saveBtn.innerHTML = "🔄 อัปเดตข้อมูลและสร้าง PDF"; 
            } else {
                status.innerHTML = '<span style="color: #4caf50; font-weight: bold;">✅ ผ่านการตัดแผนแล้ว</span>';
                if (saveBtn) saveBtn.innerHTML = "💾 บันทึกและสร้าง PDF"; 
                if (typeof resetSellerFields === 'function') resetSellerFields(false); 
            }
            
            if (document.getElementById('division')) document.getElementById('division').value = res.data.division || '';
            if (document.getElementById('project')) document.getElementById('project').value = res.data.project || '';
            if (document.getElementById('activities')) document.getElementById('activities').value = res.data.activities || '';
            
            const rawBudgetUse = res.data.budget_use;
            const cleanBudgetUse = String(rawBudgetUse).replace(/,/g, '').trim(); 
            if (document.getElementById('quantity')) {
                document.getElementById('quantity').value = (typeof formatMoney === 'function') ? formatMoney(cleanBudgetUse) : cleanBudgetUse;
            }
            
            if (document.getElementById('method')) document.getElementById('method').value = res.data.method || '';
            if (document.getElementById('details')) document.getElementById('details').value = res.data.details || '';
            
            if (res.isPaid) {
                if (document.getElementById('buyer')) document.getElementById('buyer').value = res.data.buyer || '';
                if (document.getElementById('pos_buyer')) document.getElementById('pos_buyer').value = res.data.pos_buyer || '';

                if (document.getElementById('po_no_display')) document.getElementById('po_no_display').value = res.data.po_no || '';
                if (document.getElementById('po_no_hidden')) document.getElementById('po_no_hidden').value = res.data.po_no || '';
                if (document.getElementById('po_base_no_hidden')) document.getElementById('po_base_no_hidden').value = res.data.po_base_no || 0;
                if (document.getElementById('po_sub_no_hidden')) document.getElementById('po_sub_no_hidden').value = res.data.po_sub_no || 0;
                if (document.getElementById('po_year_be_hidden')) document.getElementById('po_year_be_hidden').value = res.data.po_year_be || '';

                const toInput = document.querySelector('input[name="to"]') || document.getElementById('to');
                if (toInput) toInput.value = res.data.to || '';

                const rawDays = res.data.delivery_days || res.data.d_dateline;
                const validDays = (rawDays && parseInt(rawDays, 10) > 0) ? parseInt(rawDays, 10) : 7;
                if (document.getElementById('deliveryDays')) document.getElementById('deliveryDays').value = validDays;

                if (document.getElementById('seller_name_search')) document.getElementById('seller_name_search').value = res.data.seller_name || '';
                if (document.getElementById('seller_name')) document.getElementById('seller_name').value = res.data.seller_name || '';
                
                const taxInput = document.getElementById('tax_id') || document.getElementById('taxid');
                if (taxInput) taxInput.value = res.data.tax_id || res.data.taxid || '';

                if (document.getElementById('tel_no')) document.getElementById('tel_no').value = res.data.tel_no || '';
                if (document.getElementById('address_no')) document.getElementById('address_no').value = res.data.address_no || '';
                if (document.getElementById('address_moo')) document.getElementById('address_moo').value = res.data.address_moo || '';
                if (document.getElementById('address_road')) document.getElementById('address_road').value = res.data.address_road || '';
                if (document.getElementById('address_subdistrict')) document.getElementById('address_subdistrict').value = res.data.address_subdistrict || '';
                if (document.getElementById('address_district')) document.getElementById('address_district').value = res.data.address_district || '';
                if (document.getElementById('address_province')) document.getElementById('address_province').value = res.data.address_province || '';
                if (document.getElementById('zip_code')) document.getElementById('zip_code').value = res.data.zip_code || '';
                if (document.getElementById('bidder_name')) document.getElementById('bidder_name').value = res.data.bidder_name || '';
                
                if (document.getElementById('seller2')) document.getElementById('seller2').value = res.data.seller2 || '';
                if (document.getElementById('seller3')) document.getElementById('seller3').value = res.data.seller3 || '';
                
                // 🎯 แก้ไขเพิ่ม: เรียกใช้ฟังก์ชันเพื่อเช็กค่า seller2 และ seller3 สั่งซ่อนกล่องเตือนทันทีหลังหยอดข้อมูลสำเร็จ
                checkSellerValidation();

                if (document.getElementById('invoice_type')) document.getElementById('invoice_type').value = res.data.invoice_type || '';
                
                const dateVal = res.data.doc_date || res.data.invoice_date || res.data.cr_date || '';
                const docDateElem = document.getElementById('doc_date') || document.getElementById('invoice_date') || document.querySelector('input[name="doc_date"]');
                if (docDateElem) docDateElem.value = dateVal;

                const docNoElem = document.querySelector('input[name="doc_no"]') || document.getElementById('doc_no') || document.getElementById('invoice_no');
                if (docNoElem) docNoElem.value = res.data.doc_no || res.data.invoice_no || '';
                if (typeof updateRefDateDisplayOnly === 'function') updateRefDateDisplayOnly();
                if (typeof updateDateCalculation === 'function') updateDateCalculation();

                const bookNoElem = document.querySelector('input[name="book_no"]') || document.getElementById('book_no') || document.getElementById('invoice_book');
                if (bookNoElem) bookNoElem.value = res.data.book_no || res.data.invoice_book || '';

                const setDateField = (prefix, val) => {
                    if (!val) return;
                    let isoVal = '', displayVal = '';
                    const str = String(val).trim();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                        isoVal = str;
                        const p = str.split('-');
                        displayVal = `${p[2]}/${p[1]}/${parseInt(p[0], 10) + 543}`;
                    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
                        displayVal = str;
                        const p = str.split('/');
                        let y = parseInt(p[2], 10);
                        if (y > 2400) y -= 543;
                        isoVal = `${y}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
                    } else {
                        isoVal = str;
                        displayVal = str;
                    }

                    const picker = document.getElementById(`${prefix}_picker`);
                    const hidden = document.getElementById(`${prefix}_hidden`);
                    const display = document.getElementById(`${prefix}_display`);
                    const direct  = document.getElementById(prefix);

                    if (picker) picker.value = isoVal;
                    if (hidden) hidden.value = isoVal;
                    if (display) display.value = displayVal;
                    if (direct) direct.value = (direct.type === 'date') ? isoVal : displayVal;
                };

                setDateField('date_memo',     res.data.memo_date);
                setDateField('date_ctor',     res.data.ctor_date);
                setDateField('date_tor_rp',   res.data.tor_rp_date);
                setDateField('date_req',      res.data.qu_date);
                setDateField('date_result',   res.data.rc_date);
                setDateField('date_announce', res.data.announce_date);
                setDateField('date_po',       res.data.po_date);
                
                const deadlineVal = res.data.deadline || res.data.date_delivery || res.data.delivery_date;
                setDateField('date_delivery', deadlineVal);
                setDateField('deadline',      deadlineVal);
                
                const crDateVal = res.data.cr_date || res.data.date_receive || res.data.invoice_date || res.data.doc_date || dateVal;
                setDateField('date_receive', crDateVal);
                setDateField('cr_date',      crDateVal);

                if (document.getElementById('po_no')) document.getElementById('po_no').value = res.data.po_no || '';
                
                if (res.data.vat_type) {
                    const vatRadio = document.querySelector(`input[name="vat_type"][value="${res.data.vat_type}"]`);
                    if (vatRadio) vatRadio.checked = true;
                } else {
                    const defaultVat = document.querySelector('input[name="vat_type"][value="no_vat"]');
                    if (defaultVat) defaultVat.checked = true;
                }

                if (res.data.items && res.data.items.length > 0) {
                    const tbody = document.getElementById('itemListBody');
                    if (tbody) {
                        tbody.innerHTML = '';
                        window.currentRowCount = 0;
                        
                        res.data.items.forEach((item) => {
                            currentRowCount++;
                            const i = currentRowCount;
                            const tr = document.createElement('tr');
                            tr.innerHTML = `
                                <td class="row-num text-center align-top pt-2">${i}</td>
                                <td>
                                    <input type="text" name="list${i}" id="list${i}" class="form-control form-control-sm mb-1" value="${item.list || item.equipment || ''}" placeholder="รายการที่ ${i}" style="width: 100%;">
                                    <textarea name="torlist${i}" id="torlist${i}" class="form-control form-control-sm" rows="2" placeholder="รายละเอียดคุณลักษณะเฉพาะ" style="width: 100%; background-color: #ffffff !important; color: #000000 !important; cursor: text;">${item.torlist || ''}</textarea>
                                </td>
                                <td class="align-top">
                                    <input type="number" name="qu${i}" id="qu${i}" value="${item.qu !== undefined ? item.qu : ''}" step="0.01" class="form-control form-control-sm qty-input text-center" oninput="calculateTotals()" placeholder="0" style="width: 100%;">
                                </td>
                                <td class="align-top">
                                    <input type="text" name="un${i}" id="un${i}" value="${item.un || ''}" class="form-control form-control-sm text-center" placeholder="หน่วย" list="unit_list" style="width: 100%;">
                                </td>
                                <td class="align-top">
                                    <input type="number" name="pr${i}" id="pr${i}" value="${String(item.pr || 0).replace(/,/g,'')}" step="0.01" class="form-control form-control-sm price-input text-end" oninput="calculateTotals()" placeholder="0.00" style="width: 100%;">
                                </td>
                                <td class="align-top">
                                    <input type="text" name="am${i}" id="am${i}" value="${item.am || '0.00'}" readonly class="form-control form-control-sm text-end fw-bold text-success" style="width: 100%; background-color: #e9ecef !important;">
                                </td>
                            `;
                            tbody.appendChild(tr);
                        });
                    }
                    if (typeof checkButtonStatus === 'function') checkButtonStatus();
                }
            } else {
                if (document.getElementById('po_no_display')) document.getElementById('po_no_display').value = '';
                if (document.getElementById('po_no_hidden')) document.getElementById('po_no_hidden').value = '';
                if (document.getElementById('po_base_no_hidden')) document.getElementById('po_base_no_hidden').value = 0;
                if (document.getElementById('po_sub_no_hidden')) document.getElementById('po_sub_no_hidden').value = 0;
                if (document.getElementById('po_year_be_hidden')) document.getElementById('po_year_be_hidden').value = '';

                const defaultVatRadio = document.querySelector('input[name="vat_type"][value="no_vat"]');
                if (defaultVatRadio) defaultVatRadio.checked = true;
            }

            const budgetUseFloat = parseFloat(cleanBudgetUse) || 0; 
            if (typeof updateCommittee === 'function') updateCommittee(budgetUseFloat, res.data);
            if (typeof calculateTotals === 'function') calculateTotals(); 
            
            if (!res.isPaid && typeof updateDateCalculation === 'function') {
                updateDateCalculation(); 
            } else if (typeof refreshAllDateDisplays === 'function') {
                refreshAllDateDisplays();
            }

            if (typeof validateBudget === 'function') validateBudget(); 

        } else {
            status.innerText = `❌ ไม่พบข้อมูลเลข นผ.2 (${logNo}) ในระบบ`;
            if (typeof resetBudgetFields === 'function') resetBudgetFields();
            if (typeof updateCommittee === 'function') updateCommittee(0, {}); 
        }

    } catch (error) {
        console.error("❌ searchBudgetInfo Error:", error);
        status.innerText = `❌ ข้อผิดพลาดของระบบ: ${error.message}`;
        if (typeof resetBudgetFields === 'function') resetBudgetFields();
        if (typeof updateCommittee === 'function') updateCommittee(0, {});
    }
}

export function clearFormExceptLogNo() {
    const setVal = (id, val = "") => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    const setQueryVal = (selector, val = "") => {
        const el = document.querySelector(selector);
        if (el) el.value = val;
    };

    setVal('row_number', '0');
    setVal('invoice_url', '');
    setVal('project', '');
    setVal('activities', '');
    setVal('quantity', '');
    setVal('method', '');
    setVal('details', '');
    setVal('division', '');
    
    setQueryVal('input[name="to"]', '');
    setVal('deliveryDays', '7');
    
    setVal('buyer', '');
    setVal('pos_buyer', '');

    setVal('po_no_display', '');
    setVal('po_no_hidden', '');
    setVal('po_base_no_hidden', '0');
    setVal('po_sub_no_hidden', '0');
    setVal('po_year_be_hidden', '');

    // เคลียร์ข้อมูลร้านค้าและที่อยู่
    setVal('seller_name_search', '');
    setVal('seller_name', '');
    setVal('seller2', '');
    setVal('seller3', '');
    setVal('tax_id', '');
    setVal('tel_no', '');
    setVal('address_no', '');
    setVal('address_moo', '');
    setVal('address_road', '');
    setVal('address_subdistrict', '');
    setVal('address_district', '');
    setVal('address_province', '');
    setVal('zip_code', '');
    setVal('bidder_name', '');

    setVal('invoice_type', '');
    setVal('doc_date', '');
    setVal('cal_value', '');
    setVal('cal_income_tax', '');
    setVal('cal_act_paid', '');
    setQueryVal('input[name="doc_no"]', '');
    setQueryVal('input[name="book_no"]', '');
    
    const dateFields = [
        'date_memo', 'date_ctor', 'date_tor_rp', 'date_req', 
        'date_result', 'date_announce', 'date_po', 'date_delivery', 'date_receive'
    ];
    dateFields.forEach(f => {
        setVal(f + '_picker', '');
        setVal(f + '_hidden', '');
        setVal(f + '_display', '');
    });

    const tbody = document.getElementById('itemListBody');
    if (tbody) {
        tbody.innerHTML = "";
        window.currentRowCount = 0; 
        if (typeof addRowBatch === 'function') addRowBatch(); 
    }
    
    // 🎯 แก้ไขเพิ่ม: เรียกใช้เพื่อตรวจสอบสถานะการแสดง/ซ่อนกล่องเตือนเมื่อมีการเคลียร์ฟอร์ม
    checkSellerValidation();

    const valMsg = document.getElementById('validationMessage');
    if (valMsg) valMsg.innerText = "";

    const msg = document.getElementById('message');
    if (msg) msg.innerHTML = "";

    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
        saveBtn.innerHTML = "💾 บันทึกและสร้าง PDF";
        saveBtn.style.display = "inline-block";
    }
    
    if (typeof calculateTotals === 'function') calculateTotals();
}

export async function getBudgetInfo(logNo) {
  try {
    if (!logNo) return { success: false, message: 'กรุณาระบุเลข นผ.2' };
    const cleanLogNo = String(logNo).trim();

    // 1. ค้นหาใน log_pay
    const payRef = doc(db, "log_pay", cleanLogNo);
    const paySnap = await getDoc(payRef);
    let payData = paySnap.exists() ? paySnap.data() : null;

    // 2. ค้นหาใน log_budget
    const budgetRef = doc(db, "log_budget", cleanLogNo);
    const budgetSnap = await getDoc(budgetRef);
    let budgetData = budgetSnap.exists() ? budgetSnap.data() : null;

    // 3. ดึงข้อมูลแผนโครงการเพิ่มเติม (ถ้ามี project_id)
    let planData = null;
    const projectId = (budgetData && budgetData.project_id) || (payData && payData.project_id);
    if (projectId) {
      const planRef = doc(db, "budget_plans", projectId);
      const planSnap = await getDoc(planRef);
      if (planSnap.exists()) planData = planSnap.data();
    }

    // 4. กรณีพบใน log_pay (เคยพิมพ์เบิกจ่ายแล้ว - โหมดแก้ไข)
    if (payData) {
      const addr = payData.seller_address || {};
      const fin = payData.financial || {};
      const rawCommittee = payData.committee || [];
      const formattedCommittee = Array.isArray(rawCommittee) ? rawCommittee.map(c => ({
        name: c.name || c.comm_name || '',
        pos: c.pos || c.position || ''
      })) : [];

      const rawItems = payData.items || [];
      const formattedItems = rawItems.map(item => ({
        list: item.equipment || item.list || '',
        torlist: item.torlist || '',
        qu: item.qu !== undefined ? item.qu : 0,
        un: item.un || '',
        pr: item.pr !== undefined ? item.pr : 0,
        am: item.am !== undefined ? item.am : 0,
        pr_type: item.pr_type || 'ซื้อ'
      }));

      const poNoStr = payData.po_no || '';
      let poBaseNo = Number(payData.po_base_no || payData.base_no) || 0;
      let poSubNo = Number(payData.po_sub_no || payData.sub_no) || 0;
      let poYearBe = Number(payData.po_year_be || payData.year_be) || 0;
      let docType = payData.doc_type || 'po';

      if ((poBaseNo === 0 || poYearBe === 0) && poNoStr.includes('/')) {
        const parts = poNoStr.split('/');
        poBaseNo = Number(parts[0]) || 0;
        if (parts.length === 3) {
          poSubNo = Number(parts[1]) || 1;
          poYearBe = Number(parts[2]) || (new Date().getFullYear() + 543);
        } else if (parts.length === 2) {
          poSubNo = 1;
          poYearBe = Number(parts[1]) || (new Date().getFullYear() + 543);
        }
      }

      return {
        success: true,
        isPaid: true,
        rowNumber: cleanLogNo,
        data: {
          logNo: payData.log_no || payData.LOG_NO || cleanLogNo,
          division: payData.division || payData.ฝ่าย || (budgetData ? (budgetData.division || budgetData.ฝ่าย) : '') || (planData ? planData.division : '') || '',
          project: payData.project || payData.โครงการ || (budgetData ? (budgetData.project || budgetData.โครงการ) : '') || (planData ? planData.project_name : '') || '',
          activities: payData.activities || payData.กิจกรรม || (budgetData ? (budgetData.activities || budgetData.กิจกรรม) : '') || (planData ? planData.activity_name : '') || '',
          budget_use: fin.total || payData.budget_use || payData.amount || (budgetData ? budgetData.budget_use : '0.00'),
          method: payData.method || payData.วิธีการ || (budgetData ? budgetData.method : '') || '',
          details: payData.details || payData.รายละเอียด || (budgetData ? budgetData.details : '') || '',
          
          buyer: payData.buyer || '',
          pos_buyer: payData.pos_buyer || '',
          memo_date: payData.memo_date || '',
          ctor_date: payData.ctor_date || '',
          tor_rp_date: payData.tor_rp_date || '',

          to: payData.to || '',
          delivery_days: payData.d_dateline || payData.delivery_days || '7',
          seller_name: payData.seller || payData.seller_name || '',
          seller2: payData.seller2 || '',
          seller3: payData.seller3 || '',
          bidder_name: payData.sell_name || payData.bidder_name || '',
          
          tax_id: addr.taxid || payData.tax_id || payData.taxid || '',
          tel_no: addr.ad_ph || payData.tel_no || '',
          address_no: addr.ad_no || payData.address_no || '',
          address_moo: addr.ad_m || payData.address_moo || '',
          address_road: addr.ad_rd || payData.address_road || '',
          address_subdistrict: addr.ad_tb || payData.address_subdistrict || '',
          address_district: addr.ad_mu || payData.address_district || '',
          address_province: addr.ad_pr || payData.address_province || '',
          zip_code: addr.postid || payData.zip_code || '',
          
          po_no: poNoStr,
          po_date: payData.po_date || '',
          doc_type: docType,
          po_base_no: poBaseNo,
          po_sub_no: poSubNo,
          po_year_be: poYearBe,

          invoice_type: payData.invoice_type || '',
          doc_date: payData.invoice_date || payData.doc_date || payData.cr_date || '',
          doc_no: payData.invoice_no || payData.doc_no || '',
          book_no: payData.invoice_book || payData.book_no || '',
          qu_date: payData.qu_date || '',
          rc_date: payData.rc_date || '',
          announce_date: payData.announce_date || '',
          deadline: payData.deadline || '',
          
          vat_type: fin.vat_type || payData.vat_type || 'no_vat',
          fin_total: fin.total || 0,
          fin_ex_vat: fin.ex_vat || 0,
          fin_vat: fin.vat || 0,
          fin_value: fin.value || 0,
          fin_income_tax: fin.income_tax || 0,
          fin_act_paid: fin.act_paid || 0,
          
          items: formattedItems,
          committee: formattedCommittee
        }
      };
    }

    // 5. กรณีพบเฉพาะใน log_budget (ยังไม่เคยพิมพ์เบิกจ่าย - โหมดสร้างใหม่)
    if (budgetData) {
      return {
        success: true,
        isPaid: false,
        rowNumber: cleanLogNo,
        data: {
          logNo: budgetData.LOG_NO || budgetData.logNo || budgetData.log_no || cleanLogNo,
          division: budgetData.division || budgetData.ฝ่าย || (planData ? planData.division : '') || '',
          project: budgetData.project || budgetData.โครงการ || (planData ? planData.project_name : '') || '',
          activities: budgetData.activities || budgetData.กิจกรรม || (planData ? planData.activity_name : '') || '',
          budget_use: budgetData.budget_use || budgetData.request || budgetData.amount || '0.00',
          method: budgetData.method || budgetData.วิธีการ || '',
          details: budgetData.details || budgetData.รายละเอียด || '',
          
          buyer: '', pos_buyer: '', memo_date: '', ctor_date: '', tor_rp_date: '',
          to: '', delivery_days: '7', seller_name: '', seller2: '', seller3: '',
          tax_id: '', tel_no: '', address_no: '', address_moo: '', address_road: '',
          address_subdistrict: '', address_district: '', address_province: '', zip_code: '',
          bidder_name: '', invoice_type: '', doc_date: '', doc_no: '', book_no: '',
          
          po_no: '', po_date: '', doc_type: '', po_base_no: 0, po_sub_no: 0, po_year_be: '',
          qu_date: '', rc_date: '', announce_date: '', deadline: '',
          vat_type: 'no_vat', items: [], committee: []
        }
      };
    }

    return { success: false, message: `ไม่พบข้อมูลเลข นผ.2 (${cleanLogNo}) ในระบบ` };

  } catch (error) {
    console.error("❌ getBudgetInfo Error:", error);
    return { success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล: ' + error.message };
  }
}

export function autoFillBuyerPos() {
    const buyerInput = document.getElementById('buyer');
    const posInput = document.getElementById('pos_buyer');
    
    if (!buyerInput || !posInput) return;
    
    const buyerName = buyerInput.value.trim();
    if (!buyerName) {
        posInput.value = '';
        return;
    }
    
    // ดึงฐานข้อมูลรายชื่อจากตัวแปร global
    const dbList = window.committeeDatabase || window.allCommittees || [];
    const match = dbList.find(c => {
        const name = (c.name || c.comm_name || c.fullname || '').trim();
        return name === buyerName;
    });
    
    if (match) {
        posInput.value = match.position || match.pos || '';
    }
}

// ============================================================================
// 📚 2. MASTER DATA LOADERS (ดึงข้อมูลประกอบฟอร์มจาก FIRESTORE)
// ============================================================================

/**
 * ดึงข้อมูลวันหยุดราชการจาก collection 'holidays'
 */
export async function getHolidays() {
  try {
    const snap = await getDocs(collection(db, "holidays"));
    const list = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      list.push({
        date: data.date || '',
        list: data.list || data.name || ''
      });
    });
    return list;
  } catch (error) {
    console.error("❌ getHolidays Error:", error);
    return [];
  }
}

/**
 * ดึงรายชื่อผู้ขาย/ร้านค้าจาก collection 'suppliers'
 */
export async function getSupplierNameList() {
  try {
    const snap = await getDocs(collection(db, "suppliers"));
    const names = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const name = data.seller || data.seller_name || '';
      if (name.trim()) names.push(name.trim());
    });
    return Array.from(new Set(names));
  } catch (error) {
    console.error("❌ getSupplierNameList Error:", error);
    return [];
  }
}

export async function getInvoiceTypeList() {
  const defaultTypes = [
    "ใบส่งของ/ใบกำกับภาษี",
    "ใบเสนอราคา",
    "ใบเสร็จรับเงิน",
    "บิลเงินสด",
    "ใบกำกับภาษี/ใบส่งของ/ใบแจ้งหนี้"
  ];
  try {
    const snap = await getDocs(collection(db, "suppliers"));
    const dbTypes = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.invoice_type && data.invoice_type.trim()) {
        dbTypes.push(data.invoice_type.trim());
      }
    });
    return Array.from(new Set([...defaultTypes, ...dbTypes]));
  } catch (error) {
    console.error("❌ getInvoiceTypeList Error:", error);
    return defaultTypes;
  }
}

export async function getCommitteeDb() {
  try {
    const snap = await getDocs(collection(db, "committees"));
    const list = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      list.push({
        name: data.name || '',
        pos: data.pos || data.position || '',
        position: data.pos || data.position || ''
      });
    });
    return list;
  } catch (error) {
    console.error("❌ getCommitteeDb Error:", error);
    return [];
  }
}

export async function getSupplierInfo(sellerName) {
  try {
    if (!sellerName) return { success: false, message: 'ไม่ได้ระบุชื่อร้านค้า' };

    const q = query(collection(db, "suppliers"), where("seller", "==", sellerName.trim()));
    const snap = await getDocs(q);

    if (!snap.empty) {
      return { success: true, data: snap.docs[0].data() };
    }

    // กรณีค้นหาด้วยคีย์ seller_name
    const q2 = query(collection(db, "suppliers"), where("seller_name", "==", sellerName.trim()));
    const snap2 = await getDocs(q2);

    if (!snap2.empty) {
      return { success: true, data: snap2.docs[0].data() };
    }

    return { success: false, message: 'ไม่พบข้อมูลร้านค้านี้ในระบบ' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

export async function loadKbsPayMasterData() {
    // 1. ตรวจสอบแถวรายการพัสดุ (ถ้ายังไม่มีให้สร้างแถวเริ่มต้น)
    if (typeof addRowBatch === 'function') {
        const tbody = document.getElementById('itemListBody');
        if (tbody && tbody.children.length === 0) {
            addRowBatch(); 
        }
    }

    try {
        // 2. ดึงข้อมูลวันหยุดราชการจาก Firestore คอลเลกชัน "holidays"
        const holidaysSnap = await getDocs(collection(db, "holidays"));
        const holidayList = [];
        holidaysSnap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.date) holidayList.push(d.date);
        });
        window.holidays = holidayList;
        window.allHolidays = holidayList;
        if (typeof updateDateCalculation === 'function') updateDateCalculation();

        // 3. ดึงรายชื่อร้านค้าจาก Firestore คอลเลกชัน "sellers"
        const sellersSnap = await getDocs(collection(db, "sellers"));
        const sellersList = [];
        sellersSnap.forEach(docSnap => {
            const data = docSnap.data();
            const name = data.seller_name || data.name || data.seller;
            if (name && name.trim() !== "") sellersList.push(name.trim());
        });
        window.allSellersData = sellersList;

        // 4. ดึงประเภทเอกสารใส่ Dropdown (#inv_type_list) จาก Firestore คอลเลกชัน "invoice_types"
        const invTypeSnap = await getDocs(collection(db, "invoice_types"));
        const invTypeList = document.getElementById('inv_type_list');
        if (invTypeList) {
            invTypeList.innerHTML = "";
            invTypeSnap.forEach(docSnap => {
                const typeVal = docSnap.data().type || docSnap.data().name;
                if (typeVal) {
                    const option = document.createElement('option');
                    option.value = typeVal;
                    invTypeList.appendChild(option);
                }
            });
        }

        // 5. โหลดฐานข้อมูลกรรมการจาก Firestore คอลเลกชัน "committees"
        const committeeSnap = await getDocs(collection(db, "committees"));
        const committeeList = [];
        committeeSnap.forEach(docSnap => {
            committeeList.push(docSnap.data());
        });
        window.committeeDatabase = committeeList;

        let dataList = document.getElementById('committee_list');
        if (!dataList) {
            dataList = document.createElement('datalist');
            dataList.id = 'committee_list';
            document.body.appendChild(dataList);
        }
        dataList.innerHTML = "";
        committeeList.forEach(c => {
            const name = c.name || c.comm_name || c.fullname;
            if (name) {
                const option = document.createElement('option');
                option.value = name;
            if (c.position || c.pos) {
                        option.label = c.position || c.pos; 
                    }
                dataList.appendChild(option);
            }
        });

    } catch (error) {
        console.error("❌ เกิดข้อผิดพลาดในการโหลด Master Data:", error);
    }

    // คำนวณยอดและอัปเดตช่องกรรมการ
    if (typeof calculateTotals === 'function') calculateTotals();
    if (typeof updateCommittee === 'function') updateCommittee(0, {}); 
}

export function createMemberRow(index, role, nameValue, posValue) {
    return `
        <div class="card p-3 mb-3 border bg-light shadow-sm">
            <!-- แถบแสดงบทบาท/หน้าที่ -->
            <div class="d-flex align-items-center mb-2">
                <span class="badge bg-primary text-white px-3 py-2 fs-6 fw-bold">
                    <i class="bi bi-person-badge-fill me-1"></i> ${role} (${index})
                </span>
            </div>
            
            <!-- ช่องกรอกข้อมูล ชื่อ-สกุล และ ตำแหน่ง แบบ Grid 2 คอลัมน์ -->
            <div class="row g-3">
                <div class="col-md-6">
                    <label for="comm_name${index}" class="form-label fw-bold small text-secondary mb-1">
                        ชื่อ-สกุล (${index})
                    </label>
                    <input type="text" 
                        name="comm_name${index}" 
                        id="comm_name${index}" 
                        class="form-control"
                        value="${nameValue || ''}" 
                        list="committee_list" 
                        onclick="try { this.showPicker(); } catch(e) {}"
                        onfocus="this.dataset.oldVal = this.value; this.value = '';" 
                        onblur="setTimeout(() => { if (!this.value) this.value = this.dataset.oldVal || ''; }, 250);"
                        onchange="onCommitteeNameChange(this, ${index})"
                        placeholder="พิมพ์ชื่อเพื่อค้นหาหรือระบุเอง...">
                </div>

                <div class="col-md-6">
                    <label for="comm_pos${index}" class="form-label fw-bold small text-secondary mb-1">
                        ตำแหน่ง (${index})
                    </label>
                    <input type="text" 
                        name="comm_pos${index}" 
                        id="comm_pos${index}" 
                        class="form-control"
                        value="${posValue || ''}"
                        placeholder="ระบุตำแหน่ง...">
                </div>
            </div>
        </div>
    `;
}

export function onCommitteeNameChange(elem, index) {
    if (!elem) return;
    const nameVal = elem.value.trim();
    const posInput = document.getElementById(`comm_pos${index}`);
    if (!posInput || !nameVal) return;

    const dbList = window.committeeDatabase || [];
    const match = dbList.find(c => (c.name || c.comm_name || c.fullname || '').trim() === nameVal);
    if (match) {
        posInput.value = match.position || match.pos || '';
    }
}

export async function showFormKbsBudgetUse() {
    if (typeof showForm === 'function') {
        showForm('kbsbudgetuse');
    } else {
        document.querySelectorAll('.form-container').forEach(el => el.classList.add('d-none'));
        const kbsElem = document.getElementById('kbsbudgetuse');
        if (kbsElem) kbsElem.classList.remove('d-none');
        const dashElem = document.getElementById('mainDashboard');
        if (dashElem) dashElem.classList.add('d-none');
    }

    await populateCommitteesDropdown();
}

export async function populateCommitteesDropdown() {
    const listElement = document.getElementById('committee_list');
    if (!listElement) return;

    listElement.innerHTML = '';

    try {
        let dbList = window.committeeDatabase;
        if (!dbList || dbList.length === 0) {
            const committeeSnap = await getDocs(collection(db, "committees"));
            dbList = [];
            committeeSnap.forEach(docSnap => dbList.push(docSnap.data()));
            window.committeeDatabase = dbList;
        }

        if (Array.isArray(dbList) && dbList.length > 0) {
            dbList.forEach(item => {
                const name = item.name || item.comm_name || item.fullname || (typeof item === 'string' ? item : '');
                if (name) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    listElement.appendChild(opt);
                }
            });
            console.log("✅ โหลดรายชื่อผู้ขอใช้งบสำเร็จ: " + dbList.length + " รายการ");
        } else {
            console.warn("⚠️ ไม่พบข้อมูลคณะกรรมการใน collection 'committees'");
        }
    } catch (err) {
        console.error("❌ populateCommitteesDropdown Error:", err);
    }
}

export async function saveKbsPayData(payload) {
  try {
    const data = payload.payData;
    const items = payload.equipmentItems || [];
    const currentUser = JSON.parse(sessionStorage.getItem("kbs_user") || "{}");

    if (!data || !data.log_no) {
      return { status: 'error', message: 'ไม่พบ Log No.' };
    }

    const parseNum = (val) => {
      if (val === null || val === undefined || val === '') return 0;
      const num = Number(String(val).replace(/,/g, ''));
      return isNaN(num) ? 0 : num;
    };

    const docType = data.doc_type || 'po';
    let baseNo = parseNum(data.po_base_no);
    let subNo = (data.po_sub_no !== undefined && data.po_sub_no !== null && data.po_sub_no !== '') 
      ? parseNum(data.po_sub_no) 
      : 0;
    let yearBe = parseNum(data.po_year_be) || (new Date().getFullYear() + 543);

    if (data.po_no && data.po_no.includes('/')) {
      const parts = data.po_no.split('/');
      if (parts.length === 3) {
        if (baseNo === 0) baseNo = parseNum(parts[0]);
        subNo = parseNum(parts[1]);
        if (yearBe === 0 || yearBe === (new Date().getFullYear() + 543)) yearBe = parseNum(parts[2]) || yearBe;
      } else if (parts.length === 2) {
        if (baseNo === 0) baseNo = parseNum(parts[0]);
        subNo = 0;
        if (yearBe === 0 || yearBe === (new Date().getFullYear() + 543)) yearBe = parseNum(parts[1]) || yearBe;
      }
    }

    let fullAddressStr = (data.ad_no || '').trim();
    if (data.ad_m) fullAddressStr += ' ม.' + data.ad_m;
    if (data.ad_rd && data.ad_rd !== "-") fullAddressStr += ' ถ.' + data.ad_rd;
    if (data.ad_tb) fullAddressStr += ' ต.' + data.ad_tb;
    if (data.ad_mu) fullAddressStr += ' อ.' + data.ad_mu;
    if (data.ad_pr) fullAddressStr += ' จ.' + data.ad_pr;
    if (data.postid) fullAddressStr += ' ' + data.postid;
    fullAddressStr = fullAddressStr.trim();

    // 1. บันทึกข้อมูลเข้า Firestore Collection 'log_pay'
    const payDocument = {
      log_no: data.log_no,
      po_no: data.po_no || '',
      doc_type: docType,
      po_base_no: baseNo,
      po_sub_no: subNo,
      po_year_be: yearBe,
      
      date: data.date || toThaiDate(new Date(), false),
      to: data.to || '',
      buyer: data.buyer || '',
      pos_buyer: data.pos_buyer || '',

      project: data.project || '',
      activities: data.activities || '',
      division: data.division || '',
      objective: data.objective || '',

      memo_date: data.memo_date || '',
      ctor_date: data.ctor_date || '',
      tor_rp_date: data.tor_rp_date || '',

      d_dateline: parseNum(data.d_dateline),
      qu_date: data.qu_date || '',
      rc_date: data.rc_date || '',
      announce_date: data.announce_date || '',
      po_date: data.po_date || '',
      deadline: data.deadline || '',
      cr_date: data.cr_date || '',
      invoice_date: data.invoice_date || '',
      invoice_no: data.invoice_no || '',
      invoice_book: data.invoice_book || '',
      invoice_type: data.invoice_type || '',
      quarantee: data.quarantee || '',

      seller: data.seller || '',
      seller2: data.seller2 || '', 
      seller3: data.seller3 || '',
      taxid: data.taxid || '',
      sell_name: data.sell_name || '',
      seller_address: {
        ad_no: data.ad_no || '', ad_m: data.ad_m || '', ad_rd: data.ad_rd || '',
        ad_tb: data.ad_tb || '', ad_mu: data.ad_mu || '', ad_pr: data.ad_pr || '',
        postid: parseNum(data.postid), ad_ph: data.ad_ph || '', taxid: data.taxid || ''
      },

      committee: [
        { name: data.comm_name1 || '', pos: data.comm_pos1 || '' },
        { name: data.comm_name2 || '', pos: data.comm_pos2 || '' },
        { name: data.comm_name3 || '', pos: data.comm_pos3 || '' }
      ],

      financial: {
        value: parseNum(data.value), income_tax: parseNum(data.income_tax),
        act_paid: parseNum(data.act_paid), total: parseNum(data.total),
        vat: parseNum(data.vat), ex_vat: parseNum(data.ex_vat),
        vat_type: data.vat_type || 'no_vat'
      },

      items: items.map(item => ({
        list: item.equipment || item.list || '', 
        equipment: item.equipment || item.list || '',
        torlist: item.torlist || '', 
        qu: parseNum(item.qu), 
        un: item.un || '',
        pr: parseNum(item.pr), 
        am: parseNum(item.am), 
        pr_type: data.method || 'ซื้อ'
      })),
      updated_at: new Date().toISOString()
    };

    const payRef = doc(db, "log_pay", data.log_no);
    await setDoc(payRef, payDocument, { merge: true });

    // 2. อัปเดตข้อมูลกลับไปยังคอลเลกชัน 'log_budget'
    try {
      const budgetRef = doc(db, "log_budget", data.log_no);
      await updateDoc(budgetRef, {
        details: data.objective || '',
        objective: data.objective || '',
        method: data.method || '',
        division: data.division || '',
        project: data.project || '',
        activities: data.activities || '',
        updated_at: new Date().toISOString()
      });
    } catch (bErr) {
      console.warn("⚠️ ไม่พบเอกสาร log_budget เพื่ออัปเดต:", bErr);
    }

    // 3. อัปเดตข้อมูลร้านค้าเข้าคอลเลกชัน 'suppliers'
    const cleanTaxId = (data.taxid || '').trim();
    if (cleanTaxId && cleanTaxId !== '-' && cleanTaxId !== '0') {
      try {
        const supRef = doc(db, "suppliers", cleanTaxId);
        await setDoc(supRef, {
          seller: data.seller || '',
          taxid: cleanTaxId,
          bidder_name: data.sell_name || data.bidder_name || '',
          invoice_type: data.invoice_type || '',
          ad_no: String(data.ad_no || ''),
          ad_m: String(data.ad_m || ''),
          ad_rd: String(data.ad_rd || ''),
          ad_tb: String(data.ad_tb || ''),
          ad_mu: String(data.ad_mu || ''),
          ad_pr: String(data.ad_pr || ''),
          ad_ph: String(data.ad_ph || ''),
          postid: parseNum(data.postid),
          updated_at: new Date().toISOString()
        }, { merge: true });
      } catch (supErr) {
        console.warn("⚠️ อัปเดตข้อมูลร้านค้า suppliers ล้มเหลว:", supErr);
      }
    }

    // 4. บันทึก Audit Log ลง Firestore
    await insertAuditLog("SAVE_PAY", `บันทึกข้อมูลเบิกจ่ายสำเร็จ เลข นผ.2: ${data.log_no}`, currentUser);

    // 5. เตรียม Payload ส่งให้ GAS Microservice สร้าง Google Doc / PDF
    const docDataPayload = await prepareDocDataForMicroservice(data, items);

    const gasResponse = await fetch(GAS_DOC_MICROSERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "generateDocFromTemplate",
        secretKey: "witchachaiyakul",
        docData: docDataPayload
      })
    });

    const docResult = await gasResponse.json();

    if (docResult.status === 'success') {
      return {
        status: 'success',
        logNo: data.log_no,
        poNo: data.po_no,
        docUrl: docResult.docUrl,
        wordDownloadUrl: docResult.wordDownloadUrl,
        pdfDownloadUrl: docResult.pdfDownloadUrl,
        message: 'บันทึกข้อมูลและสร้างเอกสารเรียบร้อย!'
      };
    } else {
      return { status: 'error', message: 'สร้างเอกสารไม่สำเร็จ: ' + docResult.message };
    }

  } catch (error) {
    console.error("❌ saveKbsPayData Error:", error);
    return { status: 'error', message: 'System Error: ' + error.message };
  }
}

export async function getOfficerByDivision(divisionName) {
  if (!divisionName) return "";
  try {
    const officersRef = collection(db, "officers");
    const q = query(
      officersRef,
      where("division", "==", divisionName.trim()),
      where("pos", "==", "เจ้าหน้าที่")
    );
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const officerData = querySnapshot.docs[0].data();
      return officerData.name || "";
    }
    return "";
  } catch (error) {
    console.error("❌ เกิดข้อผิดพลาดในการดึงข้อมูล officer จาก Firestore:", error);
    return "";
  }
}

export async function prepareDocDataForMicroservice(data, items) {
  // 1. ดึงข้อมูลที่อยู่พร้อมค่าสำรอง (Fallback)
  const adNo = data.ad_no || data.address_no || "";
  const adM  = data.ad_m  || data.address_moo || "";
  const adRd = data.ad_rd || data.address_road || "";
  const adTb = data.ad_tb || data.address_subdistrict || "";
  const adMu = data.ad_mu || data.address_district || "";
  const adPr = data.ad_pr || data.address_province || "";
  const postid = data.postid || data.zip_code || "";
  const adPh = data.ad_ph || data.tel_no || "";
  const taxid = data.taxid || data.tax_id || "";

  let fullAddress = adNo.trim(); 
  if (adM) fullAddress += ' ม.' + adM;
  if (adRd && adRd !== "-") fullAddress += ' ' + adRd; 
  if (adTb) fullAddress += ' ' + adTb;
  if (adMu) fullAddress += ' ' + adMu;
  if (adPr) fullAddress += ' ' + adPr;
  if (postid) fullAddress += ' ' + postid;

  const cleanPosition = (pos) => {
    if (!pos) return '';
    return pos.includes('รองผู้อำนวยการ') ? 'รองผู้อำนวยการ' : pos;
  };

  let rawObjective = (data.objective || data.details || "").trim();
  let cleanObjective = rawObjective.replace(/^(ซื้อ|จ้าง)\s*/, "");

  let prType = data.pr_type || data.method || "ซื้อ";
  let calculatedType = data.type || (prType.includes("ซื้อ") ? "พัสดุ" : "งานจ้าง");
  let calculatedSellerType = prType.includes("ซื้อ") ? "ขาย" : "รับจ้าง";

  const divStr = data.division ? String(data.division).trim() : "";
  let divPrefix = "รองผู้อำนวยการกลุ่มบริหารงาน";
  if (divStr.includes("กิจการนักเรียน")) {
    divPrefix = "ครูปฏิบัติหน้าที่รองผู้อำนวยการกลุ่มบริหารงาน";
  }
  const divisionTitle = divStr ? `${divPrefix}${divStr}` : "";

  let committeePerson = "";
  if (divStr.includes("บริหารทั่วไป")) committeePerson = "ว่าที่ร้อยตรีศรายุทธ พงค์ทองเมือง";
  else if (divStr.includes("วิชาการ")) committeePerson = "นางคนึงนิตย์ แฉล้มรักษ์";
  else if (divStr.includes("บุคคล")) committeePerson = "นางสาวสุทธิดา ธนบัตร";
  else if (divStr.includes("งบประมาณ")) committeePerson = "นางสาวเปรมฤดี จูหลง";
  else if (divStr.includes("กิจการนักเรียน")) committeePerson = "นายจีรพจน์ ทองขาว";

  // 🎯 ค้นหาเจ้าหน้าที่ (officer) จาก Firestore ตามกลุ่มงาน (division)
  let calculatedOfficer = data.officer || "";
  if (!calculatedOfficer && divStr) {
    calculatedOfficer = await getOfficerByDivision(divStr);
  }

  // 2. จัดการชุดกรรมการและบทบาท
  let hasCommittee = (data.comm_name2 && data.comm_name2.trim() !== "") || (data.comm_name3 && data.comm_name3.trim() !== "");
  let no1 = "", pos1 = "", pos_name1 = "", cr_sign1 = "";
  let no2 = "", pos2 = "", pos_name2 = "", cr_sign2 = "";
  let no3 = "", pos3 = "", pos_name3 = "", cr_sign3 = "";

  if (data.comm_name1 && data.comm_name1.trim() !== "") {
    no1 = hasCommittee ? "1.": ""; 
    pos1 = "ตำแหน่ง";
    pos_name1 = hasCommittee ? "ประธานกรรมการ" : "ผู้ตรวจรับ";
    cr_sign1 = "ลงชื่อ...............................ประธานกรรมการ/ผู้ตรวจรับ";
  }
  if (data.comm_name2 && data.comm_name2.trim() !== "") {
    no2 = "2."; 
    pos2 = "ตำแหน่ง";
    pos_name2 = "กรรมการ";
    cr_sign2 = "ลงชื่อ.....................................กรรมการ/ผู้ตรวจรับ";
  }
  if (data.comm_name3 && data.comm_name3.trim() !== "") {
    no3 = "3."; 
    pos3 = "ตำแหน่ง";
    pos_name3 = "กรรมการ/เลขานุการ";
    cr_sign3 = "ลงชื่อ.....................................กรรมการ/ผู้ตรวจรับ";
  }

  const validItems = items || [];
  const totalAmount = Number(String(data.total || data.amount || 0).replace(/,/g, '')) || 0;

  // 3. ประกอบโครงสร้าง docData
  const docData = {
    itemCount: validItems.length,
    date: toThaiDate(new Date(), false), 
    LOG_NO: data.log_no || "", 
    PR_TYPE: prType,
    type: calculatedType, 
    
    buyer: data.buyer || data.req_name || "",
    pos_buyer: data.pos_buyer || data.position_p || "",

    seller: data.seller || data.seller_name || "",
    seller2: data.seller2 || "",
    seller3: data.seller3 || "", 
    taxid: taxid,
    seller_address: fullAddress.trim(), 
    ad_no: adNo, ad_m: adM, ad_rd: adRd, ad_tb: adTb, 
    ad_mu: adMu, ad_pr: adPr, postid: postid, ad_ph: adPh,
    
    division: divStr, 
    division_prefix: divPrefix,
    division_title: divisionTitle,
    full_division: divisionTitle,
    committees: committeePerson,
    committee: committeePerson,

    officer: calculatedOfficer, 
    DB_director: "นางสาวเปรมฤดี จูหลง",
    head_officer: "นางสาวเปรมฤดี จูหลง",
    director: "นายเกียรติมงคล พูดเพราะ",
    financial_officer: "นางพรทิพย์ คงมาก",

    activities: data.activities || "", 
    project: data.project || "", 
    objective: cleanObjective, 
    to: data.to || "", 
    total: totalAmount, 
    bathtext: convertToThaiBahtText(totalAmount), 
    department: data.department || "", 
    d_dateline: data.d_dateline || "0",

    // 🎯 แปลงวันที่ทุกฟิลด์เป็นวันที่ไทย
    memo_date: toThaiDate(data.memo_date),
    ctor_date: toThaiDate(data.ctor_date),
    tor_rp_date: toThaiDate(data.tor_rp_date),

    PR_DATE: toThaiDate(data.qu_date), 
    announce_date: toThaiDate(data.announce_date), 
    PO_date: toThaiDate(data.po_date),
    PO_NO: data.po_no || "", 
    deadline: toThaiDate(data.deadline), 
    rc_date: toThaiDate(data.rc_date),
    invoice_no: data.invoice_no || data.doc_no || "", 
    invoice_book: data.invoice_book || data.book_no || "",
    invoice_type: data.invoice_type || "", 
    invoice_date: toThaiDate(data.invoice_date || data.cr_date),
    qu_date: toThaiDate(data.qu_date), 
    CR_date: toThaiDate(data.cr_date || data.invoice_date),
    
    seller_type: calculatedSellerType, 

    ex_vat: data.ex_vat || 0, 
    vat: (!data.vat || parseFloat(String(data.vat).replace(/,/g, '')) === 0) ? "-" : data.vat,
    quantity: validItems.length || data.quantity || "0",
    quarantee: data.quarantee || "", 
    sell_name: data.sell_name || data.bidder_name || "",
    
    comm_name1: data.comm_name1 || "", comm_pos1: cleanPosition(data.comm_pos1),
    comm_name2: data.comm_name2 || "", comm_pos2: data.comm_pos2 || "",
    comm_name3: data.comm_name3 || "", comm_pos3: data.comm_pos3 || "",
    
    no1: no1, pos1: pos1, pos_name1: pos_name1, cr_sign1: cr_sign1,
    no2: no2, pos2: pos2, pos_name2: pos_name2, cr_sign2: cr_sign2,
    no3: no3, pos3: pos3, pos_name3: pos_name3, cr_sign3: cr_sign3, 
    
    value: data.value || 0, 
    income_tax: (!data.income_tax || parseFloat(String(data.income_tax).replace(/,/g, '')) === 0) ? "-" : data.income_tax,
    act_paid: data.act_paid || 0
  };

  // 4. วนลูปพัสดุขยายรองรับสูงสุด 50 รายการ
  for (let i = 1; i <= 50; i++) {
    if (i <= validItems.length) {
      const item = validItems[i - 1];
      const unitPrice = Number(String(item.pr || 0).replace(/,/g, '')) || 0;
      const totalPrice = Number(String(item.am || 0).replace(/,/g, '')) || 0;

      const pbValue = unitPrice > 0 ? Math.floor(unitPrice * 1.05) : "";
      const pcValue = unitPrice > 0 ? Math.floor(unitPrice * 1.03) : "";

      const sbValue = totalPrice > 0 ? Math.floor(totalPrice * 1.05) : "";
      const scValue = totalPrice > 0 ? Math.floor(totalPrice * 1.03) : "";

      docData[`n${i}`] = i; 
      docData[`list${i}`] = item.equipment || item.list || "";
      docData[`torlist${i}`] = item.torlist || data[`torlist${i}`] || "";
      docData[`qu${i}`] = item.qu || ""; 
      docData[`un${i}`] = item.un || "";
      docData[`pr${i}`] = item.pr || ""; 
      docData[`sp${i}`] = item.am || "";

      docData[`pb${i}`] = pbValue; 
      docData[`pc${i}`] = pcValue; 
      docData[`sb${i}`] = sbValue; 
      docData[`sc${i}`] = scValue; 
    } else {
      docData[`n${i}`] = ""; docData[`list${i}`] = ""; docData[`torlist${i}`] = "";
      docData[`qu${i}`] = ""; docData[`un${i}`] = ""; docData[`pr${i}`] = ""; docData[`sp${i}`] = "";
      docData[`pb${i}`] = ""; docData[`pc${i}`] = "";
      docData[`sb${i}`] = ""; docData[`sc${i}`] = "";
    }
  }

  return docData;
}

export function internalParseThaiDate(thaiDateStr) {
  if (!thaiDateStr) return '';
  const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  
  let cleanStr = thaiDateStr.replace(/เดือน|พ\.ศ\./g, '').replace(/\s+/g, ' ').trim();
  let parts = cleanStr.split(' ');
  
  if (parts.length >= 3) {
    let day = parts[0].padStart(2, '0');
    let monthName = parts[1];
    let year = parseInt(parts[2]) - 543;
    let monthIdx = months.indexOf(monthName);
    
    if (monthIdx !== -1 && !isNaN(year)) {
      let month = String(monthIdx + 1).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  return '';
}

export function parseThaiDateToIso(str) { return internalParseThaiDate(str); }
export function parseThaiDateToISO(str) { return internalParseThaiDate(str); }
export function parsethaidatetoiso(str) { return internalParseThaiDate(str); }
export function parseThaiDateTolso(str) { return internalParseThaiDate(str); }

export function toThaiDate(dateInput, fullText = true) { 
  if (!dateInput) return '';
  let dateObj;
  if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else if (typeof dateInput === 'string' && dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const parts = dateInput.split('-');
    dateObj = new Date(parts[0], parts[1] - 1, parts[2]); 
  } else {
    return dateInput; 
  }
  if (isNaN(dateObj.getTime())) return '';

  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  const day = dateObj.getDate();
  const month = thaiMonths[dateObj.getMonth()];
  const year = dateObj.getFullYear() + 543;

  return fullText ? `${day} เดือน ${month} พ.ศ. ${year}` : `${day} ${month} ${year}`;
}

export function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === "") return "0.00";
  let cleanStr = String(amount).replace(/,/g, '');
  let num = Number(cleanStr);
  if (isNaN(num)) return "0.00";
  return num.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

export function convertToThaiBahtText(amount) {
  if (isNaN(amount) || amount === 0) return "ศูนย์บาทถ้วน";
  let text = ""; 
  let numberStr = parseFloat(amount).toFixed(2);
  let [intPart, decPart] = numberStr.split(".");
  const digits = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const positions = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
  
  function convertSection(numStr) {
    let res = ""; 
    let len = numStr.length;
    for (let i = 0; i < len; i++) {
      let digit = parseInt(numStr.charAt(i)); 
      let pos = len - 1 - i;
      if (digit !== 0) {
        if (pos === 1 && digit === 1) res += "สิบ";
        else if (pos === 1 && digit === 2) res += "ยี่สิบ";
        else if (pos === 0 && digit === 1 && len > 1) res += "เอ็ด";
        else res += digits[digit] + positions[pos];
      }
    }
    return res;
  }

  let chunks = [];
  while (intPart.length > 0) { chunks.push(intPart.slice(-6)); intPart = intPart.slice(0, -6); }
  for (let i = chunks.length - 1; i >= 0; i--) { text += convertSection(chunks[i]); if (i > 0) text += "ล้าน"; }
  text += text !== "" ? "บาท" : "";
  if (parseInt(decPart) === 0) text += "ถ้วน";
  else { text += convertSection(decPart) + "สตางค์"; }
  return text;
}

export function convertToThaiShortDate(dateInput) {
  if (!dateInput) return "";
  let d = new Date(dateInput);
  
  if (isNaN(d.getTime()) && typeof dateInput === 'string') {
    let parts = dateInput.split('/');
    if (parts.length === 3) {
      let mm = parseInt(parts[0], 10);
      let dd = parseInt(parts[1], 10);
      let yy = parseInt(parts[2], 10);
      d = (yy < 2500) ? new Date(yy, mm - 1, dd) : new Date(yy - 543, mm - 1, dd);
    }
  }
  
  if (isNaN(d.getTime())) return dateInput;
  
  let day = String(d.getDate()).padStart(2, '0');
  let month = String(d.getMonth() + 1).padStart(2, '0'); 
  let yearBE = d.getFullYear() + 543; 
  
  return `${day}/${month}/${yearBE}`;
}

export async function submitForm() {
    const form = document.getElementById('kbsForm'); 
    if (form && !form.checkValidity()) {
        alert('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน');
        return;
    }

    if (typeof validateBudget === 'function' && !validateBudget()) {
        alert('⚠️ ยอดรวมไม่ตรงกับงบที่ขอใช้ โปรดตรวจสอบยอดเงินอีกครั้ง');
        return;
    }

    const saveBtn = document.getElementById('saveBtn');
    const originalBtnText = saveBtn ? saveBtn.innerHTML : ''; 
    
    if (saveBtn) {
        saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>กำลังบันทึกข้อมูล ออกเลข PO และสร้างเอกสาร...`;
        saveBtn.disabled = true;
    }

    // 🎯 ดึงค่าวันที่จากหน้าจอ
    const getDateVal = (fieldPrefix, fallback = '') => {
        const displayElem = document.getElementById(`${fieldPrefix}_display`);
        const hiddenElem  = document.getElementById(`${fieldPrefix}_hidden`);
        const pickerElem  = document.getElementById(`${fieldPrefix}_picker`);

        const displayVal = displayElem ? displayElem.value.trim() : '';
        const hiddenVal  = hiddenElem ? hiddenElem.value.trim() : '';
        const pickerVal  = pickerElem ? pickerElem.value.trim() : '';

        if (displayVal && displayVal.includes('/')) {
            const parts = displayVal.split('/');
            if (parts.length === 3) {
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                let year = parseInt(parts[2], 10);
                if (year > 2400) year -= 543;
                return `${year}-${month}-${day}`;
            }
        }

        return hiddenVal || pickerVal || displayVal || fallback;
    };

    try {
        const prDate = getDateVal('date_req') || 
                       document.getElementById('doc_date')?.value || 
                       new Date().toISOString().split('T')[0];
                       
        const methodVal = document.getElementById('method') ? document.getElementById('method').value.trim() : 'ซื้อ';
        
        let poType = 'po';
        if (methodVal.includes('จ้าง')) {
            poType = 'wo';
        } else if (methodVal.includes('น้ำมัน')) {
            poType = 'fpo';
        }

        // 🎯 ดึงค่าสำคัญที่ต้องใช้ล่วงหน้า (logNo, grandTotal, ฯลฯ) ให้เรียบร้อยก่อนประกอบ Object
        const logNo = document.getElementById('logNoInput')?.value.trim() || '';
        const deliveryDaysVal = parseInt(document.getElementById('deliveryDays')?.value, 10) || 7;
        const grandTotal = document.getElementById('cal_grandtotal')?.value || '0.00';
        const exVat = document.getElementById('cal_subtotal')?.value || '0.00';
        const vatVal = document.getElementById('cal_vat')?.value || '0.00';
        const taxVal = document.getElementById('cal_income_tax')?.value || '0.00';
        const actPaid = document.getElementById('cal_act_paid')?.value || '0.00';

        // 🎯 คำนวณรันเลข PO
        const existingPoNo = document.getElementById('po_no_hidden')?.value.trim() || '';
        let poGenerated = { log_po: '', base_no: 0, sub_no: 0, year_be: '' };

        if (existingPoNo && existingPoNo !== '-') {
            poGenerated = {
                log_po: existingPoNo,
                base_no: Number(document.getElementById('po_base_no_hidden')?.value) || 0,
                sub_no: Number(document.getElementById('po_sub_no_hidden')?.value) || 0,
                year_be: Number(document.getElementById('po_year_be_hidden')?.value) || (new Date().getFullYear() + 543)
            };
        } else {
            // ดึงประวัติเพื่อคำนวณเลขรันวันทำการ
            const holidays = window.allHolidays || (typeof getHolidaysFromFirestore === 'function' ? await getHolidaysFromFirestore() : []);
            const poLogs = window.allPoLogs || (typeof getLogPoDataFromFirestore === 'function' ? await getLogPoDataFromFirestore() : []);
            poGenerated = generateLogPoNumber(poType, prDate, poLogs, holidays);
        }

        // 🎯 1. ดึงรายการพัสดุจากหน้าจอ
        const equipmentItems = [];
        const tableRows = document.querySelectorAll('#itemListBody tr').length;
        const maxRows = Math.max(
            typeof window.currentRowCount !== 'undefined' ? window.currentRowCount : 0,
            tableRows,
            10
        );

        for (let i = 1; i <= maxRows; i++) {
            const eqInput = document.getElementById(`list${i}`) || document.getElementsByName(`list${i}`)[0];
            const eqName = eqInput ? eqInput.value.trim() : "";

            if (eqName !== "") {
                const quVal = parseFloat(document.getElementById(`qu${i}`)?.value) || 0;
                const unVal = document.getElementById(`un${i}`)?.value || document.getElementsByName(`un${i}`)[0]?.value || '';
                const prVal = parseFloat(document.getElementById(`pr${i}`)?.value) || 0;
                const rawAm = document.getElementById(`am${i}`)?.value || "0.00";
                const amVal = parseFloat(String(rawAm).replace(/,/g, '')) || 0;
                const torVal = document.getElementById(`torlist${i}`)?.value.trim() || "";

                equipmentItems.push({
                    log_no: logNo, 
                    equipment: eqName,
                    list: eqName,
                    torlist: torVal,
                    qu: quVal,
                    un: unVal,
                    pr: prVal,
                    am: amVal,
                    sp: amVal 
                });
            }
        }

        // 🎯 2. ประกอบข้อมูลและบันทึกลง log_po
        const logPoRecord = {
            log_po: poGenerated.log_po,
            doc_type: poType,
            base_no: poGenerated.base_no,
            sub_no: poGenerated.sub_no,
            year_be: poGenerated.year_be,
            pr_date: prDate,
            po_date: getDateVal('date_po', prDate),
            log_no_ref: logNo,
            details: document.getElementById('details')?.value || document.getElementById('objective')?.value || '',
            total: parseFloat(String(grandTotal).replace(/,/g, '')) || 0,
            division: document.getElementById('division')?.value || '',
            seller: document.getElementById('seller_name')?.value || '',
            seller2: document.getElementById('seller2')?.value.trim() || '',
            seller3: document.getElementById('seller3')?.value.trim() || '',
            taxid: document.getElementById('tax_id')?.value || '',
            ad_ph: document.getElementById('tel_no')?.value || '',
            ad_no: document.getElementById('address_no')?.value || '',
            ad_m: document.getElementById('address_moo')?.value || '',
            ad_rd: document.getElementById('address_road')?.value || '',
            ad_tb: document.getElementById('address_subdistrict')?.value || '',
            ad_mu: document.getElementById('address_district')?.value || '',
            ad_pr: document.getElementById('address_province')?.value || '',
            postid: Number(document.getElementById('zip_code')?.value) || 0,
            bidder_name: document.getElementById('bidder_name')?.value || '',
            is_manual: false,
            created_at: prDate
        };

        if (typeof saveLogPoToFirestore === 'function') {
            await saveLogPoToFirestore(logPoRecord);
        }

        // 🎯 3. โครงสร้างข้อมูลสำหรับ Firestore (log_pay)
        const payData = {
            row_number: document.getElementById('row_number')?.value || '0', 
            log_no: logNo,
            to: document.querySelector('input[name="to"]')?.value || '',
            po_no: poGenerated.log_po,
            po_base_no: poGenerated.base_no,
            po_sub_no: poGenerated.sub_no,
            po_year_be: poGenerated.year_be,
            doc_type: poType,

            buyer: document.getElementById('buyer')?.value.trim() || document.getElementById('req_name')?.value.trim() || '',
            pos_buyer: document.getElementById('pos_buyer')?.value.trim() || document.getElementById('position_p')?.value.trim() || '',
            
            delivery_days: deliveryDaysVal,
            d_dateline: deliveryDaysVal,
            pr_type: methodVal,
            method: methodVal,
            
            project: document.getElementById('project')?.value || document.getElementById('budget_project')?.value || '',
            activities: document.getElementById('activities')?.value || document.getElementById('budget_activities')?.value || '',
            objective: document.getElementById('details')?.value || document.getElementById('objective')?.value || '',
            division: document.getElementById('division')?.value || '', 

            memo_date: getDateVal('date_memo'),
            ctor_date: getDateVal('date_ctor'),
            tor_rp_date: getDateVal('date_tor_rp'),
            qu_date: getDateVal('date_req', prDate),       
            rc_date: getDateVal('date_result'), 
            announce_date: getDateVal('date_announce'), 
            po_date: getDateVal('date_po', prDate),       
            deadline: getDateVal('date_delivery'),   
            cr_date: getDateVal('date_receive', prDate),   
            invoice_date: getDateVal('date_receive', prDate),       
            
            comm_name1: document.getElementById('comm_name1')?.value || '',
            comm_pos1: document.getElementById('comm_pos1')?.value || '',
            comm_name2: document.getElementById('comm_name2')?.value || '',
            comm_pos2: document.getElementById('comm_pos2')?.value || '',
            comm_name3: document.getElementById('comm_name3')?.value || '',
            comm_pos3: document.getElementById('comm_pos3')?.value || '',
            
            seller: document.getElementById('seller_name')?.value || '',
            seller2: document.getElementById('seller2')?.value.trim() || '',
            seller3: document.getElementById('seller3')?.value.trim() || '',
            
            ad_no: document.getElementById('address_no')?.value || '',
            ad_m: document.getElementById('address_moo')?.value || '',
            ad_rd: document.getElementById('address_road')?.value || '',
            ad_tb: document.getElementById('address_subdistrict')?.value || '',
            ad_mu: document.getElementById('address_district')?.value || '',
            ad_pr: document.getElementById('address_province')?.value || '',
            postid: document.getElementById('zip_code')?.value || '',
            ad_ph: document.getElementById('tel_no')?.value || '',
            taxid: document.getElementById('tax_id')?.value || '',
            sell_name: document.getElementById('bidder_name')?.value || '',
            
            invoice_type: document.getElementById('invoice_type')?.value || '',
            invoice_no: document.querySelector('input[name="doc_no"]')?.value || '',
            invoice_book: document.querySelector('input[name="book_no"]')?.value || '',
            
            ex_vat: exVat,
            vat: vatVal,
            total: grandTotal,
            value: document.getElementById('cal_value')?.value || '0.00',
            income_tax: taxVal,
            act_paid: actPaid,
            vat_type: document.querySelector('input[name="vat_type"]:checked')?.value || 'no_vat',
            
            items: equipmentItems,
            quantity: equipmentItems.length,
            isPaid: true,
            status: 'paid',
            updatedAt: serverTimestamp()
        };

        // 💾 4. บันทึกลง Firestore (log_pay)
        const payDocRef = doc(db, "log_pay", logNo);
        await setDoc(payDocRef, payData, { merge: true });

        try {
            const budgetDocRef = doc(db, "log_budget", logNo);
            const budgetSnap = await getDoc(budgetDocRef);
            if (budgetSnap.exists()) {
                await updateDoc(budgetDocRef, { 
                    isPaid: true, 
                    status: 'paid',
                    po_no: poGenerated.log_po,
                    updatedAt: serverTimestamp() 
                });
            }
        } catch (eBudget) {
            console.warn("⚠️ ไม่สามารถอัปเดต log_budget ได้:", eBudget);
        }

        console.log("✅ บันทึกฐานข้อมูล Firestore เรียบร้อยแล้ว");

        // 🎯 5. ส่งข้อมูลไปยัง GAS Web App Microservice เพื่อสร้างเอกสาร
        const finalDocData = await prepareDocDataForMicroservice(payData, equipmentItems);

        const gasPayload = {
            secretKey: INTERNAL_SECRET_KEY,
            action: "generateDocFromTemplate",
            docData: finalDocData
        };

        const response = await fetch(GAS_DOC_MICROSERVICE_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(gasPayload)
        });

        const gasResult = await response.json();

        if (saveBtn) {
            saveBtn.innerHTML = originalBtnText;
            saveBtn.disabled = false;
        }

        // 🎨 6. แสดงผลสำเร็จบน UI
        if (gasResult && gasResult.status === 'success') {
            let htmlContent = `
                <div style="text-align: center; padding: 25px; background-color: #f0fff4; border: 2px solid #28a745; border-radius: 10px; margin-top: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <h3 style="color: #28a745; margin-bottom: 10px;">✅ บันทึกและสร้างเอกสารสำเร็จ!</h3>
                    
                    <div style="margin-bottom: 15px; font-size: 1.1rem; color: #155724;">
                        <span>เลข นผ.2: <b>${payData.log_no}</b></span> | 
                        <span>เลข PO ที่ได้รับ: <b style="color: #d9534f; font-size: 1.2rem;">${payData.po_no || '-'}</b></span>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <a href="${gasResult.docUrl}" target="_blank" role="button" 
                           style="background-color: #007BFF; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-size: 1.1rem; font-weight: bold; display: inline-block; margin: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                           📄 เปิดไฟล์ Google Docs (สำหรับจัดพิมพ์เอกสารราชการ)
                        </a>
                    </div>

                    <div style="text-align: left; background-color: #ffffff; border: 1px solid #c3e6cb; border-radius: 8px; padding: 20px; margin: 20px auto 15px auto; max-width: 580px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.05);">
                        <h5 style="color: #155724; margin-top: 0; margin-bottom: 12px; font-weight: bold;">
                            📋 ลำดับในการเรียงเอกสารเพื่อจัดชุดส่งงาน
                        </h5>
                        <ol style="margin: 0; padding-left: 22px; color: #1c7430; font-size: 0.95rem; line-height: 1.65;">
                            <li><b>นผ.2</b></li>
                            <li>ใบกำกับภาษี / ใบส่งของ / หนังสือส่งงาน</li>
                            <li>เอกสารของผู้ขายหรือผู้รับจ้าง</li>
                            <li>รายงานผลการตรวจรับพัสดุและอนุมัติจ่ายเงิน</li>
                            <li>ใบตรวจรับพัสดุ</li>
                            <li>ใบสั่งซื้อ / ใบสั่งจ้าง (PO)</li>
                            <li>ประกาศผู้ชนะการเสนอราคา</li>
                            <li>รายงานผลการพิจารณาและขออนุมัติสั่งซื้อ/จ้าง</li>
                            <li>ใบเสนอราคา</li>
                            <li>รายงานขอซื้อ / รายงานขอจ้าง</li>
                            <li>คุณลักษณะเฉพาะของพัสดุที่จะจัดซื้อจัดจ้าง</li>
                        </ol>
                    </div>

                    <div style="margin-top: 15px;">
                        <button type="button" onclick="if(typeof handleNewTransaction === 'function') handleNewTransaction();" 
                                style="background-color: #ffc107; color: #343a40; border: none; padding: 10px 25px; border-radius: 8px; font-weight: bold; font-size: 1rem; display: inline-block; cursor: pointer;">
                            🔄 ทำรายการใหม่ (เขียนใบต่อไป)
                        </button>
                    </div>
                </div>
            `;

            const msgDiv = document.getElementById('message');
            if (msgDiv) {
                msgDiv.innerHTML = htmlContent;
                msgDiv.scrollIntoView({ behavior: 'smooth' });
            }

            if (saveBtn) saveBtn.style.display = 'none';
        } else {
            alert("⚠️ บันทึก Firestore สำเร็จ แต่สร้างเอกสารไม่สำเร็จ: " + (gasResult ? gasResult.message : 'Unknown Error'));
        }

    } catch (error) {
        console.error("❌ submitForm Error:", error);
        if (saveBtn) {
            saveBtn.innerHTML = originalBtnText;
            saveBtn.disabled = false;
        }
        alert("⚠️ เกิดข้อผิดพลาดขณะบันทึกข้อมูล: " + error.message);
    }
}

export function handleNewTransaction() {
    // 1. เคลียร์ข้อมูลในฟอร์มทั้งหมด
    if (typeof clearFormExceptLogNo === 'function') {
        clearFormExceptLogNo();
    }
    
    // 2. เคลียร์ช่องกรอกเลข นผ.2 และย้ายเคอร์เซอร์ไปรอที่ช่องนี้
    const logNoInput = document.getElementById('logNoInput');
    if (logNoInput) {
        logNoInput.value = '';
        logNoInput.focus();
    }

    // 3. รีเซ็ตข้อความสถานะการค้นหา
    const searchStatus = document.getElementById('searchStatus');
    if (searchStatus) {
        searchStatus.innerText = '* กรอกเลขเพื่อดึงข้อมูล';
    }

    // 4. ล้างกล่องข้อความแจ้งเตือนผลการบันทึกเอกสารเดิม (#message)
    const msg = document.getElementById('message');
    if (msg) {
        msg.innerHTML = '';
    }

    // 5. แสดงปุ่มบันทึกข้อมูลกลับมา
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
        saveBtn.style.display = 'inline-block';
        saveBtn.innerHTML = "💾 บันทึกและสร้าง PDF";
    }

    // 6. ล้างตัวแปร Global สถิติทรัพย์สิน/งบประมาณปัจจุบัน
    window.currentBudget = null;
}

function calculateTotals() {
    // กำหนดค่า MAX_ROWS สำรองไว้กรณีไม่ได้ประกาศตัวแปรไว้ล่วงหน้า
    const maxRows = typeof MAX_ROWS !== 'undefined' ? MAX_ROWS : 10;
    
    let totalSubtotal = 0;
    let totalQuantity = 0;
            
    for (let i = 1; i <= maxRows; i++) {
        const quInput = document.getElementById(`qu${i}`);
        const prInput = document.getElementById(`pr${i}`);
        if (!quInput && !prInput) continue;

        const qu = parseFloat(quInput?.value) || 0;
        const pr = parseFloat(prInput?.value) || 0;
        const amount = qu * pr;
                
        const amInput = document.getElementById(`am${i}`);
        if (amInput) amInput.value = formatMoney(amount);
                
        totalSubtotal += amount;
        totalQuantity += qu;
    }
            
    const vatType = document.querySelector('input[name="vat_type"]:checked')?.value || 'no_vat';
    let subtotal = 0; 
    let vat = 0;
    let grandTotal = 0;
            
    if (vatType === 'ex_vat') {
        subtotal = totalSubtotal;
        vat = subtotal * 0.07;
        grandTotal = subtotal + vat;
    } else if (vatType === 'in_vat') {
        grandTotal = totalSubtotal;
        subtotal = grandTotal / 1.07;
        vat = grandTotal - subtotal;
    } else { 
        subtotal = totalSubtotal;
        vat = 0;
        grandTotal = subtotal;
    }
            
    const elSubtotal = document.getElementById('cal_subtotal');
    const elVat = document.getElementById('cal_vat');
    const elGrandTotal = document.getElementById('cal_grandtotal');

    if (elSubtotal) elSubtotal.value = formatMoney(subtotal);
    if (elVat) elVat.value = formatMoney(vat);
    if (elGrandTotal) {
        elGrandTotal.value = formatMoney(grandTotal);
        elGrandTotal.dataset.value = grandTotal.toFixed(2);
    }

    calculateWithholdingTax(subtotal, grandTotal);
            
    const msgDiv = document.getElementById('validationMessage');
    if (msgDiv) msgDiv.innerText = "";
}

// 2. ฟังก์ชันคำนวณภาษีหัก ณ ที่จ่าย (ขึ้นอยู่กับนิติบุคคล/บุคคลธรรมดา และยอดรวม)
function calculateWithholdingTax(subtotal, grandTotal) {
    const taxId = (document.getElementById('tax_id')?.value || "").trim();
    const firstChar = taxId.charAt(0);
    
    let taxValue = subtotal; // ราคาสินค้าก่อน VAT
    let incomeTax = 0;
    
    if (!taxId) {
        // ยังไม่ได้กรอกเลขประจำตัวผู้เสียภาษี -> คำนวณเป็น 0
        incomeTax = 0;
    } else if (firstChar === '0') { 
        // 🏢 นิติบุคคล (ขึ้นต้นด้วยเลข 0)
        if (grandTotal >= 501) {
            incomeTax = taxValue * 0.01; // ยอด 501 บาทขึ้นไป หัก 1%
        } else {
            incomeTax = 0; // ยอด 0-500 บาท ไม่หัก
        }
    } else { 
        // 👤 บุคคลธรรมดา (ไม่ได้ขึ้นต้นด้วยเลข 0)
        if (grandTotal >= 10001) {
            incomeTax = taxValue * 0.01; // ยอด 10,001 บาทขึ้นไป หัก 1%
        } else {
            incomeTax = 0; // ยอด 0-10,000 บาท ไม่หัก
        }
    }
    
    let actPaid = grandTotal - incomeTax;
    
    // แสดงผลบนหน้าจอ
    const elVal = document.getElementById('cal_value');
    const elTax = document.getElementById('cal_income_tax');
    const elAct = document.getElementById('cal_act_paid');

    if (elVal) elVal.value = formatMoney(taxValue);
    if (elTax) elTax.value = formatMoney(incomeTax);
    if (elAct) elAct.value = formatMoney(actPaid);
}

// 3. ฟังก์ชันแปลงตัวเลขเป็นฟอร์แมตเงิน (ถ้าใน pay.js มีอยู่แล้ว ไม่ต้องก๊อปปี้ส่วนนี้ไปครับ)
if (typeof formatMoney !== 'function') {
    function formatMoney(num) {
        return (parseFloat(num) || 0).toLocaleString('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
}

export function refreshAllDateDisplays() {
    const dateMappings = [
        { picker: 'date_memo_picker', display: 'date_memo_display' },
        { picker: 'date_ctor_picker', display: 'date_ctor_display' },
        { picker: 'date_tor_rp_picker', display: 'date_tor_rp_display' },
        { picker: 'date_req_picker', display: 'date_req_display' },
        { picker: 'date_result_picker', display: 'date_result_display' },
        { picker: 'date_announce_picker', display: 'date_announce_display' },
        { picker: 'date_po_picker', display: 'date_po_display' },
        { picker: 'date_delivery_picker', display: 'date_delivery_display' },
        { picker: 'date_receive_picker', display: 'date_receive_display' }
    ];
    
    dateMappings.forEach(item => {
        const p = document.getElementById(item.picker);
        if (p && p.value) {
            syncDateBE(p, item.display);
        } else {
            const d = document.getElementById(item.display);
            if (d) d.value = "";
        }
    });
}

/**
 * 🧮 ฟังก์ชันคำนวณวันทำการถอยหลังและเดินหน้าอัตโนมัติ 9 รายการจากวันที่ตรวจรับ
 */
export function updateDateCalculation() {
    // 1. ดึง Element วันที่เอกสาร (รองรับ doc_date, invoice_date, cr_date)
    const docDateInput = document.getElementById('doc_date') || 
                         document.getElementById('invoice_date') || 
                         document.getElementById('cr_date');
    const deliveryDaysInput = document.getElementById('deliveryDays');

    if (!docDateInput) return;

    const docDateVal = docDateInput.value ? docDateInput.value.trim() : '';
    const deliveryDays = deliveryDaysInput ? (parseInt(deliveryDaysInput.value, 10) || 0) : 0;
    const refDateDisplay = document.getElementById('refDateDisplay');
    const holidays = window.holidays || window.allHolidays || [];

    const safeSetValue = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    // 🎯 Helper สำหรับหยอดค่าลง refDateDisplay (รองรับทั้ง <input>, <span>, <div>)
    const setRefDisplay = (text) => {
        if (!refDateDisplay) return;
        if (refDateDisplay.tagName === 'INPUT') {
            refDateDisplay.value = text;
        } else {
            refDateDisplay.innerText = text;
            refDateDisplay.textContent = text;
        }
    };

    // กรณีไม่ได้ระบุวันที่เอกสาร
    if (!docDateVal) {
        setRefDisplay('...');
        const fields = ['date_memo', 'date_ctor', 'date_tor_rp', 'date_req', 'date_result', 'date_announce', 'date_po', 'date_delivery', 'date_receive'];
        fields.forEach(f => {
            safeSetValue(f + '_picker', '');
            safeSetValue(f + '_hidden', '');
        });
        if (typeof refreshAllDateDisplays === 'function') refreshAllDateDisplays();
        return; 
    }
        
    // 🎯 หยอดค่าแสดงผล refDateDisplay ทันที (แปลงเป็น พ.ศ. DD/MM/YYYY)
    if (docDateVal.includes('-')) {
        const parts = docDateVal.split('-');
        if (parts.length === 3) {
            const y = parseInt(parts[0], 10) + 543;
            setRefDisplay(`${parts[2]}/${parts[1]}/${y}`);
        }
    } else if (docDateVal.includes('/')) {
        const parts = docDateVal.split('/');
        if (parts.length === 3) {
            let y = parseInt(parts[2], 10);
            if (y < 2400) y += 543;
            setRefDisplay(`${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${y}`);
        }
    } else {
        setRefDisplay(docDateVal);
    }

    // 2. แปลงวันที่สำหรับนำไปคำนวณวันทำการ
    let dateParts = [];
    if (docDateVal.includes('-')) {
        dateParts = docDateVal.split('-');
    } else if (docDateVal.includes('/')) {
        const p = docDateVal.split('/');
        let y = parseInt(p[2], 10);
        if (y > 2400) y -= 543;
        dateParts = [y, p[1], p[0]];
    }

    if (dateParts.length !== 3) return;

    const docDate = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10));
    let date_memo, date_ctor, date_tor_rp, date_req, date_result, date_announce, date_po, date_delivery, date_receive;
        
    date_receive = new Date(docDate); 

    // คำนวณถอยหลังหาวันทำการ
    let backwardDate = new Date(date_receive);
    let count = 0;
    let loopLimit1 = 0;
    while (count < 3 && loopLimit1 < 30) { 
        loopLimit1++;
        backwardDate.setDate(backwardDate.getDate() - 1);
        if (isWorkingDay(backwardDate, holidays)) count++;
    }
    date_po = new Date(backwardDate);

    let backwardDate2 = new Date(date_po);
    let loopLimit2 = 0;
    do {
        loopLimit2++;
        backwardDate2.setDate(backwardDate2.getDate() - 1);
    } while (!isWorkingDay(backwardDate2, holidays) && loopLimit2 < 30);
    date_announce = new Date(backwardDate2);

    let backwardDate3 = new Date(date_announce);
    let loopLimit3 = 0;
    do {
        loopLimit3++;
        backwardDate3.setDate(backwardDate3.getDate() - 1);
    } while (!isWorkingDay(backwardDate3, holidays) && loopLimit3 < 30);
    date_result = new Date(backwardDate3);

    let backwardDate4 = new Date(date_result);
    let loopLimit4 = 0;
    do {
        loopLimit4++;
        backwardDate4.setDate(backwardDate4.getDate() - 1);
    } while (!isWorkingDay(backwardDate4, holidays) && loopLimit4 < 30);
    date_req = new Date(backwardDate4);

    // 1. วันที่ขออนุมัติจัดซื้อ (memo_date) = ถอยหลังหาวันทำการ 7 วัน
    let memoTemp = new Date(date_req);
    let countMemo = 0;
    let limitMemo = 0;
    while (countMemo < 7 && limitMemo < 30) {
        limitMemo++;
        memoTemp.setDate(memoTemp.getDate() - 1);
        if (isWorkingDay(memoTemp, holidays)) countMemo++;
    }
    date_memo = new Date(memoTemp);

    // 2. วันที่ขออนุมัติแต่งตั้งคณะกรรมการ (ctor_date) = ขยับไปข้างหน้าหาวันทำการถัดไป
    let ctorTemp = new Date(date_memo);
    let limitCtor = 0;
    do {
        limitCtor++;
        ctorTemp.setDate(ctorTemp.getDate() + 1);
    } while (!isWorkingDay(ctorTemp, holidays) && limitCtor < 30);
    date_ctor = new Date(ctorTemp);

    // 3. วันที่รายงานผลตรวจร่าง TOR (tor_rp_date) = เดินหน้าหาวันทำการ 3 วัน
    let torTemp = new Date(date_ctor);
    let countTor = 0;
    let limitTor = 0;
    while (countTor < 3 && limitTor < 30) {
        limitTor++;
        torTemp.setDate(torTemp.getDate() + 1);
        if (isWorkingDay(torTemp, holidays)) countTor++;
    }
    date_tor_rp = new Date(torTemp);

    // วันกำหนดส่งมอบ
    let deliveryDate = new Date(date_po);
    deliveryDate.setDate(deliveryDate.getDate() + deliveryDays);
    date_delivery = new Date(deliveryDate);

    // หยอดค่า Pickers
    safeSetValue('date_memo_picker', formatDate(date_memo));
    safeSetValue('date_ctor_picker', formatDate(date_ctor));
    safeSetValue('date_tor_rp_picker', formatDate(date_tor_rp));
    safeSetValue('date_req_picker', formatDate(date_req));
    safeSetValue('date_result_picker', formatDate(date_result));
    safeSetValue('date_announce_picker', formatDate(date_announce));
    safeSetValue('date_po_picker', formatDate(date_po));
    safeSetValue('date_delivery_picker', formatDate(date_delivery));
    safeSetValue('date_receive_picker', formatDate(date_receive));
        
    // หยอดค่า Hiddens
    safeSetValue('date_memo_hidden', formatDate(date_memo));
    safeSetValue('date_ctor_hidden', formatDate(date_ctor));
    safeSetValue('date_tor_rp_hidden', formatDate(date_tor_rp));
    safeSetValue('date_req_hidden', formatDate(date_req));
    safeSetValue('date_result_hidden', formatDate(date_result));
    safeSetValue('date_announce_hidden', formatDate(date_announce));
    safeSetValue('date_po_hidden', formatDate(date_po));
    safeSetValue('date_delivery_hidden', formatDate(date_delivery));
    safeSetValue('date_receive_hidden', formatDate(date_receive));

    if (typeof refreshAllDateDisplays === 'function') refreshAllDateDisplays();
}

export function formatDate(date) {
    if (!date || isNaN(date.getTime())) return '';
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function isWorkingDay(dateObj, holidayList = window.holidays || window.allHolidays || []) {
    const dayOfWeek = dateObj.getDay(); // 0 = อาทิตย์, 6 = เสาร์
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return false;
    }

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    // รองรับ holidayList ทั้ง Array ของ String และ Object { date: '...' }
    if (Array.isArray(holidayList)) {
        const formattedHolidays = holidayList.map(h => {
            let rawDate = (typeof h === 'object' && h !== null) ? (h.date || h) : h;
            if (!rawDate) return '';
            const d = new Date(rawDate);
            if (isNaN(d.getTime())) return String(rawDate).trim();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dt = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${dt}`;
        });

        if (formattedHolidays.includes(dateStr)) {
            return false;
        }
    }

    return true;
}

export function syncDateBE(pickerElement, displayId) {
    const displayInput = document.getElementById(displayId);
    if (!pickerElement || !displayInput) return;
    
    const val = pickerElement.value; 
    if (!val) {
        displayInput.value = ""; 
        return;
    }
    
    const parts = val.split('-');
    if (parts.length === 3) {
        const y = parseInt(parts[0], 10) + 543; 
        const m = parts[1];
        const d = parts[2];
        displayInput.value = `${d}/${m}/${y}`; 
    }
}

/**
 * 📅 ฟังก์ชันอัปเดตข้อความ refDateDisplay เฉพาะส่วนแสดงผลบน HTML
 */
export function updateRefDateDisplayOnly() {
    const docDateInput = document.getElementById('doc_date') || 
                         document.getElementById('invoice_date') || 
                         document.getElementById('cr_date') ||
                         document.querySelector('input[name="doc_date"]');
                         
    const refDisplay = document.getElementById('refDateDisplay');
    if (!docDateInput || !refDisplay) return;

    const val = docDateInput.value ? docDateInput.value.trim() : '';
    if (!val) {
        refDisplay.innerText = '...';
        return;
    }

    // แปลง YYYY-MM-DD (ค.ศ.) -> DD/MM/YYYY (พ.ศ.)
    if (val.includes('-')) {
        const parts = val.split('-');
        if (parts.length === 3) {
            const yearBE = parseInt(parts[0], 10) + 543;
            refDisplay.innerText = `${parts[2]}/${parts[1]}/${yearBE}`;
            return;
        }
    } 
    
    // กรณีเป็นรูปแบบ DD/MM/YYYY
    if (val.includes('/')) {
        const parts = val.split('/');
        if (parts.length === 3) {
            let year = parseInt(parts[2], 10);
            if (year < 2400) year += 543;
            refDisplay.innerText = `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${year}`;
            return;
        }
    }

    refDisplay.innerText = val;
}

export function updateCommittee(budget = 0, data = {}) {
    const container = document.getElementById('committee_container');
    if (!container) return;
    let html = '';
    
    // 🎯 1. แกะข้อมูลจาก Array committee (ถ้าไม่มี ให้ Fallback ไปอ่านแบบเดิม)
    const commArray = (data && Array.isArray(data.committee)) ? data.committee : [];
    
    const comm_name1 = (commArray[0] && commArray[0].name) || (data && data.comm_name1) || '';
    const comm_pos1 = (commArray[0] && commArray[0].pos) || (data && data.comm_pos1) || '';

    const comm_name2 = (commArray[1] && commArray[1].name) || (data && data.comm_name2) || '';
    const comm_pos2 = (commArray[1] && commArray[1].pos) || (data && data.comm_pos2) || '';

    const comm_name3 = (commArray[2] && commArray[2].name) || (data && data.comm_name3) || '';
    const comm_pos3 = (commArray[2] && commArray[2].pos) || (data && data.comm_pos3) || '';

    // 🎯 2. เช็คว่ามีข้อมูลกรรมการที่เคยบันทึกไว้หรือไม่
    const hasSavedCommittee = !!(comm_name1 || comm_name2 || comm_name3);

    // แปลงตัวเลขงบประมาณ ป้องกันกรณีส่งข้อความประเภท string ที่ติดคอมมาเข้ามา
    const numericBudget = typeof budget === 'number' 
        ? budget 
        : parseFloat(String(budget).replace(/,/g, '')) || 0;

    if (numericBudget >= 5000) {
        const name1 = hasSavedCommittee ? comm_name1 : ((data && data.deputy_name) || "");
        const pos1 = hasSavedCommittee ? comm_pos1 : ((data && data.position_p) || "");
        
        const name2 = hasSavedCommittee ? comm_name2 : ((data && data.req_name) || "");
        const pos2 = hasSavedCommittee ? comm_pos2 : "ครู";
        
        const name3 = hasSavedCommittee ? comm_name3 : "";
        const pos3 = hasSavedCommittee ? comm_pos3 : "";

        html += `<div class="alert alert-primary text-center fw-bold mb-3 py-2">-- ชุดคณะกรรมการ (งบเกิน 5,000 บาท) --</div>`;
        html += createMemberRow(1, "ประธานกรรมการ", name1, pos1);
        html += createMemberRow(2, "กรรมการ", name2, pos2);
        html += createMemberRow(3, "กรรมการ/เลขานุการ", name3, pos3);
    } else {
        html += `<div class="alert alert-success text-center fw-bold mb-3 py-2">-- ชุดกรรมการตรวจรับ (งบไม่เกิน 5,000 บาท) --</div>`;
        
        const name1 = hasSavedCommittee ? comm_name1 : ((data && data.req_name) || "");
        const pos1 = hasSavedCommittee ? comm_pos1 : "ครู";
        
        const name2 = hasSavedCommittee ? comm_name2 : "";
        const pos2 = hasSavedCommittee ? comm_pos2 : "";
        
        const name3 = hasSavedCommittee ? comm_name3 : "";
        const pos3 = hasSavedCommittee ? comm_pos3 : "";

        html += createMemberRow(1, "ผู้รับผิดชอบ", name1, pos1);
        html += createMemberRow(2, "กรรมการ", name2, pos2);
        html += createMemberRow(3, "กรรมการ", name3, pos3);
    }
    
    container.innerHTML = html;
}

export function checkSellerValidation() {
    const s2 = document.getElementById('seller2')?.value.trim() || '';
    const s3 = document.getElementById('seller3')?.value.trim() || '';
    const alertBox = document.getElementById('seller23Alert');

    if (alertBox) {
        // ถ้าช่องใดช่องหนึ่งยังไม่ได้ระบุ ให้แสดงกล่องเตือน แต่ถ้าใส่ครบทั้ง 2 ช่องแล้ว ให้ซ่อน
        if (!s2 || !s3) {
            alertBox.style.display = 'block';
        } else {
            alertBox.style.display = 'none';
        }
    }
}
// ============================================================================
// 🌐 ATTACH TO WINDOW (สำหรับรองรับ inline onclick ใน HTML เดิม)
// ============================================================================
window.getBudgetInfo = getBudgetInfo;
window.saveKbsPayData = saveKbsPayData;
window.getHolidays = getHolidays;
window.getSupplierNameList = getSupplierNameList;
window.getInvoiceTypeList = getInvoiceTypeList;
window.getCommitteeDb = getCommitteeDb;
window.getSupplierInfo = getSupplierInfo;
window.parseThaiDateToIso = parseThaiDateToIso;
window.toThaiDate = toThaiDate;
window.formatMoney = formatMoney;
window.convertToThaiBahtText = convertToThaiBahtText;
window.convertToThaiShortDate = convertToThaiShortDate;
window.searchBudgetInfo = searchBudgetInfo;
window.autoFillBuyerPos = autoFillBuyerPos;
window.holidays = [];
window.allHolidays = [];
window.allSellersData = [];
window.committeeDatabase = [];
window.clearFormExceptLogNo = clearFormExceptLogNo;
window.submitForm = submitForm;
window.autoFillBuyerPos = autoFillBuyerPos;
window.formatDate = formatDate;
window.isWorkingDay = isWorkingDay;
window.syncDateBE = syncDateBE;
window.refreshAllDateDisplays = refreshAllDateDisplays;
window.updateDateCalculation = updateDateCalculation;
window.calculateTotals = calculateTotals;
window.updateRefDateDisplayOnly = updateRefDateDisplayOnly;
window.updateCommittee = updateCommittee;
window.handleNewTransaction = handleNewTransaction;