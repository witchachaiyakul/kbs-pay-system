// public/js/role.js
import { db } from "./firestore.js";
import {
  collection,
  getDocs,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// รายการเมนูทั้งหมดที่สอดคล้องกับ index.html
const ALL_MENUS = [
  { id: 'kbsPay', name: 'จัดทำเอกสารจัดซื้อจัดจ้าง', icon: 'bi-file-earmark-text-fill' },
  { id: 'kbsbudget', name: 'งานแผนโครงการ', icon: 'bi-pie-chart-fill' },
  { id: 'kbsbudgetuse', name: 'ตัดแผน', icon: 'bi-calculator-fill' },
  { id: 'kbslogno', name: 'เลขที่ใบสั่งซื้อสั่งจ้าง', icon: 'bi-card-heading' },
  { id: 'kbsparcelmanage', name: 'การบริหารพัสดุ', icon: 'bi-boxes' },
  { id: 'dis-parcel', name: 'เบิกจ่ายพัสดุ ครุภัณฑ์', icon: 'bi-folder-fill' },
  { id: 'kbsUserManage', name: 'จัดการสิทธิ์ผู้ใช้งาน', icon: 'bi-people-fill' },
  { id: 'asset-manage', name: 'จัดการหมวดหมู่พัสดุ ครุภัณฑ์', icon: 'bi-folder-fill' }
];

// รายชื่อฝ่ายสำหรับเจ้าหน้าที่พัสดุ
const OFFICER_DIVISIONS = [
  "วิชาการ",
  "บริหารทั่วไป",
  "บุคคล",
  "งบประมาณ",
  "กิจการนักเรียน"
];

// ค่าเริ่มต้น (Default) ของแต่ละ Role เมื่อแอดมินกดเปลี่ยนใน Dropdown
const DEFAULT_PAY_PERMISSIONS = {
  admin: ALL_MENUS.map(m => m.id),
  staff: ['kbsPay', 'kbsbudget'],
  officer: ['kbsPay', 'kbsbudget', 'kbsbudgetuse', 'kbslogno']
};

let usersCache = [];
let activeEditingUid = null;
let activeEditingPermissions = [];
let activeOfficerUid = null;

function parseOfficerDivisions(officerData) {
  if (!officerData) return [];
  if (Array.isArray(officerData.divisions) && officerData.divisions.length > 0) {
    return officerData.divisions.map(v => String(v).trim()).filter(Boolean);
  }
  const raw = typeof officerData === "string" ? officerData : (officerData.division || "");
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

/**
 * 🔄 โหลดรายชื่อบุคลากรจาก "committees" และดึงข้อมูลฝ่ายเจ้าหน้าที่พัสดุจาก "officers"
 */
export async function loadUsersTable() {
  const tbody = document.getElementById("userManagementTableBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="py-4 text-muted">
        <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
        กำลังดึงข้อมูลบุคลากรและสิทธิ์จากระบบ...
      </td>
    </tr>
  `;

  try {
    const [committeesSnap, officersSnap] = await Promise.all([
      getDocs(collection(db, "committees")),
      getDocs(collection(db, "officers"))
    ]);

    // จับคู่ข้อมูลจาก collection "officers" ด้วย Document ID หรือชื่อ
    const officersById = {};
    const officersByName = {};
    officersSnap.forEach((docSnap) => {
      const oData = docSnap.data();
      officersById[docSnap.id] = oData;
      if (oData.name) {
        officersByName[String(oData.name).trim()] = oData;
      }
    });

    const list = [];

    committeesSnap.forEach((docSnap) => {
      const cData = docSnap.data();
      const cId = docSnap.id;
      const fullName = (cData.name || cData.comm_name || "ไม่ระบุชื่อ").trim();
      const currentRole = (cData.role || "staff").toLowerCase();
      const hasSavedPayPerms = Array.isArray(cData.pay_permission);

      let userPayPerms = [];
      if (currentRole === 'admin') {
        userPayPerms = [...DEFAULT_PAY_PERMISSIONS.admin];
      } else if (hasSavedPayPerms) {
        userPayPerms = [...cData.pay_permission];
      } else {
        userPayPerms = [...(DEFAULT_PAY_PERMISSIONS[currentRole] || DEFAULT_PAY_PERMISSIONS.staff)];
      }

      // ดึงฝ่ายที่ดูแลจาก collection "officers"
      const matchedOfficer = officersById[cId] || officersByName[fullName] || null;
      const officerDivs = parseOfficerDivisions(matchedOfficer);

      list.push({
        id: cId,
        name: fullName,
        pos: cData.pos || cData.position || cData.comm_pos || "-",
        role: currentRole,
        pay_permission: userPayPerms,
        officerDivisions: officerDivs,
        committee_id: cId,
        line_user_id: cData.line_user_id || "",
        isAssigned: hasSavedPayPerms || officerDivs.length > 0
      });
    });

    list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    usersCache = list;

    renderUsersRows(usersCache);
  } catch (error) {
    console.error("❌ Error loadUsersTable:", error);
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="py-4 text-danger">
          <i class="bi bi-exclamation-triangle-fill me-1"></i> เกิดข้อผิดพลาดในการโหลดข้อมูล: ${error.message}
        </td>
      </tr>
    `;
  }
}

/**
 * 🔍 ค้นหาผู้ใช้งานในตารางหน้า Role
 */
export function filterUsersTable() {
  const keyword = (document.getElementById("searchUserRole")?.value || "").trim().toLowerCase();
  if (!keyword) {
    renderUsersRows(usersCache);
    return;
  }

  const filtered = usersCache.filter(u => {
    const haystack = [u.name, u.pos, u.role, u.officerDivisions.join(", ")].join(" ").toLowerCase();
    return haystack.includes(keyword);
  });

  renderUsersRows(filtered);
}

function renderUsersRows(list) {
  const tbody = document.getElementById("userManagementTableBody");
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-4 text-muted">ไม่พบข้อมูลบุคลากรตามเงื่อนไขที่ค้นหา</td></tr>`;
    return;
  }

  let html = "";
  let index = 1;

  list.forEach((user) => {
    const uid = user.id;
    const currentRole = user.role;
    const isAssigned = user.isAssigned;
    const userPerms = user.pay_permission;
    const officerList = user.officerDivisions || [];
    const officerLabel = officerList.length > 0 ? officerList.join(", ") : "กำหนดฝ่าย";
    const officerBtnClass = officerList.length > 0 ? "btn-outline-primary" : "btn-outline-secondary";

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
            <span id="perm_badge_${uid}">${currentRole === 'admin' ? `ทุกเมนู (${ALL_MENUS.length})` : (userPerms.length > 0 ? `${userPerms.length} เมนู` : 'ตั้งค่าสิทธิ์')}</span>
          </button>
        </td>
        <td>
          <button type="button" class="btn ${officerBtnClass} btn-sm fw-bold px-2 text-wrap" id="btn_officer_${uid}" 
                  onclick="openOfficerModal('${uid}')" title="จัดการเจ้าหน้าที่พัสดุ">
            <i class="bi bi-box-seam me-1"></i>
            <span id="officer_badge_${uid}">${officerLabel}</span>
          </button>
        </td>
        <td>
          ${isAssigned 
            ? '<span class="badge bg-success">บันทึกสิทธิ์แล้ว</span>' 
            : '<span class="badge bg-warning text-dark">รอกำหนดสิทธิ์</span>'}
        </td>
        <td>
          <button type="button" id="btn_save_${uid}" class="btn btn-navy btn-sm fw-bold px-3 text-nowrap" 
                  onclick="updateUserRole('${uid}', '${escapeHtml(user.name)}', '${escapeHtml(user.pos)}', '${user.committee_id}', '${user.line_user_id}')">
            <i class="bi bi-save me-1"></i> บันทึก
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

export function handleRoleChange(uid) {
  const selectElem = document.getElementById(`role_select_${uid}`);
  const btnPerm = document.getElementById(`btn_perm_${uid}`);
  const badgeSpan = document.getElementById(`perm_badge_${uid}`);
  if (!selectElem || !btnPerm) return;

  const selectedRole = selectElem.value.toLowerCase();
  const user = usersCache.find(u => u.id === uid);

  const defaultPerms = [...(DEFAULT_PAY_PERMISSIONS[selectedRole] || [])];
  if (user) {
    user.role = selectedRole;
    user.pay_permission = defaultPerms;
  }

  if (selectedRole === 'admin') {
    btnPerm.disabled = true;
    if (badgeSpan) badgeSpan.innerText = `ทุกเมนู (${ALL_MENUS.length})`;
  } else {
    btnPerm.disabled = false;
    if (badgeSpan) {
      badgeSpan.innerText = defaultPerms.length > 0 ? `${defaultPerms.length} เมนู` : 'ตั้งค่าสิทธิ์';
    }
  }
}

export function openPermissionsModal(uid) {
  const user = usersCache.find(u => u.id === uid);
  if (!user) return;

  activeEditingUid = uid;
  activeEditingPermissions = [...(user.pay_permission || [])];

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
    bootstrap.Modal.getOrCreateInstance(modalElem).show();
  }
}

export function savePermissionsFromModal() {
  if (!activeEditingUid) return;

  const selectedPerms = [];
  ALL_MENUS.forEach(menu => {
    const chk = document.getElementById(`chk_perm_${menu.id}`);
    if (chk && chk.checked) {
      selectedPerms.push(menu.id);
    }
  });

  const user = usersCache.find(u => u.id === activeEditingUid);
  if (user) {
    user.pay_permission = selectedPerms;
  }

  const badgeSpan = document.getElementById(`perm_badge_${activeEditingUid}`);
  if (badgeSpan) {
    badgeSpan.innerText = selectedPerms.length > 0 ? `${selectedPerms.length} เมนู` : 'ตั้งค่าสิทธิ์';
  }

  const modalElem = document.getElementById('permissionsModal');
  if (modalElem) {
    bootstrap.Modal.getInstance(modalElem)?.hide();
  }
}

// ============================================================================
// 📦 OFFICER DIVISIONS MODAL (จัดการเจ้าหน้าที่พัสดุ -> บันทึกลง officers)
// ============================================================================

export function openOfficerModal(uid) {
  const user = usersCache.find(u => u.id === uid);
  if (!user) return;

  activeOfficerUid = uid;
  const selectedDivs = user.officerDivisions || [];

  const labelName = document.getElementById('officerUserName');
  if (labelName) labelName.innerText = `ผู้ใช้งาน: ${user.name} (${user.pos})`;

  const searchInp = document.getElementById('searchOfficerDivision');
  if (searchInp) searchInp.value = '';

  const container = document.getElementById('officerDivisionsList');
  if (!container) return;

  container.innerHTML = OFFICER_DIVISIONS.map((divName, idx) => {
    const isChecked = selectedDivs.includes(divName);
    return `
      <div class="form-check p-2 px-3 rounded border bg-light officer-div-item" data-division="${divName}">
        <input class="form-check-input me-2" type="checkbox" id="chk_officer_div_${idx}" value="${divName}" ${isChecked ? 'checked' : ''}>
        <label class="form-check-label fw-bold text-dark w-100" style="cursor: pointer;" for="chk_officer_div_${idx}">
          <i class="bi bi-building me-1 text-primary"></i> ${divName}
        </label>
      </div>
    `;
  }).join('');

  const modalElem = document.getElementById('officerModal');
  if (modalElem) {
    bootstrap.Modal.getOrCreateInstance(modalElem).show();
  }
}

export function filterOfficerDivisions() {
  const keyword = (document.getElementById('searchOfficerDivision')?.value || '').trim().toLowerCase();
  const items = document.querySelectorAll('.officer-div-item');
  items.forEach(item => {
    const divName = (item.getAttribute('data-division') || '').toLowerCase();
    item.classList.toggle('d-none', keyword && !divName.includes(keyword));
  });
}

export function clearOfficerDivisionsInModal() {
  OFFICER_DIVISIONS.forEach((_, idx) => {
    const chk = document.getElementById(`chk_officer_div_${idx}`);
    if (chk) chk.checked = false;
  });
}

export function saveOfficerFromModal() {
  if (!activeOfficerUid) return;

  const selectedDivs = [];
  OFFICER_DIVISIONS.forEach((divName, idx) => {
    const chk = document.getElementById(`chk_officer_div_${idx}`);
    if (chk && chk.checked) {
      selectedDivs.push(divName);
    }
  });

  const user = usersCache.find(u => u.id === activeOfficerUid);
  if (user) {
    user.officerDivisions = selectedDivs;
  }

  const btnOfficer = document.getElementById(`btn_officer_${activeOfficerUid}`);
  const badgeSpan = document.getElementById(`officer_badge_${activeOfficerUid}`);
  if (badgeSpan) {
    badgeSpan.innerText = selectedDivs.length > 0 ? selectedDivs.join(", ") : "กำหนดฝ่าย";
  }
  if (btnOfficer) {
    btnOfficer.className = `btn ${selectedDivs.length > 0 ? 'btn-outline-primary' : 'btn-outline-secondary'} btn-sm fw-bold px-2 text-wrap`;
  }

  const modalElem = document.getElementById('officerModal');
  if (modalElem) {
    bootstrap.Modal.getInstance(modalElem)?.hide();
  }
}

/**
 * 💾 บันทึกสิทธิ์ (role, pay_permission ลง committees และข้อมูลเจ้าหน้าที่พัสดุลง officers)
 */
export async function updateUserRole(uid, name, pos, committeeId, lineUserId) {
  const selectElem = document.getElementById(`role_select_${uid}`);
  const btnSave = document.getElementById(`btn_save_${uid}`);
  if (!selectElem) return;

  const newRole = selectElem.value.toLowerCase();
  const user = usersCache.find(u => u.id === uid);
  const targetDocId = committeeId || uid;

  const finalPayPermissions = newRole === 'admin'
    ? [...DEFAULT_PAY_PERMISSIONS.admin]
    : (user?.pay_permission || []);

  const selectedDivs = user?.officerDivisions || [];
  const divisionStr = selectedDivs.join(", ");

  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status"></span> กำลังบันทึก...`;
  }

  try {
    // 1. บันทึกสิทธิ์เข้าเมนูและ Role ลงใน committees
    await setDoc(doc(db, "committees", targetDocId), {
      role: newRole,
      pay_permission: finalPayPermissions,
      updated_at: new Date().toISOString()
    }, { merge: true });

    // 2. บันทึกข้อมูลเจ้าหน้าที่พัสดุลงใน collection "officers"
    await setDoc(doc(db, "officers", targetDocId), {
      name: name,
      pos: selectedDivs.length > 0 ? "เจ้าหน้าที่" : "",
      division: divisionStr,
      divisions: selectedDivs,
      role: newRole,
      committee_id: targetDocId,
      updated_at: new Date().toISOString()
    }, { merge: true });

    Swal.fire({
      icon: 'success',
      title: 'บันทึกสิทธิ์สำเร็จ',
      text: `อัปเดตสิทธิ์ของ "${name}" เรียบร้อยแล้ว`,
      confirmButtonColor: '#0f172a',
      timer: 1800,
      showConfirmButton: false
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
window.filterUsersTable = filterUsersTable;
window.handleRoleChange = handleRoleChange;
window.openPermissionsModal = openPermissionsModal;
window.savePermissionsFromModal = savePermissionsFromModal;
window.openOfficerModal = openOfficerModal;
window.filterOfficerDivisions = filterOfficerDivisions;
window.clearOfficerDivisionsInModal = clearOfficerDivisionsInModal;
window.saveOfficerFromModal = saveOfficerFromModal;
window.updateUserRole = updateUserRole;
window.resetFormToMain = resetFormToMain;