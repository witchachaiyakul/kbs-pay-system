// public/js/firestore.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    updateDoc,
    collection, 
    query, 
    where, 
    getDocs,
    setDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase Web Configuration
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ============================================================================
// 🛡️ USER PERMISSIONS (COMMITTEES) & AUDIT LOGS
// ============================================================================

/**
 * ตรวจสอบสิทธิ์ผู้ใช้งานจาก LINE User ID ใน collection 'committees'
 */
export async function getCommitteeByLineId(lineUserId) {
    try {
        const q = query(
            collection(db, "committees"), 
            where("line_user_id", "==", lineUserId),
            where("status", "==", "done")
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            return {
                docId: docSnap.id,
                ...docSnap.data()
            };
        }
        return null;
    } catch (error) {
        console.error("❌ ค้นหา committee จาก line_user_id ล้มเหลว:", error);
        return null;
    }
}

/**
 * ดึงรายชื่อบุคลากร/กรรมการที่ยังไม่ได้ลงทะเบียน (status != 'done' และยังไม่มี line_user_id)
 */
export async function getUnregisteredCommittees() {
    try {
        const querySnapshot = await getDocs(collection(db, "committees"));
        const list = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.status !== "done" && !data.line_user_id) {
                list.push({
                    docId: docSnap.id,
                    name: data.name,
                    role: data.role || "staff"
                });
            }
        });
        return list;
    } catch (error) {
        console.error("❌ ดึงรายชื่อกรรมการล้มเหลว:", error);
        return [];
    }
}

/**
 * ผูกบัญชี LINE ID กับรายชื่อบุคลากร และอัปเดต status เป็น 'done'
 */
export async function registerCommitteeLineId(docId, lineUserId) {
    try {
        const committeeRef = doc(db, "committees", docId);
        await updateDoc(committeeRef, {
            line_user_id: lineUserId,
            status: "done",
            updated_at: serverTimestamp()
        });
        
        const updatedSnap = await getDoc(committeeRef);
        return {
            docId: updatedSnap.id,
            ...updatedSnap.data()
        };
    } catch (error) {
        console.error("❌ ผูกบัญชี LINE ล้มเหลว:", error);
        throw error;
    }
}

/**
 * บันทึก Audit Log ลง Firestore collection 'audit_logs'
 */
export async function insertAuditLog(actionType, detailsTxt, lineUserObj) {
    try {
        const logDocId = `LOG_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const logRef = doc(db, "audit_logs", logDocId);

        await setDoc(logRef, {
            timestamp: serverTimestamp(),
            action: actionType,
            details: detailsTxt,
            user_id: lineUserObj ? lineUserObj.id : "System",
            user_name: lineUserObj ? lineUserObj.name : "Unknown",
            user_picture: lineUserObj ? lineUserObj.picture : ""
        });
        console.log(`✅ Audit Log Saved: [${actionType}] ${detailsTxt}`);
    } catch (error) {
        console.error("❌ บันทึก Audit Log ล้มเหลว:", error);
    }
}