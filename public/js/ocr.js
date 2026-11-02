// ============================================================================
// 📸 TYPHOON OCR AI SCANNING (ระบบถอดรหัสบิลรองรับ Image & PDF - ไร้บั๊ก JSON)
// ============================================================================
const API_KEY = PropertiesService.getScriptProperties().getProperty('TYPHOON_API_KEY');
const FOLDER_ID2 = '1mSCMjqKSIDKdTVk6sPc-_J1SM0DoMY9l';
const LOG_SHEET_NAME = 'Log_OCR';

function processInvoice(fileData, fileName, logNo) {
  if (!API_KEY) return { success: false, message: "ไม่พบ API KEY" };
  
  let fileUrl = "No URL";
  let aiRawResponse = "";
  
  try {
    // ------------------------------------------------------------------------
    // Step 1: บันทึกไฟล์ลง Drive และเปลี่ยนชื่อตาม นผ.2 (ป้องกันไฟล์ทับกัน)
    // ------------------------------------------------------------------------
    const contentType = fileData.substring(5, fileData.indexOf(';'));
    const bytes = Utilities.base64Decode(fileData.substr(fileData.indexOf('base64,') + 7));
    
    let finalFileName = fileName;
    if (logNo) {
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
      const cleanLogNo = logNo.replace(/\//g, '-');
      finalFileName = cleanLogNo + extension;
    }

    const blob = Utilities.newBlob(bytes, contentType, finalFileName);
    const folder = DriveApp.getFolderById(FOLDER_ID2);
    const file = folder.createFile(blob);
    fileUrl = file.getUrl();
    
    // ------------------------------------------------------------------------
    // Step 2: ใช้พอร์ตเฉพาะทาง (/v1/ocr) เพื่อดึงข้อความ (ตัวนี้อ่าน PDF ได้ฉลุย ไม่ล่ม)
    // ------------------------------------------------------------------------
    const ocrUrl = 'https://api.opentyphoon.ai/v1/ocr';
    const ocrPayload = {
      'file': blob,
      'model': 'typhoon-ocr',
      'task_type': 'v1.5'
    };
    
    const ocrOptions = {
      'method': 'post',
      'headers': { 'Authorization': 'Bearer ' + API_KEY },
      'payload': ocrPayload,
      'muteHttpExceptions': true
    };

    const ocrResponse = UrlFetchApp.fetch(ocrUrl, ocrOptions);
    const ocrJson = JSON.parse(ocrResponse.getContentText());
    let rawText = ocrJson.results?.[0]?.message?.choices?.[0]?.message?.content || "";

    if (!rawText || rawText.trim().length < 5) {
      throw new Error("โมเดลไม่สามารถสกัดข้อความใดๆ ออกมาจากไฟล์นี้ได้ (อาจเป็นไฟล์เสียหรือไม่มีตัวหนังสือ)");
    }

    const cleanText = rawText.trim().replace(/\s+/g, ' '); 

    // ------------------------------------------------------------------------
    // Step 3: ใช้โมเดลตัวใหม่ล่าสุด แปลงข้อความธรรมดาให้กลายเป็น JSON
    // ------------------------------------------------------------------------
    const chatUrl = 'https://api.opentyphoon.ai/v1/chat/completions';
    
    const promptText = `Extract data from this invoice text into a STRICT VALID JSON format. 
CRITICAL RULES FOR VALID JSON:
1. If any product name or text contains double quotes (like 1" or 2" or "Brand Name"), you MUST escape them with a backslash as \\" (e.g., "ท่อ PVC 2\\"" or "กระดาษ \\"Double A\\"") to prevent JSON parsing errors.
2. Every object inside the "items" array MUST be perfectly separated by a comma (,). Do NOT omit commas between items.
3. Ensure "qu" and "pr" are strictly pure numbers.

Format:
{
  "seller": "Name of the shop/company",
  "taxid": "13-digit tax ID number",
  "inv_no": "Invoice or Receipt number",
  "doc_date": "Date in YYYY-MM-DD format",
  "items": [
    { "list": "Product name", "qu": 1, "unit": "pcs/box", "pr": 100.00 }
  ]
}`;
    
    const chatPayload = {
      'model': 'typhoon-v2.5-30b-a3b-instruct', // 🎯 เปลี่ยนเป็นชื่อโมเดลเวอร์ชันอัปเดตล่าสุดที่ผ่านการันตีแล้ว
      'messages': [
        { 'role': 'system', 'content': 'You are a strict JSON generator. Your output must perfectly comply with JSON standard.' },
        { 'role': 'user', 'content': `${promptText}\n\nText to process:\n"${cleanText}"` }
      ],
      'response_format': { "type": "json_object" }, 
      'temperature': 0.0, // บังคับให้นิ่งที่สุด ป้องกัน AI พิมพ์ตกหล่น
      'max_tokens': 4000
    };

    const chatOptions = {
      'method': 'post',
      'headers': {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      },
      'payload': JSON.stringify(chatPayload),
      'muteHttpExceptions': true
    };

    const chatResponse = UrlFetchApp.fetch(chatUrl, chatOptions);
    if (chatResponse.getResponseCode() !== 200) {
      saveLogToSheet(SS_ID, LOG_SHEET_NAME, fileUrl, `API_CHAT_FAIL_${chatResponse.getResponseCode()}`, chatResponse.getContentText());
      throw new Error("Chat Error: " + chatResponse.getContentText());
    }

    const chatResult = JSON.parse(chatResponse.getContentText());
    let aiContent = chatResult.choices?.[0]?.message?.content || "";
    aiRawResponse = aiContent; 
    
    // ------------------------------------------------------------------------
    // Step 4: ดักซ่อมแซมโครงสร้างคอมมาเผื่อ AI พิมพ์พลาด (Auto-Repair)
    // ------------------------------------------------------------------------
    aiContent = aiContent.replace(/```json/g, "").replace(/```/g, "").trim();
    aiContent = aiContent.replace(/}\s*{/g, "},{"); // ดักซ่อมตัวคั่นระหว่างแถวสินค้า
    aiContent = aiContent.replace(/,\s*]/g, "]");   // ลบคอมมาส่วนเกินทิ้งท้ายแถว
    aiContent = aiContent.replace(/,\s*}/g, "}");
    
    const firstBrace = aiContent.indexOf('{');
    const lastBrace = aiContent.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
       aiContent = aiContent.substring(firstBrace, lastBrace + 1);
       let extractedData = JSON.parse(aiContent);
       
       // ส่งคัดแยกหมวดหมู่ร้านค้าตามเงื่อนไขเดิมของพี่
       extractedData = dispatchShopProcessor(extractedData, cleanText);

       saveLogToSheet(SS_ID, LOG_SHEET_NAME, fileUrl, "SUCCESS", aiRawResponse);
       return { success: true, fileUrl: fileUrl, ocrData: extractedData, message: "✅ ประมวลผลสำเร็จ (รองรับ PDF เรียบร้อย)" };
       
    } else {
       throw new Error("โครงสร้างตัวอักษรที่ตอบกลับมาไม่สมบูรณ์เป็นปีกกา JSON");
    }

  } catch (e) {
    if (!e.message.includes("Error")) {
        saveLogToSheet(SS_ID, LOG_SHEET_NAME, fileUrl, "SYSTEM_ERROR", e.message + " | Raw: " + aiRawResponse);
    }
    return { success: false, message: "❌ " + e.message };
  }
}

