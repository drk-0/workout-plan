const SHEET_NAME = "Workout Log";

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    const headers = ["id","timestamp","localTime","workout","lift","liftName","reps","weight","volume","notes","trigger","receivedAt"];
    if (sheet.getLastRow() === 0) sheet.appendRow(headers);

    const body = JSON.parse(e.postData.contents || "{}");
    const logs = Array.isArray(body.logs) ? body.logs : [];

    const rows = logs.map(log => [
      log.id || "",
      log.timestamp || "",
      log.localTime || "",
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

    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);

    return ContentService.createTextOutput(JSON.stringify({ok:true,saved:rows.length})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput("Workout Log endpoint is running.").setMimeType(ContentService.MimeType.TEXT);
}
