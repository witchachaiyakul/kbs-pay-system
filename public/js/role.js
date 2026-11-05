// public/js/role.js
import { db } from "./firestore.js";
import { 
    collection, 
    getDocs, 
    doc, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ============================================================================
// 👥 USER ROLE MANAGEMENT BACKEND LOGIC
// ============================================================================

/**
 * 🔄 โหลดรายชื่อผู้ใช้งานโดยดึงจาก users ก่อน แล้วดึงรายชื่อที่เหลือจาก committees
 */
export async function loadUsersTable() {
    const tbody = document.getElementById("userManagementTableBody");
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="6" class="py-4 text-muted">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                กำลังดึงข้อมูลผู้ใช้งานและรายชื่อคณะกรรมการ...
            </td>
        </tr>
    `;

    try {
        // 1. ดึงข้อมูลจากคอลเลกชัน "users" (ผู้ที่เคยกำหนดสิทธิ์แล้ว)
        const usersSnap = await getDocs(collection(db, "users"));
        const existingUsers = [];
        const assignedCommitteeIds = new Set();

        usersSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;
            existingUsers.push({
                id: id,
                name: data.name || "ไม่ระบุชื่อ",
                pos: data.pos || data.position || "-",
                role: (data.role || "staff").toLowerCase(),
                committee_id: data.committee_id || id,
                line_user_id: data.line_user_id || "",
                isAssigned: true
            });

            if (data.committee_id) {
                assignedCommitteeIds.add(data.committee_id);
            }
            assignedCommitteeIds.add(id);
        });

        // 2. ดึงข้อมูลจากคอลเลกชัน "committees"
        const committeesSnap = await getDocs(collection(db, "committees"));
        const pendingCommittees = [];

        committeesSnap.forEach((docSnap) => {
            const cData = docSnap.data();
            const cId = docSnap.id;

            if (!assignedCommitteeIds.has(cId)) {
                pendingCommittees.push({
                    id: cId,
                    name: cData.name || cData.comm_name || "ไม่ระบุชื่อ",
                    pos: cData.pos || cData.position || cData.comm_pos || "-",
                    role: (cData.role || "staff").toLowerCase(),
                    committee_id: cId,
                    line_user_id: cData.line_user_id || "",
                    isAssigned: false
                });
            }
        });

        // 3. รวมรายชื่อทั้งสองกลุ่มเข้าด้วยกัน
        const combinedList = [...existingUsers, ...pendingCommittees];

        if (combinedList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-muted">ไม่พบข้อมูลบุคลากรในระบบ</td></tr>`;
            return;
        }

        // 4. แสดงผลในตาราง
        let html = "";
        let index = 1;

        combinedList.forEach((user) => {
            const uid = user.id;
            const currentRole = user.role;
            const isAssigned = user.isAssigned;

            html += `
                <tr>
                    <td>${index++}</td>
                    <td class="text-start fw-bold text-navy">
                        ${user.name}
                        ${user.line_user_id ? '<i class="bi bi-line text-success ms-1" title="เชื่อมต่อ LINE แล้ว"></i>' : ''}
                    </td>
                    <td class="text-start small text-muted">${user.pos}</td>
                    <td>
                        <select class="form-select form-select-sm border-primary fw-bold" id="role_select_${uid}">
                            <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>👑 Admin (ทุกเมนู)</option>
                            <option value="officer" ${currentRole === 'officer' ? 'selected' : ''}>💼 Officer (เจ้าหน้าที่)</option>
                            <option value="staff" ${currentRole === 'staff' ? 'selected' : ''}>👤 Staff (บุคลากรทั่วไป)</option>
                        </select>
                    </td>
                    <td>
                        ${isAssigned 
                            ? '<span class="badge bg-success">บันทึกสิทธิ์แล้ว</span>' 
                            : '<span class="badge bg-warning text-dark">รอกำหนดสิทธิ์</span>'}
                    </td>
                    <td>
                        <button type="button" id="btn_save_${uid}" class="btn btn-navy btn-sm fw-bold px-3" 
                                onclick="updateUserRole('${uid}', '${escapeHtml(user.name)}', '${escapeHtml(user.pos)}', '${user.committee_id}', '${user.line_user_id}')">
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
 * 💾 บันทึกสิทธิ์ลงในคอลเลกชัน "users" พร้อมแสดง Pop-up ใหม่ (SweetAlert2)
 */
export async function updateUserRole(uid, name, pos, committeeId, lineUserId) {
    const selectElem = document.getElementById(`role_select_${uid}`);
    const btnSave = document.getElementById(`btn_save_${uid}`);
    if (!selectElem) return;

    const newRole = selectElem.value;

    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status"></span> กำลังบันทึก...`;
    }

    try {
        const userRef = doc(db, "users", uid);
        await setDoc(userRef, {
            name: name,
            pos: pos,
            committee_id: committeeId || uid,
            role: newRole,
            line_user_id: lineUserId || "",
            updated_at: new Date().toISOString()
        }, { merge: true });

        // Pop-up แบบใหม่ สวยงามด้วย SweetAlert2
        Swal.fire({
            icon: 'success',
            title: 'บันทึกสิทธิ์สำเร็จ',
            text: `บันทึกสิทธิ์ให้คุณ "${name}" เรียบร้อยแล้ว`,
            confirmButtonColor: '#0f172a',
            timer: 2000,
            timerProgressBar: true
        });

        await loadUsersTable();

    } catch (error) {
        console.error("❌ Error updateUserRole:", error);
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'ไม่สามารถบันทึกสิทธิ์ได้: ' + error.message,
            confirmButtonColor: '#0f172a'
        });
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = `<i class="bi bi-save me-1"></i> บันทึก`;
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function resetFormToMain() {
    window.location.href = "index.html";
}

document.addEventListener("DOMContentLoaded", () => {
    loadUsersTable();
});

window.loadUsersTable = loadUsersTable;
window.updateUserRole = updateUserRole;
window.resetFormToMain = resetFormToMain;