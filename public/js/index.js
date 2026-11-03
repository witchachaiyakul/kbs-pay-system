// public/js/index.js
import { insertAuditLog } from "./firestore.js";

// ==========================================
// ⚙️ CONFIGURATION & MOCK DATA (DEV MODE)
// ==========================================
const IS_DEV_MODE = true; // 🎯 เปลี่ยนเป็น false เมื่อนำไปใช้งานจริง

// ข้อมูลจำลองสำหรับทดสอบระบบใน DEV MODE
const DEV_MOCK_USER = {
    id: "DEV_USER_001",
    name: "นายนักพัฒนา ทดสอบระบบ",
    position: "เจ้าหน้าที่พัสดุ / นักจัดการงานทั่วไป",
    picture: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
    role: "admin", // ตัวเลือก: 'admin', 'officer', 'staff'
    status: "done"
};

let currentUser = null;

// ==========================================
// 🛡️ AUTH GUARD & INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    
    // --------------------------------------------------
    // 🔓 กรณี 1: เปิดใช้งาน DEV MODE (ข้ามการตรวจสอบ Login/LINE)
    // --------------------------------------------------
    if (IS_DEV_MODE) {
        console.warn("⚠️ ระบบกำลังทำงานใน [DEV MODE]");
        
        // แสดง Badge และ Dropdown สลับ Role
        document.getElementById("devModeBadge")?.classList.remove("d-none");
        document.getElementById("devRoleSelector")?.classList.remove("d-none");

        // ดึงจาก Session หรือใช้ Mock Data เริ่มต้น
        const savedDevUser = sessionStorage.getItem("kbs_user");
        currentUser = savedDevUser ? JSON.parse(savedDevUser) : DEV_MOCK_USER;
        
        // บันทึก Session จำลองไว้
        sessionStorage.setItem("kbs_user", JSON.stringify(currentUser));

        // แสดงผล UI และตั้งค่าสิทธิ์
        initUserProfile(currentUser);
        applyRolePermissions(currentUser.role);

        // ผูก Event สลับ Role สำหรับทดสอบสดบนหน้าจอ
        const selectDevRole = document.getElementById("selectDevRole");
        if (selectDevRole) {
            selectDevRole.value = currentUser.role || "admin";
            selectDevRole.addEventListener("change", (e) => {
                currentUser.role = e.target.value;
                sessionStorage.setItem("kbs_user", JSON.stringify(currentUser));
                initUserProfile(currentUser);
                applyRolePermissions(currentUser.role);
            });
        }

        bindLogoutBtn();
        return;
    }

    // --------------------------------------------------
    // 🔒 กรณี 2: ใช้งานจริง (ต้องมี Session จาก Login)
    // --------------------------------------------------
    const userSessionStr = sessionStorage.getItem("kbs_user");

    if (!userSessionStr) {
        // หากไม่มี Session ให้กลับไปหน้า login.html
        window.location.href = "login.html";
        return;
    }

    try {
        currentUser = JSON.parse(userSessionStr);
        initUserProfile(currentUser);
        applyRolePermissions(currentUser.role);
    } catch (e) {
        console.error("❌ อ่านข้อมูลผู้ใช้งานล้มเหลว:", e);
        sessionStorage.removeItem("kbs_user");
        window.location.href = "login.html";
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
        window.location.href = "login.html";
    }
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