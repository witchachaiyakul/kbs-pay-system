// public/js/login.js
import { 
    getCommitteeByLineId, 
    getUnregisteredCommittees, 
    registerCommitteeLineId, 
    insertAuditLog 
} from "./firestore.js";

// ============================================================================
// ⚙️ CONFIGURATION & STATE
// ============================================================================
const IS_DEV_MODE = true; // 🎯 ตั้งเป็น false เมื่อใช้งานจริง
const LINE_CLIENT_ID = "YOUR_LINE_CHANNEL_ID";
const REDIRECT_URI = window.location.origin + window.location.pathname;

let tempLineUser = null;

// ============================================================================
// 🚀 INITIALIZATION
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
    const btnLineLogin = document.getElementById("btnLineLogin");
    const btnDevLogin = document.getElementById("btnDevLogin");
    const formRegister = document.getElementById("formRegister");

    // 1. ตรวจสอบ DEV MODE
    if (IS_DEV_MODE && btnDevLogin) {
        btnDevLogin.classList.remove("d-none");
        btnDevLogin.addEventListener("click", () => handleDevLogin());
    }

    // 2. ปุ่มเข้าสู่ระบบด้วย LINE (Landing Page Case)
    if (btnLineLogin) {
        btnLineLogin.addEventListener("click", () => redirectToLineOAuth());
    }

    // 3. ฟอร์มยืนยันลงทะเบียนผูกบัญชี
    if (formRegister) {
        formRegister.addEventListener("submit", (e) => handleConfirmRegister(e));
    }

    // 4. ตรวจสอบ Callback Query Parameter (?code=...)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
        toggleLoading(true);
        await handleLineCallback(code);
    }
});

// ============================================================================
// 🔑 AUTHENTICATION FLOW
// ============================================================================

/**
 * Redirect ผู้ใช้ไปที่ LINE Authorization Page
 */
function redirectToLineOAuth() {
    const state = Math.random().toString(36).substring(7);
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize` +
        `?response_type=code` +
        `&client_id=${LINE_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&state=${state}` +
        `&scope=profile%20openid`;

    window.location.href = lineAuthUrl;
}

/**
 * ประมวลผล LINE Code Callback
 */
async function handleLineCallback(code) {
    try {
        // ตัวอย่างข้อมูล Profile หลังแลกเปลี่ยน Code (ในระบบจริงรับจาก Backend/Auth Service)
        const lineUser = {
            id: "U1234567890abcdef", 
            name: "ผู้ใช้งาน LINE",
            picture: "https://cdn-icons-png.flaticon.com/512/149/149071.png"
        };
        tempLineUser = lineUser;

        // 🔍 กรณีที่ 1: ตรวจสอบว่าเคยลงทะเบียน line_user_id แล้วหรือไม่ (Auto Login)
        const committee = await getCommitteeByLineId(lineUser.id);

        if (committee) {
            await completeLogin({
                id: lineUser.id,
                name: committee.name,
                picture: lineUser.picture,
                role: committee.role || "staff",
                status: committee.status
            }, "LOGIN_AUTO");
            return;
        }

        // 🔍 กรณีที่ 2: เข้าใช้งานครั้งแรก -> ดึงรายชื่อบุคลากรที่ยังไม่ได้ลงทะเบียนเพื่อเลือกผูกบัญชี
        const unregisteredList = await getUnregisteredCommittees();

        if (unregisteredList.length === 0) {
            showNoAuthCard();
            return;
        }

        showRegisterCard(lineUser, unregisteredList);

    } catch (err) {
        console.error("❌ เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์:", err);
        alert("เกิดข้อผิดพลาดในการเข้าสู่ระบบ: " + err.message);
        window.location.href = "login.html";
    }
}

/**
 * ยืนยันการลงทะเบียนผูกบัญชี LINE
 */
async function handleConfirmRegister(e) {
    e.preventDefault();
    const selectElem = document.getElementById("selectCommittee");
    const btnSubmit = document.getElementById("btnConfirmRegister");
    const docId = selectElem ? selectElem.value : null;

    if (!docId || !tempLineUser) return;

    try {
        btnSubmit.disabled = true;
        btnSubmit.textContent = "กำลังลงทะเบียน...";

        const updatedCommittee = await registerCommitteeLineId(docId, tempLineUser.id);

        await completeLogin({
            id: tempLineUser.id,
            name: updatedCommittee.name,
            picture: tempLineUser.picture,
            role: updatedCommittee.role || "staff",
            status: updatedCommittee.status
        }, "REGISTER_AND_LOGIN");

    } catch (error) {
        alert("เกิดข้อผิดพลาดในการลงทะเบียน: " + error.message);
        btnSubmit.disabled = false;
        btnSubmit.textContent = "ยืนยันการลงทะเบียน";
    }
}

/**
 * เข้าสู่ระบบจำลอง (DEV MODE)
 */
async function handleDevLogin() {
    const devUser = {
        id: "DEV_USER_001",
        name: "Developer_DevMode",
        picture: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
        role: "admin",
        status: "done"
    };

    await completeLogin(devUser, "LOGIN_DEV");
}

/**
 * สรุป Session, บันทึก Audit Log และเปลี่ยนหน้าไปยัง index.html
 */
async function completeLogin(userSession, loginType) {
    await insertAuditLog(loginType, `เข้าสู่ระบบสำเร็จในชื่อ ${userSession.name} (Role: ${userSession.role})`, userSession);
    sessionStorage.setItem("kbs_user", JSON.stringify(userSession));
    window.location.href = "index.html";
}

// ============================================================================
// 🎨 UI HELPERS
// ============================================================================
function toggleLoading(show) {
    const actionArea = document.getElementById("actionArea");
    const loadingState = document.getElementById("loadingState");
    if (actionArea && loadingState) {
        actionArea.classList.toggle("d-none", show);
        loadingState.classList.toggle("d-none", !show);
    }
}

function showRegisterCard(lineUser, unregisteredList) {
    const loginCard = document.getElementById("loginCard");
    const registerCard = document.getElementById("registerCard");
    if (loginCard) loginCard.classList.add("d-none");
    if (registerCard) registerCard.classList.remove("d-none");

    const avatar = document.getElementById("regUserAvatar");
    const nameElem = document.getElementById("regUserName");
    const select = document.getElementById("selectCommittee");

    if (avatar) avatar.src = lineUser.picture;
    if (nameElem) nameElem.textContent = lineUser.name;

    if (select) {
        select.innerHTML = `<option value="">-- กรุณาเลือกรายชื่อของคุณ --</option>`;
        unregisteredList.forEach(item => {
            const option = document.createElement("option");
            option.value = item.docId;
            option.textContent = `${item.name} (${item.role.toUpperCase()})`;
            select.appendChild(option);
        });
    }
}

function showNoAuthCard() {
    const loginCard = document.getElementById("loginCard");
    const noAuthCard = document.getElementById("noAuthCard");
    if (loginCard) loginCard.classList.add("d-none");
    if (noAuthCard) noAuthCard.classList.remove("d-none");
}