const SHEET_NAME = "Workout Log";

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    const headers = ["id","timestamp","localTime","sessionId","workout","lift","liftName","reps","weight","volume","notes","trigger","receivedAt"];
    if (sheet.getLastRow() === 0) sheet.appendRow(headers);

    const body = JSON.parse(e.postData.contents || "{}");
    const logs = Array.isArray(body.logs) ? body.logs : [];

    const existingIds = new Set();
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      idValues.forEach(row => {
        if (row[0]) existingIds.add(String(row[0]));
      });
    }

    const newLogs = logs.filter(log => log.id && !existingIds.has(String(log.id)));

    const rows = newLogs.map(log => [
      log.id || "",
      log.timestamp || "",
      log.localTime || "",
      log.sessionId || "",
      log.workout || "",
      log.lift || "",
      log.liftName || "",
      Number(log.reps || 0),
      Number(log.weight || 0),
      Number(log.volume || 0),
      log.notes || "",
      log.trigger || "",
      new Date().toISOString()
    ]);

    if (rows.length) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
    }

    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      saved: rows.length,
      skipped: logs.length - newLogs.length
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput("Workout Log endpoint is running.").setMimeType(ContentService.MimeType.TEXT);
}
