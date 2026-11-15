// public/js/index.js
import "./auth-guard.js";
import { insertAuditLog } from "./firestore.js";

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const IS_DEV_MODE = false; // 🎯 ตั้งเป็น false เสมอ (เพราะ auth-guard.js จัดการ DEV MODE ให้แล้ว)

const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const MAIN_PORTAL_URL = isLocal ? "../index.html" : "https://kbs-gm.web.app/";

let currentUser = null;

// ==========================================
// 🛡️ AUTH GUARD & INITIALIZATION
// ==========================================
function initDashboardApp() {
    const userSessionStr = sessionStorage.getItem("kbs_user");

    if (!userSessionStr) {
        window.location.href = `${MAIN_PORTAL_URL}?redirect=${encodeURIComponent(window.location.href)}`;
        return;
    }

    try {
        currentUser = JSON.parse(userSessionStr);
        initUserProfile(currentUser);
        applyRolePermissions(currentUser);
    } catch (e) {
        console.error("❌ อ่านข้อมูลผู้ใช้งานล้มเหลว:", e);
        sessionStorage.removeItem("kbs_user");
        window.location.href = MAIN_PORTAL_URL;
        return;
    }

    bindLogoutBtn();
}

// 🎯 แก้ไข: รองรับกรณีหน้าเว็บโหลดเสร็จไปแล้วระหว่างรอ auth-guard.js
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboardApp);
} else {
    initDashboardApp();
}

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
 * 🔒 ตรวจสอบสิทธิ์และซ่อน/แสดงปุ่มเมนูในหน้าหลัก
 */
function applyRolePermissions(user) {
    const currentRole = (user.role || "staff").toLowerCase();
    // อ่านรายการเมนูจาก pay_permission เป็นหลัก
    const rawPerms = Array.isArray(user.pay_permission)
        ? user.pay_permission
        : (Array.isArray(user.permissions) ? user.permissions : null);

    const menuItems = document.querySelectorAll(".menu-item");

    menuItems.forEach(item => {
        const menuId = item.getAttribute("data-menu-id") || "";

        // 1. Admin เห็นทุกเมนู
        if (currentRole === "admin") {
            item.classList.remove("d-none");
            return;
        }

        // 2. หากเคยตั้งค่า pay_permission แล้ว ให้แสดงเฉพาะเมนูที่มีชื่ออยู่ในรายการ
        if (rawPerms !== null && menuId) {
            if (rawPerms.includes(menuId)) {
                item.classList.remove("d-none");
            } else {
                item.classList.add("d-none");
            }
            return;
        }

        // 3. Fallback: เฉพาะผู้ใช้ใหม่ที่ยังไม่เคยตั้งค่า pay_permission เลย
        const allowedRoles = (item.getAttribute("data-role") || "").toLowerCase().split(",").map(r => r.trim());
        if (allowedRoles.includes("all") || allowedRoles.includes(currentRole)) {
            item.classList.remove("d-none");
        } else {
            item.classList.add("d-none");
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
        localStorage.removeItem("kbs_user_session");
        window.location.href = MAIN_PORTAL_URL;
    }
}

// ==========================================
// 3. ฟังก์ชันสลับหน้า (Dashboard <-> Form)
// ==========================================
window.showForm = function(sectionId) {
    const mainDashboard = document.getElementById('mainDashboard');
    const allSectionsSelector = '.form-container, #kbsparcelmanage, #kbslogno, #kbsbudget, #kbsPay, #kbsbudgetuse, #kbsUserManage, #asset-manage';

    if (sectionId === 'dashboard' || sectionId === 'mainDashboard') {
        if (mainDashboard) {
            mainDashboard.classList.remove('d-none');
            mainDashboard.style.display = 'block';
        }
        document.querySelectorAll(allSectionsSelector).forEach(sec => {
            if (sec.id !== 'mainDashboard') {
                sec.classList.add('d-none');
                sec.style.display = 'none';
            }
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    // 🛡️ ป้องกันการเข้าถึงเมนูที่ไม่มีสิทธิ์ (Security Guard)
    if (currentUser) {
        const currentRole = (currentUser.role || 'staff').toLowerCase();
        if (currentRole !== 'admin') {
            // ตรวจสอบว่ามีการกำหนด pay_permission (หรือ permissions เดิม) ไว้หรือไม่
            const rawPerms = Array.isArray(currentUser.pay_permission)
                ? currentUser.pay_permission
                : (Array.isArray(currentUser.permissions) ? currentUser.permissions : null);

            if (rawPerms !== null) {
                // ยึดตามรายการเมนูที่ติ๊กเลือกไว้ใน pay_permission เป็นหลัก
                if (!rawPerms.includes(sectionId)) {
                    alert('⛔ คุณไม่มีสิทธิ์เข้าถึงเมนูนี้');
                    return;
                }
            } else {
                // Fallback: กรณีผู้ใช้ใหม่ที่ยังไม่เคยตั้งค่าใน role.html เลย ให้เช็กจาก data-role
                const menuCard = document.querySelector(`.menu-item [onclick*="showForm('${sectionId}')"], .menu-item [onclick*='showForm("${sectionId}")']`);
                const menuItem = menuCard ? menuCard.closest('.menu-item') : null;
                if (menuItem) {
                    const allowedRoles = (menuItem.getAttribute('data-role') || '').toLowerCase().split(',').map(r => r.trim());
                    if (!allowedRoles.includes('all') && !allowedRoles.includes(currentRole)) {
                        alert('⛔ คุณไม่มีสิทธิ์เข้าถึงเมนูนี้');
                        return;
                    }
                }
            }
        }
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

    document.querySelectorAll(allSectionsSelector).forEach(sec => {
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