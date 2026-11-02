// ============================================================================
// 📦 PARCEL MANAGEMENT BACKEND LOGIC
// ============================================================================

// 🔍 1. ดึงข้อมูลจาก log_pay เพื่อนำไปบริหารพัสดุ
function getLogPayForParcels(logNo) {
  try {
    if (logNo && logNo.trim() !== '') {
      const cleanLogNo = logNo.trim();
      let res = callFirestore("GET", `log_pay/${cleanLogNo}`);
      if (res && res.fields) {
        return { success: true, data: parseFirestoreFields(res.fields) };
      }
      return { success: false, message: `ไม่พบข้อมูล log_no: ${cleanLogNo}` };
    } else {
      // กรณีไม่ระบุ ให้ดึงรายการล่าสุด 20 รายการ
      const queryPayload = {
        structuredQuery: {
          from: [{ collectionId: "log_pay" }],
          limit: 20
        }
      };
      const queryRes = callFirestore("POST", ":runQuery", queryPayload);
      if (Array.isArray(queryRes)) {
        const list = queryRes
          .filter(q => q.document && q.document.fields)
          .map(q => parseFirestoreFields(q.document.fields));
        return { success: true, data: list };
      }
      return { success: true, data: [] };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// 🏷️ 2. ออกเลขพัสดุอัตโนมัติ (Format: ประเภทเงิน/ลำดับ/ปีงบประมาณ)
function generateParcelNumbersBackend(uids, fundType, yearBE) {
  try {
    // ดึง Counter ล่าสุดของประเภทเงินนั้น
    const counterDocId = `parcel_counter_${fundType}_${yearBE}`;
    let counterRes = callFirestore("GET", `counters/${counterDocId}`);
    let currentSeq = 0;
    
    if (counterRes && counterRes.fields) {
      const parsed = parseFirestoreFields(counterRes.fields);
      currentSeq = Number(parsed.seq) || 0;
    }

    const updates = {};
    uids.forEach(uid => {
      currentSeq++;
      const formattedSeq = String(currentSeq).padStart(4, '0');
      const generatedParcelNo = `${fundType}/${formattedSeq}/${yearBE}`;
      
      const logNo = uid.split('_')[0];
      
      // บันทึกข้อมูลลงใน log_parcels คอลเลกชันแยก
      const parcelData = {
        uid: uid,
        log_no_ref: logNo,
        parcel_no: generatedParcelNo,
        status: 'registered',
        fund_type: fundType,
        year_be: yearBE,
        created_at: new Date().toISOString()
      };
      
      callFirestore("PATCH", `log_parcels/${uid}`, toFirestoreFields(parcelData));
    });

    // อัปเดต Counter กลับไปที่ Firestore
    callFirestore("PATCH", `counters/${counterDocId}`, toFirestoreFields({ seq: currentSeq }));

    return { success: true, message: 'ออกเลขพัสดุสำเร็จ' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// 📤 3. บันทึกการเบิกจ่ายพัสดุ
function issueParcelsBackend(uids, recipient, issueDate) {
  try {
    uids.forEach(uid => {
      const issueData = {
        status: 'issued',
        issued_to: recipient,
        issued_date: issueDate || new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString()
      };
      callFirestore("PATCH", `log_parcels/${uid}`, toFirestoreFields(issueData));
    });
    return { success: true, message: 'บันทึกการเบิกจ่ายเรียบร้อย' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}