/**
 * ----------------------------------------------------------------------
 * Main Dispatcher: ตัวแยกทางเพื่อส่งข้อมูลไปประมวลผลตามร้านค้า (แก้ไขบั๊กตัวแปร)
 * ----------------------------------------------------------------------
 */
function dispatchShopProcessor(data, rawText) {
  // รวบรวมข้อความทำเป็นพิมพ์เล็กทั้งหมดเพื่อป้องกันความผิดพลาดเรื่องการตรวจคำพิมพ์ใหญ่-เล็ก
  const combinedText = (JSON.stringify(data) + rawText).toLowerCase();
  const sellerName = (data.seller || "").toLowerCase(); // 🎯 [แก้ไขบิ๊กบั๊ก]: ดึงค่าชื่อร้านมาฝังตัวแปรไว้ก่อนเพื่อไม่ให้ระบบแครชหลุดวงโคจร

  // 1. ตรวจสอบเงื่อนไขกลุ่ม "ร้านแสงอรุณ"
  if (combinedText.includes("แสงอรุณ") || sellerName.includes("แสงอรุณ")) {
      console.log("Detect: Sang Arun Shop");
      if (typeof processSangArun === 'function') {
         return processSangArun(data, rawText);
      }
  } 
  // 2. ตรวจสอบเงื่อนไขกลุ่ม "ทีบีดีไซน์"
  else if (sellerName.includes("ทีบีดีไซน์") || sellerName.includes("tb design")) {
      data.shopName = "ทีบีดีไซน์";
      if (typeof processTBDesign === 'function') {
         return processTBDesign(data);
      }
  }

  // 3. ปลายทางกรณีเป็นบิลทั่วไปอื่น ๆ
  data.shopName = "ทั่วไป";
  return data;
}

