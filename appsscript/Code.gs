/* HFC - backend (Apps Script web app), version 2.
 *
 * Responsibilities:
 *  - Vault: stores each preceptor's AES-encrypted bundle (signature, rubrica,
 *    stamp images + weekly schedule) in a Drive folder. The encryption key is
 *    derived from the preceptor's password IN THE BROWSER; this script never
 *    sees passwords or plaintext images of preceptors.
 *  - Auth: stores a peppered hash of each preceptor's authKey; rate-limits
 *    failed attempts (5 per 15 minutes).
 *  - Mailer: sends the generated PDF by email and logs every send to a
 *    spreadsheet.
 *  - Admin: registration endpoints protected by an admin token.
 *
 * FIRST-TIME SETUP (run once): open this file in the Apps Script editor,
 * select the function `setup` and click Run. It creates the Drive folder,
 * the log spreadsheet, a random pepper and a random admin token, and prints
 * the admin token (copy it - it is the admin page password).
 *
 * After editing this code: Deploy > Manage deployments > edit (pencil) >
 * Version: New version > Deploy. The /exec URL stays the same.
 */

var RECIPIENT = 'coreme@piracicaba.sp.gov.br';
var CC = 'marcelo_carvalhosilva@hotmail.com';
var MAX_PDF_BYTES = 2 * 1024 * 1024;
var MAX_FAILS = 5;
var LOCK_MINUTES = 15;

