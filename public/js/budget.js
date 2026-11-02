// public/js/budget.js
import { db } from "./firestore.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 📊 FIRESTORE BUDGET PLANS FETCH ENGINE (Firebase Web SDK v10)
// ============================================================================

/**
 * ฟังก์ชันดึงข้อมูลแผนงาน/โครงการจาก collection "budget_plans"
 * @param {string|null} fundTypeFilter ชื่อประเภทเงิน (fund_type) ที่ต้องการกรอง
 * @return {Promise<Object>} { success: true/false, data: [...], totalCount: number }
 */
export async function getBudgetPlans(fundTypeFilter = null) {
  try {
    const plansRef = collection(db, "budget_plans");
    let q;

    if (fundTypeFilter) {
      // ค้นหาแบบกรองเฉพาะ fund_type
      q = query(plansRef, where("fund_type", "==", fundTypeFilter));
    } else {
      // ดึงข้อมูลทั้งหมด จำกัด 500 รายการ
      q = query(plansRef, limit(500));
    }

    const querySnapshot = await getDocs(q);
    const plans = [];

    querySnapshot.forEach((docSnap) => {
      plans.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    return {
      success: true,
      totalCount: plans.length,
      data: plans
    };

  } catch (error) {
    console.error("❌ getBudgetPlans Error:", error);
    return {
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล budget_plans: " + error.message,
      data: []
    };
  }
}

/**
 * ดึงรายการโครงการแยกตามฝ่าย/กลุ่มบริหาร
 * @param {string} deptName ชื่อฝ่าย
 */
export async function getBudgetPlansByDept(deptName) {
  try {
    if (!deptName) return { success: false, message: "ไม่ได้ระบุชื่อฝ่าย", data: [] };
    
    const plansRef = collection(db, "budget_plans");
    const q = query(plansRef, where("division", "==", deptName));
    const querySnapshot = await getDocs(q);
    const list = [];

    querySnapshot.forEach((docSnap) => {
      list.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    return { success: true, data: list };
  } catch (error) {
    console.error("❌ getBudgetPlansByDept Error:", error);
    return { success: false, message: error.message, data: [] };
  }
}

// ผูกเข้ากับ window เพื่อให้ HTML inline event เช่น onclick สามารถเรียกใช้งานได้
window.getBudgetPlans = getBudgetPlans;
window.getBudgetPlansByDept = getBudgetPlansByDept;