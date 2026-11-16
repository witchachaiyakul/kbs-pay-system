// public/js/auth-guard.js
import { db, getCommitteeByLineId } from "./firestore.js";
import { doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// ⚙️ CONFIGURATION
// ============================================================================
const IS_DEV_MODE = true; // 🎯 ปิดเมื่อทดสอบรวมระบบผ่าน kbs-main
const DEV_LINE_USER_ID = "Uee9e25daa4093ff804637d5c55c6be03";

const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const MAIN_PORTAL_URL = isLocal ? "../index.html" : "https://kbs-gm.web.app/";
const SESSION_KEY = "kbs_user";

function redirectToMainPortal() {
  const currentUrl = encodeURIComponent(window.location.href);
  window.location.href = `${MAIN_PORTAL_URL}?redirect=${currentUrl}`;
}

/**
 * 🔍 ดึงสิทธิ์เฉพาะของระบบ kbs-pay (role และ permissions รายเมนู) จากคอลเลกชัน 'users'
 */
async function fetchPayUserPermissions(docId, lineUserId, fallbackRole = "staff") {
  const extractPerms = (d) => ({
    role: (d.role || fallbackRole).toLowerCase(),
    // อ่าน pay_permission เป็นหลัก (หากยังไม่เคยบันทึกใหม่ ให้ดึง permissions เดิมมาใช้ก่อน)
    pay_permission: Array.isArray(d.pay_permission)
      ? d.pay_permission
      : (Array.isArray(d.permissions) ? d.permissions : undefined)
  });

  try {
    if (docId) {
      const userSnap = await getDoc(doc(db, "users", docId));
      if (userSnap.exists()) return extractPerms(userSnap.data());
    }

    if (lineUserId) {
      const q = query(collection(db, "users"), where("line_user_id", "==", lineUserId));
      const snap = await getDocs(q);
      if (!snap.empty) return extractPerms(snap.docs[0].data());
    }
  } catch (err) {
    console.warn("⚠️ ดึงสิทธิ์จาก users ไม่สำเร็จ ใช้สิทธิ์พื้นฐานแทน:", err);
  }

  return { role: fallbackRole.toLowerCase(), pay_permission: undefined };
}

// ============================================================================
// 🔓 1. DEV MODE
// ============================================================================
if (IS_DEV_MODE) {
  console.warn(`⚠️ [Auth Guard] DEV MODE: กำลังตรวจสอบสิทธิ์ด้วย LINE ID: ${DEV_LINE_USER_ID}`);
  const committee = await getCommitteeByLineId(DEV_LINE_USER_ID);

  if (committee) {
    const payPerm = await fetchPayUserPermissions(committee.docId, committee.line_user_id, committee.role || "staff");
    const devUserSession = {
      docId: committee.docId,
      id: committee.line_user_id,
      line_user_id: committee.line_user_id,
      name: committee.name || "ผู้ใช้งานทดสอบ",
      pos: committee.pos || "",
      position: committee.pos || "บุคลากร",
      picture: committee.picture || committee.pictureUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png",
      role: payPerm.role,
      pay_permission: payPerm.pay_permission,
      status: committee.status || "done",
      expiresAt: Date.now() + 8 * 60 * 60 * 1000
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(devUserSession));
  }
} else {
  // ============================================================================
  // 🔒 2. ใช้งานจริง: รับสิทธิ์จาก kbs-main
  // ============================================================================
  const urlParams = new URLSearchParams(window.location.search);
  const incomingToken = urlParams.get("token");
  let portalSession = null;

  if (incomingToken) {
    try {
      const jsonStr = decodeURIComponent(escape(atob(incomingToken)));
      portalSession = JSON.parse(jsonStr);
      urlParams.delete("token");
      const cleanQuery = urlParams.toString();
      window.history.replaceState({}, document.title, window.location.pathname + (cleanQuery ? "?" + cleanQuery : ""));
    } catch (err) {
      console.error("❌ ถอดรหัส Token ล้มเหลว:", err);
    }
  } else if (localStorage.getItem("kbs_user_session")) {
    try {
      portalSession = JSON.parse(localStorage.getItem("kbs_user_session"));
    } catch (e) {
      localStorage.removeItem("kbs_user_session");
    }
  }

  if (portalSession && portalSession.user) {
    if (portalSession.expiresAt && Date.now() > portalSession.expiresAt) {
      localStorage.removeItem("kbs_user_session");
      sessionStorage.removeItem(SESSION_KEY);
      redirectToMainPortal();
    } else {
      const u = portalSession.user;
      const lineId = u.line_user_id || u.userId || "";
      const payPerm = await fetchPayUserPermissions(u.docId, lineId, u.role || "staff");

      const mappedUser = {
        docId: u.docId || "",
        id: lineId,
        line_user_id: lineId,
        name: u.name || "ผู้ใช้งาน",
        pos: u.pos || "",
        position: u.pos || "บุคลากร",
        picture: u.picture || u.pictureUrl || "",
        role: payPerm.role,
        pay_permission: payPerm.pay_permission,
        status: "done",
        expiresAt: portalSession.expiresAt || (Date.now() + 8 * 60 * 60 * 1000)
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(mappedUser));
    }
  }

  // ============================================================================
  // 🛡️ 3. ตรวจสอบ Session เดิมใน sessionStorage
  // ============================================================================
  const savedUserStr = sessionStorage.getItem(SESSION_KEY);
  if (!savedUserStr) {
    redirectToMainPortal();
  } else {
    try {
      const savedUser = JSON.parse(savedUserStr);
      if (savedUser.expiresAt && Date.now() > savedUser.expiresAt) {
        sessionStorage.removeItem(SESSION_KEY);
        redirectToMainPortal();
      }
    } catch (e) {
      sessionStorage.removeItem(SESSION_KEY);
      redirectToMainPortal();
    }
  }
}

// ============================================================================
// 🎨 4. อัปเดต Navbar (ชื่อ, ตำแหน่ง, Role, รูปโปรไฟล์) และปุ่มออกจากระบบให้ทุกหน้า
// ============================================================================
function renderGlobalNavbar() {
  const userStr = sessionStorage.getItem(SESSION_KEY);
  if (!userStr) return;

  try {
    const user = JSON.parse(userStr);

    // 1. อัปเดตข้อมูลบน Navbar
    const nameElem = document.getElementById("headerUserName");
    const posElem = document.getElementById("headerUserPosition");
    const roleElem = document.getElementById("headerUserRole");
    const imgElem = document.getElementById("headerUserImg");

    if (nameElem) nameElem.textContent = user.name || "ผู้ใช้งาน";
    if (posElem) posElem.textContent = `ตำแหน่ง: ${user.position || user.pos || "บุคลากร"}`;
    if (roleElem) roleElem.textContent = `Role: ${(user.role || "staff").toUpperCase()}`;
    if (imgElem && user.picture) imgElem.src = user.picture;

    // 2. ผูกปุ่มออกจากระบบ (รองรับทุกหน้าโดยไม่ต้องเขียนซ้ำ)
    const btnLogout = document.getElementById("btnLogout");
    if (btnLogout && !btnLogout.dataset.bound) {
      btnLogout.dataset.bound = "true";
      btnLogout.addEventListener("click", () => {
        if (confirm("คุณต้องการออกจากระบบใช่หรือไม่?")) {
          sessionStorage.removeItem(SESSION_KEY);
          localStorage.removeItem("kbs_user_session");
          window.location.href = MAIN_PORTAL_URL;
        }
      });
    }

    // 3. 🛡️ ป้องกันการพิมพ์ URL เข้าหน้าย่อยที่ไม่มีสิทธิ์โดยตรง
    const currentRole = (user.role || "staff").toLowerCase();
    if (currentRole !== "admin" && Array.isArray(user.pay_permission)) {
      const pageToMenuMap = {
        "pay.html": "kbsPay",
        "budget.html": "kbsbudget",
        "budgetuse.html": "kbsbudgetuse",
        "log-pay.html": "kbslogno",
        "parcel.html": "kbsparcelmanage",
        "role.html": "kbsUserManage",
        "asset-manage.html": "asset-manage"
      };
      const currentFile = window.location.pathname.split("/").pop();
      const requiredMenuId = pageToMenuMap[currentFile];

      if (requiredMenuId && !user.pay_permission.includes(requiredMenuId)) {
        alert("⛔ คุณไม่มีสิทธิ์เข้าถึงหน้านี้");
        window.location.href = "index.html";
      }
    }
  } catch (e) {
    console.error("❌ renderGlobalNavbar error:", e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderGlobalNavbar);
} else {
  renderGlobalNavbar();
}