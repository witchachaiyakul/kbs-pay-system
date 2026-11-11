// public/js/asset-manage.js
import { db } from "./firestore.js";
import { 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Global Cache
let assetsListCache = [];
let currentSelectedAsset = null;
let currentSubcategories = [];

/**
 * 🛠️ Helper: จัดรูปแบบ Code ย่อยให้เป็น 2 หลัก (เช่น 1 -> 01, 2 -> 02)
 */
function formatCode2Digits(rawCode, defaultIndex = 1) {
    if (!rawCode && rawCode !== 0) {
        return String(defaultIndex).padStart(2, '0');
    }
    const cleanStr = String(rawCode).trim();
    if (!isNaN(cleanStr) && cleanStr.length > 0) {
        return cleanStr.padStart(2, '0');
    }
    return cleanStr;
}

// ============================================================================
// ➕ 0. เพิ่ม/แก้ไขหมวดหมู่หลักใน Firestore (บันทึก name_id ที่กำหนดเอง)
// ============================================================================
export function openAddCategoryModal() {
    document.getElementById("newCatId").value = "";
    document.getElementById("newCatNameId").value = "";
    document.getElementById("newCatName").value = "";
    document.getElementById("newCatGroup").value = "asset";

    const modalElem = document.getElementById("addCategoryModal");
    if (modalElem) {
        const modal = new bootstrap.Modal(modalElem);
        modal.show();
    }
}

export async function addNewCategoryToFirestore() {
    const idInput = document.getElementById("newCatId");
    const nameIdInput = document.getElementById("newCatNameId");
    const nameInput = document.getElementById("newCatName");
    const groupSelect = document.getElementById("newCatGroup");

    const id = idInput ? idInput.value.trim() : "";
    const nameId = nameIdInput ? nameIdInput.value.trim() : id; // ถ้าไม่ระบุ ให้ใช้ id แทน
    const name = nameInput ? nameInput.value.trim() : "";
    const group = groupSelect ? groupSelect.value : "asset";

    if (!id || !name) {
        Swal.fire({
            icon: 'warning',
            title: 'กรอกข้อมูลไม่ครบ',
            text: 'กรุณากรอกรหัสหมวดหมู่ (ID) และชื่อหมวดหมู่ (Name)',
            confirmButtonColor: '#0f172a'
        });
        return;
    }

    const modalElem = document.getElementById("addCategoryModal");
    const modal = bootstrap.Modal.getInstance(modalElem);

    Swal.fire({
        title: 'กำลังบันทึกหมวดหมู่หลัก...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const docRef = doc(db, "asset", id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const confirmOverwrite = await Swal.fire({
                title: 'พบรหัสหมวดหมู่นี้แล้ว',
                text: `รหัส [${id}] มีอยู่ในระบบแล้ว ต้องการบันทึกทับหรือไม่?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'บันทึกทับ',
                cancelButtonText: 'ยกเลิก'
            });

            if (!confirmOverwrite.isConfirmed) return;
        }

        // บันทึกลง Firestore (บันทึก name_id ในระดับเอกสารหลัก)
        await setDoc(docRef, {
            id: id,
            name_id: nameId,
            name: name,
            group: group,
            subcategories: docSnap.exists() ? (docSnap.data().subcategories || []) : [],
            updated_at: new Date().toISOString()
        }, { merge: true });

        if (modal) modal.hide();

        Swal.fire({
            icon: 'success',
            title: 'บันทึกสำเร็จ',
            text: `บันทึกหมวดหมู่ [${id}] (name_id: ${nameId}) เรียบร้อยแล้ว`,
            timer: 1800,
            showConfirmButton: false
        });

        await loadAssetTable();
    } catch (error) {
        console.error("❌ Error adding category:", error);
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: error.message,
            confirmButtonColor: '#0f172a'
        });
    }
}

// ============================================================================
// 🔄 1. โหลดข้อมูลหมวดหมู่ทั้งหมดจาก Collection "asset"
// ============================================================================
export async function loadAssetTable() {
    const tbody = document.getElementById("assetTableBody");
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="5" class="text-center py-4 text-muted">
                <div class="spinner-border spinner-border-sm text-primary me-2"></div> กำลังดึงข้อมูล...
            </td>
        </tr>
    `;

    try {
        const querySnap = await getDocs(collection(db, "asset"));
        const list = [];

        querySnap.forEach((docSnap) => {
            const data = docSnap.data();
            list.push({
                docId: docSnap.id,
                ...data
            });
        });

        // จัดเรียงตาม ID
        list.sort((a, b) => (a.id || a.docId).localeCompare(b.id || b.docId));
        assetsListCache = list;

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">ไม่พบข้อมูลหมวดหมู่ในคอลเลกชัน asset</td></tr>`;
            return;
        }

        renderAssetTable(list);
    } catch (error) {
        console.error("❌ Error loadAssetTable:", error);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-4 text-danger">
                    เกิดข้อผิดพลาดในการโหลดข้อมูล: ${error.message}
                </td>
            </tr>
        `;
    }
}

export function filterAssetCategoryTable() {
    const searchVal = (document.getElementById("searchAssetInput")?.value || "").trim().toLowerCase();
    
    const filtered = assetsListCache.filter(item => {
        const idStr = String(item.id || item.docId).toLowerCase();
        const nameIdStr = String(item.name_id || "").toLowerCase();
        const nameStr = String(item.name || "").toLowerCase();
        return idStr.includes(searchVal) || nameIdStr.includes(searchVal) || nameStr.includes(searchVal);
    });

    renderAssetTable(filtered);
}

function renderAssetTable(list) {
    const tbody = document.getElementById("assetTableBody");
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">ไม่พบหมวดหมู่ที่ตรงตามคำค้นหา</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((item) => {
        const id = item.id || item.docId;
        const nameId = item.name_id || id;
        const name = item.name || "-";
        const group = item.group || "asset";
        const isSelected = currentSelectedAsset && currentSelectedAsset.docId === item.docId;

        const badgeClass = (group === 'supplies') ? 'bg-warning text-dark' : 'bg-primary';

        return `
            <tr class="${isSelected ? 'table-primary' : ''}">
                <td class="fw-bold text-navy">${id}</td>
                <td class="small font-monospace text-muted">${nameId}</td>
                <td>${name}</td>
                <td><span class="badge ${badgeClass}">${group}</span></td>
                <td class="text-center">
                    <button type="button" class="btn btn-navy btn-sm fw-bold px-2" onclick="selectAssetCategory('${item.docId}')">
                        <i class="bi bi-check-circle me-1"></i> เลือก
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ============================================================================
// 🎯 2. เลือกหมวดหมู่เพื่อแสดงรายละเอียดและแก้ไข Subcategories
// ============================================================================
export function selectAssetCategory(docId) {
    const targetAsset = assetsListCache.find(a => a.docId === docId);
    if (!targetAsset) return;

    currentSelectedAsset = targetAsset;
    
    const rawSubs = Array.isArray(targetAsset.subcategories) ? targetAsset.subcategories : [];
    currentSubcategories = rawSubs.map((sub, idx) => ({
        code: formatCode2Digits(sub.code, idx + 1),
        name: sub.name || "",
        ...(sub.type ? { type: sub.type } : {})
    }));

    renderAssetTable(assetsListCache);

    document.getElementById("noSelectionNotice").style.display = "none";
    document.getElementById("subcategorySection").style.display = "block";

    document.getElementById("selectedAssetTitle").innerHTML = `<i class="bi bi-pencil-square me-2 text-warning"></i>จัดการหมวดหมู่ย่อย [${targetAsset.id || docId}]`;
    document.getElementById("infoAssetId").textContent = targetAsset.id || docId;
    document.getElementById("infoAssetName").textContent = targetAsset.name || "";
    document.getElementById("infoAssetGroup").textContent = `Group: ${targetAsset.group || "asset"}`;

    // 🎯 ดึง name_id จาก Root Field ของ Document มาใส่ในช่อง Input (ถ้าไม่มี ให้ใช้ ID เป็นค่าเริ่มต้น)
    const nameIdInput = document.getElementById("editCategoryNameId");
    if (nameIdInput) {
        nameIdInput.value = targetAsset.name_id || targetAsset.id || docId;
    }

    const nextSeq = currentSubcategories.length + 1;
    document.getElementById("newSubCode").value = formatCode2Digits(nextSeq);

    renderSubcategoriesTable();
}

// ============================================================================
// ➕ 3. เพิ่มรายการย่อย (Add Subcategory)
// ============================================================================
export function handleAddSubcategory() {
    const codeInput = document.getElementById("newSubCode");
    const nameInput = document.getElementById("newSubName");
    const typeSelect = document.getElementById("newSubType");

    const rawCode = codeInput ? codeInput.value.trim() : "";
    const name = nameInput ? nameInput.value.trim() : "";
    const type = typeSelect ? typeSelect.value : "";

    if (!name) {
        Swal.fire({
            icon: 'warning',
            title: 'กรอกข้อมูลไม่ครบ',
            text: 'กรุณากรอกชื่อรายการย่อย',
            confirmButtonColor: '#0f172a'
        });
        return;
    }

    const formattedCode = formatCode2Digits(rawCode, currentSubcategories.length + 1);

    const newItem = {
        code: formattedCode, // 👈 2 หลัก เช่น "01"
        name: name
    };

    if (type) {
        newItem.type = type;
    }

    currentSubcategories.push(newItem);

    const nextSeq = currentSubcategories.length + 1;
    if (codeInput) codeInput.value = formatCode2Digits(nextSeq);
    if (nameInput) nameInput.value = "";
    if (typeSelect) typeSelect.value = "";

    renderSubcategoriesTable();
}

// ============================================================================
// 🗑️ 4. ลบรายการย่อย (Delete Subcategory)
// ============================================================================
export function removeSubcategory(index) {
    currentSubcategories.splice(index, 1);
    renderSubcategoriesTable();
}

function renderSubcategoriesTable() {
    const tbody = document.getElementById("subcategoriesTableBody");
    if (!tbody) return;

    if (currentSubcategories.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted py-3">ยังไม่มีรายการย่อยในหมวดหมู่นี้</td></tr>`;
        return;
    }

    tbody.innerHTML = currentSubcategories.map((sub, idx) => {
        let typeBadge = "-";
        if (sub.type) {
            let color = "bg-secondary";
            if (sub.type === "วัสดุสิ้นเปลือง") color = "bg-danger";
            if (sub.type === "วัสดุคงทน") color = "bg-success";
            if (sub.type === "วัสดุอุปกรณ์ประกอบและอะไหล่") color = "bg-warning text-dark";
            typeBadge = `<span class="badge ${color}">${sub.type}</span>`;
        }

        return `
            <tr>
                <td>${idx + 1}</td>
                <td class="fw-bold text-navy">${sub.code || "-"}</td>
                <td class="text-start fw-bold">${sub.name || "-"}</td>
                <td>${typeBadge}</td>
                <td>
                    <button type="button" class="btn btn-outline-danger btn-sm py-0" onclick="removeSubcategory(${idx})">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ============================================================================
// 💾 5. บันทึกข้อมูลกลับไปยัง Firestore
// ============================================================================
export async function saveSubcategoriesToFirestore() {
    if (!currentSelectedAsset) return;

    const docId = currentSelectedAsset.docId || currentSelectedAsset.id;

    // 🎯 อ่านค่า name_id จากช่อง Input
    const nameIdInput = document.getElementById("editCategoryNameId");
    const updatedNameId = (nameIdInput && nameIdInput.value.trim() !== "")
        ? nameIdInput.value.trim()
        : (currentSelectedAsset.name_id || docId);

    Swal.fire({
        title: 'กำลังบันทึกข้อมูล...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const docRef = doc(db, "asset", docId);
        
        // 🎯 บันทึก name_id เข้าเป็น Root Field ของ Document /asset/{docId}
        await setDoc(docRef, {
            name_id: updatedNameId,
            subcategories: currentSubcategories,
            updated_at: new Date().toISOString()
        }, { merge: true });

        // อัปเดต Cache ในเครื่อง
        currentSelectedAsset.name_id = updatedNameId;
        currentSelectedAsset.subcategories = [...currentSubcategories];

        Swal.fire({
            icon: 'success',
            title: 'บันทึกสำเร็จ',
            text: `อัปเดตฟิลด์หลัก name_id: "${updatedNameId}" เรียบร้อยแล้ว`,
            timer: 1800,
            showConfirmButton: false
        });

        loadAssetTable();
    } catch (error) {
        console.error("❌ Error saving name_id to Firestore:", error);
        Swal.fire({
            icon: 'error',
            title: 'บันทึกล้มเหลว',
            text: error.message,
            confirmButtonColor: '#0f172a'
        });
    }
}

export function resetFormToMain() {
  window.location.href = "index.html";
}


// ============================================================================
// 🚀 AUTO-LOAD ON DOM READY
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
    loadAssetTable();
});

// ============================================================================
// 🌐 ATTACH TO WINDOW
// ============================================================================
window.openAddCategoryModal = openAddCategoryModal;
window.addNewCategoryToFirestore = addNewCategoryToFirestore;
window.loadAssetTable = loadAssetTable;
window.filterAssetCategoryTable = filterAssetCategoryTable;
window.selectAssetCategory = selectAssetCategory;
window.handleAddSubcategory = handleAddSubcategory;
window.removeSubcategory = removeSubcategory;
window.saveSubcategoriesToFirestore = saveSubcategoriesToFirestore;
window.resetFormToMain = resetFormToMain;