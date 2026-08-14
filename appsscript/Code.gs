/* HFC - email dispatcher (demo phase).
 *
 * Receives a PDF (base64) from the GitHub Pages site and emails it.
 * DEMO SAFETY: the recipient is hardcoded below; the client cannot choose
 * who receives the email, so the public endpoint cannot be abused to spam
 * third parties. COREME delivery will be enabled in a later phase.
 *
 * Deploy: script.google.com > New project > paste this file >
 * Deploy > New deployment > Web app > Execute as: Me >
 * Who has access: Anyone > Deploy > authorize > copy the /exec URL.
 */

var RECIPIENT = 'marcelo_carvalhosilva@hotmail.com';
var MAX_PDF_BYTES = 2 * 1024 * 1024; // 2 MB safety cap

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var bytes = Utilities.base64Decode(data.pdfBase64);
    if (bytes.length > MAX_PDF_BYTES) {
      return jsonOut({ ok: false, error: 'PDF too large' });
    }
    var pdf = Utilities.newBlob(bytes, 'application/pdf',
      String(data.filename || 'folha.pdf').replace(/[^\w.\-]/g, '_'));
    MailApp.sendEmail({
      to: RECIPIENT,
      subject: String(data.subject || 'Folha de ponto').slice(0, 200),
      body: String(data.body || '').slice(0, 2000),
      attachments: [pdf],
      name: 'HFC - Folha de Ponto',
    });
    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