/**
 * ฟังก์ชันเฉพาะ แสงอรุณ: รองรับทั้ง HTML Table และ Pipe Table
 */
function processSangArun(data, rawText, fileId) {
    console.log("⚡ เริ่มทำงาน: processSangArun (V.Hybrid)"); 
    
    // ------------------------------------------
    // 1. จัดการ Header (ชื่อร้าน, VAT, วันที่, เลขที่)
    // ------------------------------------------
    data.seller = "บริษัท แสงอรุณเคมีภัณฑ์ จำกัด";
    data.vat_type = "In Vat 7%"; 

    // วันที่
    const dateMatch = rawText.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/); 
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      const yearAD = (2500 + parseInt(dateMatch[3])) - 543; 
      data.doc_date = `${yearAD}-${month}-${day}`;
    }

    // เลขที่
    if (!data.inv_no) {
       const invMatch = rawText.match(/Order No\s*([A-Z0-9]+)/i) || rawText.match(/เลขที่.*?\s*([A-Z0-9]+)/);
       if (invMatch) data.inv_no = invMatch[1];
    }

    // ------------------------------------------
    // 2. 🔥 แกะรายการสินค้า (รองรับ 2 รูปแบบ)
    // ------------------------------------------
    let manualItems = [];

    // --- วิธีที่ A: แกะจาก HTML Tag <table> (ตาม Log ที่คุณให้มา) ---
    if (rawText.includes('<table')) {
        console.log("🔎 ตรวจพบรูปแบบ HTML Table");
        // ลบ newline เพื่อให้ Regex ทำงานง่ายขึ้น
        const cleanText = rawText.replace(/\n/g, '');
        // ดึงทุก row <tr>...</tr>
        const rows = cleanText.match(/<tr>(.*?)<\/tr>/g);
        
        if (rows) {
            rows.forEach(row => {
                // ดึง cell <td>...</td>
                const cells = row.match(/<td>(.*?)<\/td>/g);
                if (cells && cells.length >= 4) {
                    // ลบ tag <td> ออกให้เหลือแต่ข้อความข้างใน
                    const cleanCells = cells.map(c => c.replace(/<\/?td>/g, '').trim());
                    
                    // Mapping ตาม Log ของคุณ:
                    // index 0: รหัส (อบ 0832)
                    // index 1: ชื่อ (ผงซักฟอก...)
                    // index 2: จำนวน+หน่วย (6.0 ลัง) <--- ต้องแยก
                    // index 3: ราคา (915.000)
                    
                    const name = cleanCells[1];
                    const qtyUnitRaw = cleanCells[2]; // "6.0 ลัง"
                    const priceRaw = cleanCells[3];
                    
                    // ข้ามบรรทัดหัวตาราง (ถ้าเจอคำว่า รายละเอียด)
                    if (!name.includes("รายละเอียด") && name !== "") {
                        
                        // แยก จำนวน กับ หน่วย ออกจากกัน (6.0 ลัง)
                        let qty = 1;
                        let unit = "";
                        // Regex: หาตัวเลขข้างหน้า (group1) ตามด้วยเว้นวรรคและข้อความ (group2)
                        const splitMatch = qtyUnitRaw.match(/^([\d,.]+)\s+(.*)$/);
                        if (splitMatch) {
                            qty = parseFloat(splitMatch[1].replace(/,/g, ''));
                            unit = splitMatch[2];
                        } else {
                            // ถ้าแยกไม่ได้ ให้ลองแปลงเป็นเลขตรงๆ
                            qty = parseFloat(qtyUnitRaw.replace(/,/g, '')) || 1;
                        }

                        manualItems.push({
                            "list": name,
                            "qu": qty,
                            "unit": unit,
                            "pr": parseFloat(priceRaw.replace(/,/g, '')) || 0
                        });
                    }
                }
            });
        }
    }

    // --- วิธีที่ B: แกะจาก Pipe | (เผื่อ AI เปลี่ยนใจส่งแบบเดิมมา) ---
    if (manualItems.length === 0) {
        console.log("🔎 ตรวจพบรูปแบบ Pipe Table หรือ Text ทั่วไป");
        const lines = rawText.split('\n');
        lines.forEach(line => {
            if (line.includes('|') && !line.includes('รหัสสินค้า')) {
                const cols = line.split('|').map(s => s.trim());
                if (cols.length >= 6) {
                    manualItems.push({
                        "list": cols[2],
                        "qu": parseFloat(cols[3].replace(/,/g, '')) || 1,
                        "unit": cols[4],
                        "pr": parseFloat(cols[5].replace(/,/g, '')) || 0
                    });
                }
            }
        });
    }

    // Update ข้อมูลสินค้าลงใน Object หลัก
    if (manualItems.length > 0) {
        console.log(`✅ สกัดสินค้าได้: ${manualItems.length} รายการ`);
        data.items = manualItems;
    }

    // ------------------------------------------
    // 3. ย้ายไฟล์ (ตรวจสอบว่าตัวแปร Global ประกาศแล้วหรือไม่)
    // ------------------------------------------
    if (typeof SANG_ARUN_FOLDER_ID !== 'undefined' && SANG_ARUN_FOLDER_ID && fileId) {
       try {
         DriveApp.getFileById(fileId).moveTo(DriveApp.getFolderById(SANG_ARUN_FOLDER_ID));
       } catch (e) { console.log("Move Error: " + e.message); }
    }

    return data;
}


