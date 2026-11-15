// public/js/auth-guard.js
import { getCommitteeByLineId } from "./firestore.js";

// ============================================================================
// ⚙️ CONFIGURATION
// ============================================================================
const IS_DEV_MODE = true; // 🎯 ตั้งเป็น true ตอนพัฒนา / เปลี่ยนเป็น false ก่อน Deploy ขึ้นเว็บจริง
const DEV_LINE_USER_ID = "Uee9e25daa4093ff804637d5c55c6be03"; // 🎯 LINE User ID สำหรับทดสอบใน DEV MODE

const MAIN_PORTAL_URL = "https://kbs-gm.web.app/";
const SESSION_KEY = "kbs_user";

function redirectToMainPortal() {
  const currentUrl = encodeURIComponent(window.location.href);
  window.location.href = `${MAIN_PORTAL_URL}?redirect=${currentUrl}`;
}

// ============================================================================
// 🔓 1. DEV MODE: ดึงข้อมูลจริงจาก Firestore ด้วย DEV_LINE_USER_ID
// ============================================================================
if (IS_DEV_MODE) {
  console.warn(`⚠️ [Auth Guard] DEV MODE: กำลังตรวจสอบสิทธิ์ด้วย LINE ID: ${DEV_LINE_USER_ID}`);

  const existingRaw = sessionStorage.getItem(SESSION_KEY);
  const existingUser = existingRaw ? JSON.parse(existingRaw) : null;

  // ดึงข้อมูลใหม่จาก Firestore หากยังไม่มี Session หรือเปลี่ยน ID ทดสอบ
  if (!existingUser || existingUser.line_user_id !== DEV_LINE_USER_ID) {
    const committee = await getCommitteeByLineId(DEV_LINE_USER_ID);

    if (committee) {
      const devUserSession = {
        docId: committee.docId,
        id: committee.line_user_id,
        line_user_id: committee.line_user_id,
        name: committee.name || "ผู้ใช้งานทดสอบ",
        pos: committee.pos || "",
        position: committee.pos || "บุคลากร",
        picture: committee.picture || committee.pictureUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png",
        role: committee.role || "staff",
        status: committee.status || "done",
        expiresAt: Date.now() + 8 * 60 * 60 * 1000
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(devUserSession));
      console.log("✅ [DEV MODE] โหลดข้อมูลจาก Firestore สำเร็จ:", devUserSession);
    } else {
      console.error(`❌ [DEV MODE] ไม่พบข้อมูล line_user_id: ${DEV_LINE_USER_ID} ใน collection 'committees'`);
      alert(`DEV MODE: ไม่พบข้อมูลของ ${DEV_LINE_USER_ID} ใน Firestore`);
    }
  }
} else {
  // ============================================================================
  // 🔒 2. ใช้งานจริง: รับ ?token=... ที่ส่งข้ามมาจาก kbs-main
  // ============================================================================
  const urlParams = new URLSearchParams(window.location.search);
  const incomingToken = urlParams.get("token");

  if (incomingToken) {
    try {
      const jsonStr = decodeURIComponent(escape(atob(incomingToken)));
      const portalSession = JSON.parse(jsonStr);

      if (portalSession && portalSession.user) {
        const u = portalSession.user;

        const mappedUser = {
          docId: u.docId || "",
          id: u.line_user_id || u.userId || "",
          line_user_id: u.line_user_id || u.userId || "",
          name: u.name || "ผู้ใช้งาน",
          pos: u.pos || "",
          position: u.pos || "บุคลากร",
          picture: u.picture || u.pictureUrl || "",
          role: u.role || "staff",
          status: "done",
          expiresAt: portalSession.expiresAt || (Date.now() + 8 * 60 * 60 * 1000)
        };

        sessionStorage.setItem(SESSION_KEY, JSON.stringify(mappedUser));

        // ลบ ?token=... ออกจากแถบ URL
        urlParams.delete("token");
        const cleanQuery = urlParams.toString();
        const cleanUrl = window.location.pathname + (cleanQuery ? "?" + cleanQuery : "");
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch (err) {
      console.error("❌ ถอดรหัส Token จาก kbs-main ล้มเหลว:", err);
      redirectToMainPortal();
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