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
    limit, 
    where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📦 PARCEL MANAGEMENT BACKEND LOGIC (Firebase Web SDK v10)
// ============================================================================

/**
 * 🔍 1. ดึงข้อมูลจาก log_pay เพื่อนำไปบริหารพัสดุ
 * @param {string} logNo เลข นผ.2
 */
export async function getLogPayForParcels(logNo) {
  try {
    if (logNo && logNo.trim() !== '') {
      const cleanLogNo = logNo.trim();
      const docRef = doc(db, "log_pay", cleanLogNo);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return { success: true, data: { id: docSnap.id, ...docSnap.data() } };
      }
      return { success: false, message: `ไม่พบข้อมูล log_no: ${cleanLogNo}` };
    } else {
      // กรณีไม่ระบุ ให้ดึงรายการล่าสุด 20 รายการ
      const q = query(collection(db, "log_pay"), limit(20));
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

/**
 * 🏷️ 2. ออกเลขพัสดุอัตโนมัติ (Format: ประเภทเงิน/ลำดับ/ปีงบประมาณ)
 * @param {Array<string>} uids รายการ UID พัสดุ
 * @param {string} fundType ประเภทเงิน
 * @param {number|string} yearBE ปีงบประมาณ พ.ศ.
 */
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

    // อัปเดต Counter ล่าสุดกลับไปยัง Firestore
    await setDoc(counterRef, { seq: currentSeq, updated_at: new Date().toISOString() }, { merge: true });

    return { success: true, message: 'ออกเลขพัสดุสำเร็จ' };
  } catch (err) {
    console.error("❌ Error generateParcelNumbersBackend:", err);
    return { success: false, message: err.message };
  }
}

/**
 * 📤 3. บันทึกการเบิกจ่ายพัสดุ
 * @param {Array<string>} uids รายการ UID พัสดุ
 * @param {string} recipient ผู้รับเบิก
 * @param {string} issueDate วันที่เบิกจ่าย (YYYY-MM-DD)
 */
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
// 🌐 ATTACH TO WINDOW FOR HTML EVENT LISTENERS
// ============================================================================
window.getLogPayForParcels = getLogPayForParcels;
window.generateParcelNumbersBackend = generateParcelNumbersBackend;
window.issueParcelsBackend = issueParcelsBackend;