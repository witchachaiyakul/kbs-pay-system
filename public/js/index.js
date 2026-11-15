// public/js/index.js
import "./auth-guard.js";
import { insertAuditLog } from "./firestore.js";

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const IS_DEV_MODE = false; // 🎯 ตั้งเป็น false เสมอ (เพราะ auth-guard.js จัดการ DEV MODE ให้แล้ว)
const MAIN_PORTAL_URL = "https://kbs-gm.web.app/";

let currentUser = null;

// ==========================================
// 🛡️ AUTH GUARD & INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const userSessionStr = sessionStorage.getItem("kbs_user");

    if (!userSessionStr) {
        window.location.href = `${MAIN_PORTAL_URL}?redirect=${encodeURIComponent(window.location.href)}`;
        return;
    }

    try {
        currentUser = JSON.parse(userSessionStr);
        initUserProfile(currentUser);
        applyRolePermissions(currentUser.role);
    } catch (e) {
        console.error("❌ อ่านข้อมูลผู้ใช้งานล้มเหลว:", e);
        sessionStorage.removeItem("kbs_user");
        window.location.href = MAIN_PORTAL_URL;
        return;
    }

    bindLogoutBtn();
});

/**
 * อัปเดตข้อมูลผู้ใช้งาน (ชื่อ, ตำแหน่ง, Role) บน Navbar
 */
function initUserProfile(user) {
    const nameElem = document.getElementById("headerUserName");
    const posElem = document.getElementById("headerUserPosition");
    const roleElem = document.getElementById("headerUserRole");
    const imgElem = document.getElementById("headerUserImg");

    if (nameElem) nameElem.textContent = user.name || "ผู้ใช้งาน";
    if (posElem) posElem.textContent = `ตำแหน่ง: ${user.position || "บุคลากร"}`;
    if (roleElem) roleElem.textContent = `Role: ${(user.role || "staff").toUpperCase()}`;
    if (imgElem && user.picture) imgElem.src = user.picture;
}

/**
 * ควบคุมการซ่อน/แสดง เมนูตามระดับสิทธิ์ (Role-based UI)
 * - admin: มองเห็นทุกเมนู
 * - officer: เห็นเมนูทั่วไป + แผนโครงการ + ออกเลข
 * - staff: เห็นเฉพาะเมนูจัดซื้อจัดจ้าง และ ตัดแผน
 */
function applyRolePermissions(role) {
    const currentRole = (role || "staff").toLowerCase();
    const menuItems = document.querySelectorAll(".menu-item");

    menuItems.forEach(item => {
        const allowedRoles = item.getAttribute("data-role");
        if (!allowedRoles || allowedRoles === "all") {
            item.classList.remove("d-none");
        } else {
            const rolesArray = allowedRoles.split(",").map(r => r.trim().toLowerCase());
            if (rolesArray.includes(currentRole) || currentRole === "admin") {
                item.classList.remove("d-none");
            } else {
                item.classList.add("d-none"); // ซ่อนเมนูที่ผู้ใช้ไม่มีสิทธิ์
            }
        }
    });
}

function bindLogoutBtn() {
    const btnLogout = document.getElementById("btnLogout");
    if (btnLogout) {
        btnLogout.addEventListener("click", () => handleLogout());
    }
}

/**
 * ออกจากระบบ
 */
async function handleLogout() {
    if (confirm("คุณต้องการออกจากระบบใช่หรือไม่?")) {
        if (currentUser && !IS_DEV_MODE) {
            await insertAuditLog("LOGOUT", `ออกจากระบบสำเร็จ`, currentUser);
        }
        sessionStorage.removeItem("kbs_user");
        localStorage.removeItem("kbs_user_session"); // 👈 เพิ่มบรรทัดนี้
        window.location.href = MAIN_PORTAL_URL;
    }
}

/**
 * 🔒 ตรวจสอบสิทธิ์และซ่อน/แสดงปุ่มเมนูใน main.html
 * @param {Object} userData ข้อมูลผู้ใช้งานที่ล็อกอิน ดึงมาจาก Firestore `users/{uid}`
 */
