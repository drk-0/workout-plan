const SHEET_NAME = "Workout Log";
const SYNC_TOKEN_PROPERTY = "WORKOUT_SYNC_TOKEN";
const MAX_PAYLOAD_BYTES = 200000;
const MAX_LOGS_PER_REQUEST = 200;
const API_VERSION = 2;
const HEADERS = ["id","timestamp","localTime","sessionId","workout","lift","liftName","reps","weight","volume","notes","trigger","receivedAt","durationSeconds"];

function doPost(e) {
  try {
    const contents = e && e.postData && e.postData.contents || "";
    if (!contents || contents.length > MAX_PAYLOAD_BYTES) {
      return jsonResponse({ok:false,error:"Invalid or oversized request."});
    }

    const body = JSON.parse(contents);
    const expectedToken = PropertiesService.getScriptProperties().getProperty(SYNC_TOKEN_PROPERTY);
    if (!expectedToken || expectedToken.length < 24) return jsonResponse({ok:false,error:"Server sync token is not configured securely."});
    if (!constantTimeEqual(body.token, expectedToken)) return jsonResponse({ok:false,error:"Unauthorized."});

    const logs = Array.isArray(body.logs) ? body.logs : null;
    const deletedIds = Array.isArray(body.deletedIds) ? body.deletedIds : null;
    if (!logs || !deletedIds || logs.length > MAX_LOGS_PER_REQUEST || deletedIds.length > MAX_LOGS_PER_REQUEST) {
      return jsonResponse({ok:false,error:"Invalid log batch."});
    }
    const normalizedLogs = logs.map(normalizeLog);
    const normalizedDeletedIds = [...new Set(deletedIds.map(id => safeId(id, "deleted id")))];

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    } else {
      const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (!existingHeaders.includes("durationSeconds")) {
        sheet.getRange(1, existingHeaders.length + 1).setValue("durationSeconds");
      }
    }

    const deleteSet = new Set(normalizedDeletedIds);
    let deleted = 0;
    for (let row = sheet.getLastRow(); row >= 2; row--) {
      const id = String(sheet.getRange(row, 1).getValue() || "");
      if (deleteSet.has(id)) {
        sheet.deleteRow(row);
        deleted++;
      }
    }

    const existingRows = new Map();
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      idValues.forEach((row, index) => {
        if (row[0]) existingRows.set(String(row[0]), index + 2);
      });
    }

    const requestIds = new Set();
    const uniqueLogs = normalizedLogs.filter(log => {
      if (requestIds.has(log.id)) return false;
      requestIds.add(log.id);
      return true;
    });

    const rowForLog = log => [
      log.id,
      log.timestamp,
      log.localTime,
      log.sessionId,
      log.workout,
      log.lift,
      log.liftName,
      log.reps,
      log.weight,
      log.volume,
      log.notes,
      log.trigger,
      new Date().toISOString(),
      log.durationSeconds
    ];

    let updated = 0;
    const newRows = [];
    uniqueLogs.forEach(log => {
      const existingRow = existingRows.get(log.id);
      if (existingRow) {
        sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([rowForLog(log)]);
        updated++;
      } else {
        newRows.push(rowForLog(log));
      }
    });

    if (newRows.length) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, newRows.length, HEADERS.length).setValues(newRows);
    }

    return jsonResponse({
      ok: true,
      apiVersion: API_VERSION,
      saved: newRows.length,
      updated: updated,
      deleted: deleted,
      skipped: normalizedLogs.length - uniqueLogs.length
    });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({ok:false,error:"Request rejected: " + String(err && err.message || err)});
  }
}

function doGet() {
  return ContentService.createTextOutput("Workout Log endpoint is running.").setMimeType(ContentService.MimeType.TEXT);
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEqual(actual, expected) {
  const left = String(actual || "");
  const right = String(expected || "");
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function normalizeLog(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Each log must be an object.");
  const id = safeId(raw.id, "id");
  return {
    id: id,
    timestamp: safeText(raw.timestamp, 64),
    localTime: safeText(raw.localTime, 64),
    sessionId: safeId(raw.sessionId, "sessionId"),
    workout: safeText(raw.workout, 40),
    lift: safeText(raw.lift, 100),
    liftName: safeText(raw.liftName, 100),
    reps: safeNumber(raw.reps, 0, 1000),
    weight: safeNumber(raw.weight, 0, 5000),
    volume: safeNumber(raw.volume, 0, 10000000),
    notes: safeText(raw.notes, 2000),
    trigger: safeText(raw.trigger, 80),
    durationSeconds: safeNumber(raw.durationSeconds, 0, 86400)
  };
}

function safeId(value, name) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9:._-]{1,160}$/.test(text)) throw new Error("Invalid " + name + ".");
  return text;
}

function safeText(value, maxLength) {
  const text = String(value == null ? "" : value).slice(0, maxLength);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function safeNumber(value, min, max) {
  const number = Number(value || 0);
  if (!isFinite(number) || number < min || number > max) throw new Error("Numeric value is out of range.");
  return number;
}
