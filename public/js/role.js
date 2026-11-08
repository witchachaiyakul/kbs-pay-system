// public/js/role.js
import { db } from "./firestore.js";
import { 
    collection, 
    getDocs, 
    doc, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// รายการเมนูทั้งหมดที่สอดคล้องกับ main.html
const ALL_MENUS = [
  { id: 'kbsPay', name: 'จัดทำเอกสารจัดซื้อจัดจ้าง', icon: 'bi-file-earmark-text-fill' },
  { id: 'kbsbudget', name: 'งานแผนโครงการ', icon: 'bi-pie-chart-fill' },
  { id: 'kbsbudgetuse', name: 'ตัดแผน', icon: 'bi-calculator-fill' },
  { id: 'kbslogno', name: 'เลขที่ใบสั่งซื้อสั่งจ้าง', icon: 'bi-card-heading' },
  { id: 'kbsparcelmanage', name: 'การบริหารพัสดุ', icon: 'bi-boxes' },
  { id: 'kbsUserManage', name: 'จัดการสิทธิ์ผู้ใช้งาน', icon: 'bi-people-fill' },
  { id: 'asset-manage', name: 'จัดการหมวดหมู่พัสดุ ครุภัณฑ์', icon: 'bi-folder-fill' }
];

let usersCache = [];
let activeEditingUid = null;
let activeEditingPermissions = [];

/**
 * 🔄 โหลดรายชื่อผู้ใช้งาน
 */
export async function loadUsersTable() {
    const tbody = document.getElementById("userManagementTableBody");
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="7" class="py-4 text-muted">
                <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                กำลังดึงข้อมูลผู้ใช้งานและรายชื่อคณะกรรมการ...
            </td>
        </tr>
    `;

    try {
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
                permissions: Array.isArray(data.permissions) ? data.permissions : [],
                committee_id: data.committee_id || id,
                line_user_id: data.line_user_id || "",
                isAssigned: true
            });

            if (data.committee_id) {
                assignedCommitteeIds.add(data.committee_id);
            }
            assignedCommitteeIds.add(id);
        });

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
                    permissions: [],
                    committee_id: cId,
                    line_user_id: cData.line_user_id || "",
                    isAssigned: false
                });
            }
        });

        usersCache = [...existingUsers, ...pendingCommittees];

        if (usersCache.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-muted">ไม่พบข้อมูลบุคลากรในระบบ</td></tr>`;
            return;
        }

        let html = "";
        let index = 1;

        usersCache.forEach((user) => {
            const uid = user.id;
            const currentRole = user.role;
            const isAssigned = user.isAssigned;
            const userPerms = user.permissions;

            html += `
                <tr>
                    <td>${index++}</td>
                    <td class="text-start fw-bold text-navy">
                        ${user.name}
                        ${user.line_user_id ? '<i class="bi bi-line text-success ms-1" title="เชื่อมต่อ LINE แล้ว"></i>' : ''}
                    </td>
                    <td class="text-start small text-muted">${user.pos}</td>
                    <td>
                        <select class="form-select form-select-sm border-primary fw-bold" id="role_select_${uid}" onchange="handleRoleChange('${uid}')">
                            <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>👑 Admin (ทุกเมนู)</option>
                            <option value="officer" ${currentRole === 'officer' ? 'selected' : ''}>💼 Officer (เจ้าหน้าที่)</option>
                            <option value="staff" ${currentRole === 'staff' ? 'selected' : ''}>👤 Staff (บุคลากรทั่วไป)</option>
                        </select>
                    </td>
                    <td>
                        <button type="button" class="btn btn-outline-secondary btn-sm fw-bold px-2" id="btn_perm_${uid}" 
                                onclick="openPermissionsModal('${uid}')" ${currentRole === 'admin' ? 'disabled' : ''}>
                            <i class="bi bi-sliders me-1"></i> 
                            <span id="perm_badge_${uid}">${currentRole === 'admin' ? 'ทุกเมนู' : (userPerms.length > 0 ? `${userPerms.length} เมนู` : 'ตั้งค่าสิทธิ์')}</span>
                        </button>
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
                <td colspan="7" class="py-4 text-danger">
                    <i class="bi bi-exclamation-triangle-fill me-1"></i> เกิดข้อผิดพลาดในการโหลดข้อมูล: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * ⚙️ เมื่อเปลี่ยน Role ใน Dropdown
 */
export function handleRoleChange(uid) {
    const selectElem = document.getElementById(`role_select_${uid}`);
    const btnPerm = document.getElementById(`btn_perm_${uid}`);
    const badgeSpan = document.getElementById(`perm_badge_${uid}`);
    if (!selectElem || !btnPerm) return;

    if (selectElem.value === 'admin') {
        btnPerm.disabled = true;
        if (badgeSpan) badgeSpan.innerText = 'ทุกเมนู';
    } else {
        btnPerm.disabled = false;
        const user = usersCache.find(u => u.id === uid);
        const permCount = user && Array.isArray(user.permissions) ? user.permissions.length : 0;
        if (badgeSpan) badgeSpan.innerText = permCount > 0 ? `${permCount} เมนู` : 'ตั้งค่าสิทธิ์';
    }
}

/**
 * 🎛️ เปิด Pop-up Modal ตั้งค่าสิทธิ์เมนูรายบุคคล
 */
export function openPermissionsModal(uid) {
    const user = usersCache.find(u => u.id === uid);
    if (!user) return;

    activeEditingUid = uid;
    activeEditingPermissions = [...(user.permissions || [])];

    const labelName = document.getElementById('permUserName');
    if (labelName) labelName.innerText = `ผู้ใช้งาน: ${user.name} (${user.pos})`;

    const container = document.getElementById('permissionCheckboxesList');
    if (!container) return;

    let html = '';
    ALL_MENUS.forEach(menu => {
        const isChecked = activeEditingPermissions.includes(menu.id);
        html += `
            <div class="form-check form-switch p-2 rounded border bg-light">
                <input class="form-check-input ms-0 me-2" type="checkbox" role="switch" 
                       id="chk_perm_${menu.id}" value="${menu.id}" ${isChecked ? 'checked' : ''}>
                <label class="form-check-label fw-bold text-dark" for="chk_perm_${menu.id}">
                    <i class="bi ${menu.icon} me-1 text-primary"></i> ${menu.name}
                </label>
            </div>
        `;
    });

    container.innerHTML = html;

    const modalElem = document.getElementById('permissionsModal');
    if (modalElem) {
        const bsModal = new bootstrap.Modal(modalElem);
        bsModal.show();
    }
}

/**
 * 💾 ยืนยันสิทธิ์จาก Modal
 */
export function savePermissionsFromModal() {
    if (!activeEditingUid) return;

    const selectedPerms = [];
    ALL_MENUS.forEach(menu => {
        const chk = document.getElementById(`chk_perm_${menu.id}`);
        if (chk && chk.checked) {
            selectedPerms.push(menu.id);
        }
    });

    // อัปเดตใน Cache ความจำชั่วคราว
    const user = usersCache.find(u => u.id === activeEditingUid);
    if (user) {
        user.permissions = selectedPerms;
    }

    const badgeSpan = document.getElementById(`perm_badge_${activeEditingUid}`);
    if (badgeSpan) {
        badgeSpan.innerText = selectedPerms.length > 0 ? `${selectedPerms.length} เมนู` : 'ตั้งค่าสิทธิ์';
    }

    const modalElem = document.getElementById('permissionsModal');
    if (modalElem) {
        const modalInstance = bootstrap.Modal.getInstance(modalElem);
        if (modalInstance) modalInstance.hide();
    }
}

/**
 * 💾 บันทึกสิทธิ์ทั้งหมดลงใน Firestore `users`
 */
export async function updateUserRole(uid, name, pos, committeeId, lineUserId) {
    const selectElem = document.getElementById(`role_select_${uid}`);
    const btnSave = document.getElementById(`btn_save_${uid}`);
    if (!selectElem) return;

    const newRole = selectElem.value;
    const user = usersCache.find(u => u.id === uid);
    
    // ถ้าเป็น admin ให้ล้าง permissions เป็นค่าว่าง (เพราะได้ทุกสิทธิ์อัตโนมัติ)
    const finalPermissions = newRole === 'admin' ? [] : (user?.permissions || []);

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
            permissions: finalPermissions,
            line_user_id: lineUserId || "",
            updated_at: new Date().toISOString()
        }, { merge: true });

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
window.handleRoleChange = handleRoleChange;
window.openPermissionsModal = openPermissionsModal;
window.savePermissionsFromModal = savePermissionsFromModal;
window.updateUserRole = updateUserRole;
window.resetFormToMain = resetFormToMain;