/* ---------- setup ---------- */

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('FOLDER_ID')) {
    var folder = DriveApp.createFolder('HFC-vault');
    props.setProperty('FOLDER_ID', folder.getId());
  }
  if (!props.getProperty('LOG_ID')) {
    var ss = SpreadsheetApp.create('HFC-registro-de-envios');
    ss.getActiveSheet().appendRow(['timestamp', 'preceptor', 'mes', 'total_horas', 'arquivo', 'status']);
    props.setProperty('LOG_ID', ss.getId());
  }
  if (!props.getProperty('PEPPER')) {
    props.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());
  }
  if (!props.getProperty('ADMIN_TOKEN')) {
    props.setProperty('ADMIN_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }
  Logger.log('ADMIN TOKEN (senha da pagina admin): ' + props.getProperty('ADMIN_TOKEN'));
  Logger.log('Setup OK. Folder: ' + props.getProperty('FOLDER_ID'));
}

/* ---------- request routing ---------- */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'list': return handleList();
      case 'salt': return handleSalt(data);
      case 'getBundle': return handleGetBundle(data);
      case 'send': return handleSend(data);
      case 'register': return handleRegister(data);
      case 'setCoordinator': return handleSetCoordinator(data);
      case 'adminList': return handleAdminList(data);
      case 'remove': return handleRemove(data);
      default: return jsonOut({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ---------- storage helpers ---------- */

function props() { return PropertiesService.getScriptProperties(); }

function vaultFolder() { return DriveApp.getFolderById(props().getProperty('FOLDER_ID')); }

function readIndex() {
  var raw = props().getProperty('INDEX');
  return raw ? JSON.parse(raw) : {};
}

function writeIndex(idx) {
  props().setProperty('INDEX', JSON.stringify(idx));
}

function readFileByName(name) {
  var files = vaultFolder().getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function writeFile(name, content) {
  var existing = readFileByName(name);
  if (existing) existing.setContent(content);
  else vaultFolder().createFile(name, content, 'application/json');
}

function pepperedHash(authKey) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, authKey + props().getProperty('PEPPER'));
  return Utilities.base64Encode(digest);
}

/* ---------- rate limiting ---------- */

function failKey(id) { return 'fails_' + id; }

function isLocked(id) {
  var fails = CacheService.getScriptCache().get(failKey(id));
  return fails && parseInt(fails, 10) >= MAX_FAILS;
}

function recordFail(id) {
  var cache = CacheService.getScriptCache();
  var fails = parseInt(cache.get(failKey(id)) || '0', 10) + 1;
  cache.put(failKey(id), String(fails), LOCK_MINUTES * 60);
}

function clearFails(id) {
  CacheService.getScriptCache().remove(failKey(id));
}

function checkAuth(data) {
  var idx = readIndex();
  var rec = idx[data.preceptorId];
  if (!rec) return { ok: false, error: 'Preceptor não encontrado' };
  if (isLocked(data.preceptorId)) {
    return { ok: false, error: 'Muitas tentativas. Aguarde ' + LOCK_MINUTES + ' minutos.' };
  }
  if (pepperedHash(String(data.authKey || '')) !== rec.verifier) {
    recordFail(data.preceptorId);
    return { ok: false, error: 'Senha incorreta' };
  }
  clearFails(data.preceptorId);
  return { ok: true, rec: rec };
}

/* ---------- public endpoints ---------- */

function handleList() {
  var idx = readIndex();
  var out = Object.keys(idx).map(function (id) {
    return { id: id, name: idx[id].name };
  });
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return jsonOut({ ok: true, preceptors: out });
}

function handleSalt(data) {
  var idx = readIndex();
  var rec = idx[data.preceptorId];
  if (!rec) return jsonOut({ ok: false, error: 'Preceptor não encontrado' });
  return jsonOut({ ok: true, salt: rec.salt });
}

function handleGetBundle(data) {
  var auth = checkAuth(data);
  if (!auth.ok) return jsonOut(auth);
  var file = readFileByName('bundle_' + data.preceptorId + '.json');
  if (!file) return jsonOut({ ok: false, error: 'Pacote não encontrado' });
  var coordFile = readFileByName('coordinator.json');
  return jsonOut({
    ok: true,
    bundle: JSON.parse(file.getBlob().getDataAsString()),
    coordinator: coordFile ? JSON.parse(coordFile.getBlob().getDataAsString()) : null,
  });
}

function handleSend(data) {
  var auth = checkAuth(data);
  if (!auth.ok) return jsonOut(auth);
  var bytes = Utilities.base64Decode(data.pdfBase64);
  if (bytes.length > MAX_PDF_BYTES) return jsonOut({ ok: false, error: 'PDF muito grande' });
  var filename = String(data.filename || 'folha.pdf').replace(/[^\w.\-]/g, '_');
  var pdf = Utilities.newBlob(bytes, 'application/pdf', filename);
  var options = {
    to: RECIPIENT,
    subject: String(data.subject || 'Folha de ponto').slice(0, 200),
    body: String(data.body || '').slice(0, 2000),
    attachments: [pdf],
    name: 'HFC - Folha de Ponto',
  };
  if (CC) options.cc = CC;
  MailApp.sendEmail(options);
  logSend(auth.rec.name, data.monthLabel, data.totalHours, filename, 'enviado');
  return jsonOut({ ok: true });
}

function logSend(name, month, hours, filename, status) {
  try {
    var ss = SpreadsheetApp.openById(props().getProperty('LOG_ID'));
    ss.getActiveSheet().appendRow([new Date(), name, month || '', hours || '', filename, status]);
  } catch (err) { /* logging must never block sending */ }
}

/* ---------- admin endpoints ---------- */

function checkAdmin(data) {
  return String(data.adminToken || '') === props().getProperty('ADMIN_TOKEN');
}

function handleRegister(data) {
  if (!checkAdmin(data)) return jsonOut({ ok: false, error: 'Token de admin inválido' });
  var idx = readIndex();
  idx[data.preceptorId] = {
    name: String(data.name),
    salt: String(data.salt),
    verifier: pepperedHash(String(data.authKey)),
  };
  writeIndex(idx);
  writeFile('bundle_' + data.preceptorId + '.json', JSON.stringify(data.bundle));
  if (data.coordinator) {
    writeFile('coordinator.json', JSON.stringify(data.coordinator));
  }
  clearFails(data.preceptorId);
  return jsonOut({ ok: true });
}

function handleSetCoordinator(data) {
  if (!checkAdmin(data)) return jsonOut({ ok: false, error: 'Token de admin inválido' });
  writeFile('coordinator.json', JSON.stringify(data.coordinator));
  return jsonOut({ ok: true });
}

function handleAdminList(data) {
  if (!checkAdmin(data)) return jsonOut({ ok: false, error: 'Token de admin inválido' });
  var idx = readIndex();
  var out = Object.keys(idx).map(function (id) {
    return { id: id, name: idx[id].name };
  });
  return jsonOut({ ok: true, preceptors: out });
}

function handleRemove(data) {
  if (!checkAdmin(data)) return jsonOut({ ok: false, error: 'Token de admin inválido' });
  var idx = readIndex();
  delete idx[data.preceptorId];
  writeIndex(idx);
  var file = readFileByName('bundle_' + data.preceptorId + '.json');
  if (file) file.setTrashed(true);
  return jsonOut({ ok: true });
}

/* ---------- util ---------- */

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