export function applyUserPermissions(userData) {
  if (!userData) return;

  const userRole = (userData.role || 'staff').toLowerCase();
  const userPermissions = Array.isArray(userData.permissions) ? userData.permissions : [];

  // ค้นหาทุกเมนูที่มีคลาส .menu-item
  const menuItems = document.querySelectorAll('.menu-item');

  menuItems.forEach(item => {
    const rolesAllowed = (item.getAttribute('data-role') || '').toLowerCase().split(',');
    
    // ดึง formId จากคุณลักษณะ onclick (เช่น showForm('kbsPay') -> kbsPay)
    const onclickAttr = item.getAttribute('onclick') || '';
    const match = onclickAttr.match(/showForm\(['"]([^'"]+)['"]\)/);
    const formId = match ? match[1] : '';

    let canAccess = false;

    // 1. ถ้าเป็น Admin ให้เข้าถึงได้ทุกเมนู
    if (userRole === 'admin') {
      canAccess = true;
    } 
    // 2. ถ้ามีการระบุ permissions เฉพาะเมนูไว้ ให้ยึดตามสิทธิ์เฉพาะรายบุคคลก่อน
    else if (userPermissions.length > 0 && formId) {
      canAccess = userPermissions.includes(formId);
    } 
    // 3. ถ้าไม่มีการตั้งค่าสิทธิ์เฉพาะ ให้ยึดตามสิทธิ์ data-role พื้นฐานใน HTML
    else {
      if (rolesAllowed.includes('all') || rolesAllowed.includes(userRole)) {
        canAccess = true;
      }
    }

    // ซ่อน หรือ แสดง ปุ่มเมนู
    if (canAccess) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
}

// ==========================================
// 3. ฟังก์ชันสลับหน้า (Dashboard <-> Form)
// ==========================================
window.showForm = function(sectionId) {
    const mainDashboard = document.getElementById('mainDashboard');

    if (sectionId === 'dashboard' || sectionId === 'mainDashboard') {
        if (mainDashboard) {
            mainDashboard.classList.remove('d-none');
            mainDashboard.style.display = 'block';
        }
        const allSections = document.querySelectorAll('.form-container, #kbsparcelmanage, #kbslogno, #kbsbudget, #kbsPay, #kbsbudgetuse');
        allSections.forEach(sec => {
            if (sec.id !== 'mainDashboard') {
                sec.classList.add('d-none');
                sec.style.display = 'none';
            }
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    const targetSection = document.getElementById(sectionId);
    
    if (!targetSection) {
        alert('❌ ไม่พบส่วนฟอร์มที่มี ID: "' + sectionId + '" กรุณาตรวจสอบการตั้งชื่อ ID ใน HTML');
        return;
    }

    if (mainDashboard) {
        mainDashboard.classList.add('d-none');
        mainDashboard.style.display = 'none';
    }

    const allSections = document.querySelectorAll('.form-container, #kbsparcelmanage, #kbslogno, #kbsbudget, #kbsPay, #kbsbudgetuse');
    allSections.forEach(sec => {
        sec.classList.add('d-none');
        sec.style.display = 'none';
    });

    targetSection.classList.remove('d-none');
    targetSection.style.display = 'block';

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger โหลดข้อมูลย่อย
    if (sectionId === 'kbsPay' && typeof window.loadKbsPayMasterData === 'function') {
        window.loadKbsPayMasterData();
    } else if (sectionId === 'kbsbudget' && typeof window.loadKbsBudgetData === 'function') {
        window.loadKbsBudgetData();
    } else if (sectionId === 'kbslogno' && typeof window.loadLogPoData === 'function') {
        window.loadLogPoData();
    } else if (sectionId === 'kbsbudgetuse' && typeof window.loadBudgetUseData === 'function') {
        window.loadBudgetUseData();
    } else if (sectionId === 'kbsparcelmanage' && typeof window.loadParcelDataFromLogPay === 'function') {
        window.loadParcelDataFromLogPay(true);
    } else if (sectionId === 'kbsUserManage' && typeof window.loadUsersTable === 'function') {
    window.loadUsersTable();
    }
};

window.resetFormToMain = function() {
    if (typeof window.showForm === 'function') {
        window.showForm('dashboard');
    } else {
        const mainDashboard = document.getElementById('mainDashboard');
        if (mainDashboard) {
            mainDashboard.classList.remove('d-none');
            mainDashboard.style.display = 'block';
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};