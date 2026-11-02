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
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 🌐 URL ของ Google Apps Script Web App Microservice (สำหรับออกเอกสาร Doc/PDF)
const GAS_DOC_MICROSERVICE_URL = "https://script.google.com/macros/s/YOUR_GAS_SCRIPT_ID/exec";
const INTERNAL_SECRET_KEY = "YOUR_INTERNAL_SECRET_KEY";

// ============================================================================
// 🔍 1. ค้นหาข้อมูลจาก FIRESTORE (log_pay ก่อน -> แล้วค่อย log_budget)
// ============================================================================
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

/**
 * ดึงรายการประเภทเอกสาร (Invoice Type)
 */
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

/**
 * ดึงรายชื่อคณะกรรมการ/บุคลากรจาก collection 'committees'
 */
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

/**
 * ค้นหาข้อมูลร้านค้าตามชื่อร้านจาก collection 'suppliers'
 */
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

// ============================================================================
// 💾 3. SAVE PAY DATA & TRIGGER GAS DOC GENERATION
// ============================================================================
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
    const docDataPayload = prepareDocDataForMicroservice(data, items);

    const gasResponse = await fetch(GAS_DOC_MICROSERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "generateDocFromTemplate",
        secretKey: INTERNAL_SECRET_KEY,
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

// ============================================================================
// 🛠️ 4. PREPARE DATA FOR GAS MICROSERVICE (แพ็กข้อมูลสำหรับส่งออก Template)
// ============================================================================
export function prepareDocDataForMicroservice(data, items) {
  let fullAddress = (data.ad_no || "").trim(); 
  if (data.ad_m) fullAddress += ' ม.' + data.ad_m;
  if (data.ad_rd && data.ad_rd !== "-") fullAddress += ' ' + data.ad_rd; 
  if (data.ad_tb) fullAddress += ' ' + data.ad_tb;
  if (data.ad_mu) fullAddress += ' ' + data.ad_mu;
  if (data.ad_pr) fullAddress += ' ' + data.ad_pr;
  if (data.postid) fullAddress += ' ' + data.postid;

  const cleanPosition = (pos) => {
    if (!pos) return '';
    return pos.includes('รองผู้อำนวยการ') ? 'รองผู้อำนวยการ' : pos;
  };

  let rawObjective = (data.objective || "").trim();
  let cleanObjective = rawObjective.replace(/^(ซื้อ|จ้าง)\s*/, "");

  let prType = data.pr_type || "ซื้อ";
  let calculatedType = data.type || (prType === "ซื้อ" ? "พัสดุ" : "งานจ้าง");
  let calculatedSellerType = prType === "ซื้อ" ? "ขาย" : "รับจ้าง";

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

  let hasCommittee = (data.comm_name2 && data.comm_name2.trim() !== "") || (data.comm_name3 && data.comm_name3.trim() !== "");
  let no1 = "", pos1 = "", pos_name1 = "", cr_sign1 = "";
  let no2 = "", pos2 = "", pos_name2 = "", cr_sign2 = "";
  let no3 = "", pos3 = "", pos_name3 = "", cr_sign3 = "";

  if (data.comm_name1 && data.comm_name1.trim() !== "") {
    no1 = hasCommittee ? "1." : ""; 
    pos1 = "ตำแหน่ง";
    pos_name1 = hasCommittee ? "ประธานคณะกรรมการ" : "ผู้ตรวจรับ";
    cr_sign1 = "ลงชื่อ.....................................ประธานกรรมการ/ผู้ตรวจรับ";
  }
  if (data.comm_name2 && data.comm_name2.trim() !== "") {
    no2 = "2."; pos2 = "ตำแหน่ง"; pos_name2 = "กรรมการ";
    cr_sign2 = "ลงชื่อ.....................................กรรมการ/ผู้ตรวจรับ";
  }
  if (data.comm_name3 && data.comm_name3.trim() !== "") {
    no3 = "3."; pos3 = "ตำแหน่ง"; pos_name3 = "กรรมการ/เลขานุการ";
    cr_sign3 = "ลงชื่อ.....................................กรรมการ/ผู้ตรวจรับ";
  }

  const validItems = items || [];

  const docData = {
    itemCount: validItems.length,
    date: toThaiDate(new Date(), false), 
    LOG_NO: data.log_no || "", 
    PR_TYPE: prType,
    type: calculatedType, 
    
    buyer: data.buyer || "",
    pos_buyer: data.pos_buyer || "",

    seller: data.seller || "",
    seller2: data.seller2 || "",
    seller3: data.seller3 || "", 
    taxid: data.taxid || "",
    seller_address: fullAddress.trim(), 
    ad_no: data.ad_no || "", ad_m: data.ad_m || "", ad_rd: data.ad_rd || "", ad_tb: data.ad_tb || "", 
    ad_mu: data.ad_mu || "", ad_pr: data.ad_pr || "", postid: data.postid || "", ad_ph: data.ad_ph || "",
    
    division: divStr, 
    division_prefix: divPrefix,
    division_title: divisionTitle,
    full_division: divisionTitle,
    committees: committeePerson,
    committee: committeePerson,

    officer: data.officer || "", 
    DB_director: "นางสาวเปรมฤดี จูหลง",
    head_officer: "นางสาวเปรมฤดี จูหลง",
    director: "นายเกียรติมงคล พูดเพราะ",
    financial_officer: "นางพรทิพย์ คงมาก",

    activities: data.activities || "", 
    project: data.project || "", 
    objective: cleanObjective, 
    to: data.to || "", 
    total: data.total || 0, 
    bathtext: convertToThaiBahtText(Number(String(data.total).replace(/,/g, '')) || 0), 
    department: data.department || "", 
    d_dateline: data.d_dateline || "0",

    memo_date: toThaiDate(data.memo_date),
    ctor_date: toThaiDate(data.ctor_date),
    tor_rp_date: toThaiDate(data.tor_rp_date),

    PR_DATE: toThaiDate(data.qu_date), 
    announce_date: data.announce_date || "", 
    PO_date: data.po_date || "",
    PO_NO: data.po_no || "", 
    deadline: data.deadline || "", 
    rc_date: data.rc_date || "",
    invoice_no: data.invoice_no || "", 
    invoice_book: data.invoice_book || "",
    invoice_type: data.invoice_type || "", 
    invoice_date: data.invoice_date || "",
    qu_date: data.qu_date || "", 
    
    seller_type: calculatedSellerType, 

    ex_vat: data.ex_vat || 0, 
    vat: (!data.vat || parseFloat(String(data.vat).replace(/,/g, '')) === 0) ? "-" : data.vat,
    quantity: validItems.length || data.quantity || "0",
    quarantee: data.quarantee || "", 
    CR_date: toThaiDate(data.invoice_date),
    sell_name: data.sell_name || "",
    
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

  for (let i = 1; i <= 29; i++) {
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

// ============================================================================
// 🧮 5. UTILITY & CONVERT FUNCTIONS (ใช้งานฝั่ง Client-side)
// ============================================================================

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