function processTBDesign(data) {
  // ตรวจสอบความถูกต้องของข้อมูลเบื้องต้น (Data Cleaning)
  if (!data.items || !Array.isArray(data.items)) {
    data.items = [];
  }

  // ปรับจูนข้อมูลตัวเลขให้แน่ใจว่าเป็น Number
  data.items = data.items.map(item => ({
    list: item.list || "ไม่ระบุรายการ",
    qu: Number(item.qu) || 0,
    unit: item.unit || "หน่วย",
    pr: Number(item.pr) || 0
  }));

  // คืนค่าข้อมูลที่ถูกจัดระเบียบแล้ว
  return data;
}

/**
 * ----------------------------------------------------------------------
 * Helper: บันทึก Log
 * ----------------------------------------------------------------------
 */
function saveLogToSheet(ssId, sheetName, url, status, rawData) {
  try {
    // เช็คว่ามี ID หรือไม่ ถ้าไม่มีให้ข้ามไป (ป้องกัน Error)
    if (!ssId || ssId === 'YOUR_SPREADSHEET_ID_HERE') return;

    const ss = SpreadsheetApp.openById(ssId);
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) { 
        sheet = ss.insertSheet(sheetName); 
        sheet.appendRow(["Date", "File URL", "Status", "Raw JSON Data"]);
    }
    sheet.appendRow([new Date(), url, status, rawData]);
  } catch (err) { console.log("Log Error: " + err.message); }
}