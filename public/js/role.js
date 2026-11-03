// public/js/role.js
import { db } from "./firestore.js";
import { 
    collection, 
    getDocs, 
    doc, 
    updateDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 👥 USER ROLE MANAGEMENT BACKEND LOGIC
// ============================================================================

/**
 * 🔄 โหลดรายชื่อผู้ใช้งานทั้งหมดจาก Firestore คอลเลกชัน "users"
 */
export async function loadUsersTable() {
    const tbody = document.getElementById("userManagementTableBody");
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="6" class="py-4 text-muted">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                กำลังดึงข้อมูลผู้ใช้งานจากฐานข้อมูล...
            </td>
        </tr>
    `;

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        let html = "";
        let index = 1;

        if (querySnapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-muted">ไม่พบข้อมูลผู้ใช้งานในระบบ</td></tr>`;
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const user = docSnap.data();
            const uid = docSnap.id;
            const currentRole = (user.role || "staff").toLowerCase();

            html += `
                <tr>
                    <td>${index++}</td>
                    <td class="text-start fw-bold text-navy">${user.name || "ไม่ระบุชื่อ"}</td>
                    <td class="text-start small text-muted">${user.position || "-"}</td>
                    <td>
                        <select class="form-select form-select-sm border-primary fw-bold" id="role_select_${uid}">
                            <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>👑 Admin (ทุกเมนู)</option>
                            <option value="officer" ${currentRole === 'officer' ? 'selected' : ''}>💼 Officer (เจ้าหน้าที่)</option>
                            <option value="staff" ${currentRole === 'staff' ? 'selected' : ''}>👤 Staff (บุคลากรทั่วไป)</option>
                        </select>
                    </td>
                    <td><span class="badge bg-success">ปกติ</span></td>
                    <td>
                        <button type="button" class="btn btn-navy btn-sm fw-bold px-3" onclick="updateUserRole('${uid}')">
                            <i class="bi bi-save me-1"></i> บันทึก
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    } catch (error) {
        console.error("❌ Error loadUsersTable:", error);
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-4 text-danger">
                    <i class="bi bi-exclamation-triangle-fill me-1"></i> เกิดข้อผิดพลาดในการโหลดข้อมูล: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * 💾 บันทึกและอัปเดตสิทธิ์ (Role) ของผู้ใช้งานรายบุคคลลง Firestore
 * @param {string} uid รหัสผู้ใช้งาน (Document ID)
 */
export async function updateUserRole(uid) {
    const selectElem = document.getElementById(`role_select_${uid}`);
    if (!selectElem) return;

    const newRole = selectElem.value;

    try {
        const userRef = doc(db, "users", uid);
        await updateDoc(userRef, {
            role: newRole,
            updated_at: new Date().toISOString()
        });

        alert("✅ อัปเดตสิทธิ์การใช้งานเรียบร้อยแล้ว");
    } catch (error) {
        console.error("❌ Error updateUserRole:", error);
        alert("❌ เกิดข้อผิดพลาดในการอัปเดตสิทธิ์: " + error.message);
    }
}

// ============================================================================
// 🌐 ATTACH TO WINDOW FOR HTML EVENT LISTENERS & SPA NAVIGATION
// ============================================================================
window.loadUsersTable = loadUsersTable;
window.updateUserRole = updateUserRole;