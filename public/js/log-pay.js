// public/js/log-pay.js
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
// 🎯 3. บันทึกข้อมูล LOG_PO และอัปเดต COUNTER
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
// 🎯 4. อัปเดต PO COUNTER
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
// 🎯 5. อัปเดตข้อมูล LOG_PO เอกสารเดิม
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
// 🌐 ATTACH TO WINDOW (รองรับ Event Handlers ใน HTML)
// ============================================================================
window.getLogPoDataFromFirestore = getLogPoDataFromFirestore;
window.getHolidaysFromFirestore = getHolidaysFromFirestore;
window.saveLogPoToFirestore = saveLogPoToFirestore;
window.updatePoCounter = updatePoCounter;
window.updateLogPoInFirestore = updateLogPoInFirestore;