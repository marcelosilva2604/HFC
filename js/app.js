/* Real preceptor flow: login with personal password, review/edit the month's
 * days, preview the exact sheet, then sign and send. The password decrypts
 * the preceptor's bundle in the browser; nothing sensitive is stored here. */

const YEAR = 2026;

let state = {
  calendar: null,
  preceptorId: null,
  authKey: null,
  bundle: null,       // decrypted: {name, especialidade, pattern, images}
  coordinator: null,  // {images: {signature, stamp}}
  month: null,
  days: [],
  pdfBytes: null,
};

function setStatus(id, msg, kind) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = kind || '';
}

async function init() {
  state.calendar = await loadCalendar(YEAR);
  const selM = document.getElementById('month');
  state.calendar.releasedMonths.forEach((m) =>
    selM.add(new Option(`${MONTH_NAMES[m - 1]} / ${YEAR}`, m)));
  selM.onchange = rebuildDays;

  try {
    const out = await api({ action: 'list' });
    const selP = document.getElementById('preceptor');
    if (!out.preceptors.length) {
      setStatus('loginStatus', 'Nenhum preceptor cadastrado ainda. Fale com a coordenação.', 'error');
      document.getElementById('login').disabled = true;
    }
    out.preceptors.forEach((p) => selP.add(new Option(p.name, p.id)));
  } catch (err) {
    setStatus('loginStatus', `Erro ao carregar: ${err.message}`, 'error');
  }

  document.getElementById('login').onclick = login;
  document.getElementById('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login();
  });
  document.getElementById('generate').onclick = generate;
  document.getElementById('send').onclick = signAndSend;
}

async function login() {
  const btn = document.getElementById('login');
  btn.disabled = true;
  setStatus('loginStatus', 'Verificando...', '');
  try {
    state.preceptorId = document.getElementById('preceptor').value;
    const password = document.getElementById('password').value;
    if (!password) throw new Error('Digite sua senha');
    const saltOut = await api({ action: 'salt', preceptorId: state.preceptorId });
    const { authKey, encKey } = await deriveKeys(password, saltOut.salt);
    const out = await api({ action: 'getBundle', preceptorId: state.preceptorId, authKey });
    state.authKey = authKey;
    state.bundle = await decryptBundle(encKey, out.bundle);
    state.coordinator = out.coordinator;
    document.getElementById('loginPanel').style.display = 'none';
    document.getElementById('workArea').style.display = 'grid';
    document.getElementById('who').textContent =
      `${state.bundle.name} — ${state.bundle.especialidade}`;
    rebuildDays();
  } catch (err) {
    setStatus('loginStatus', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function rebuildDays() {
  state.month = +document.getElementById('month').value;
  const monthDays = buildMonth(state.calendar, YEAR, state.month);
  state.days = applyPattern(monthDays, state.bundle.pattern);
  state.pdfBytes = null;
  document.getElementById('send').style.display = 'none';
  document.getElementById('download').style.display = 'none';
  setStatus('status', '', '');
  renderDays();
}

function renderDays() {
  const box = document.getElementById('days');
  box.innerHTML = '';
  const wd = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  state.days.forEach((d, i) => {
    const row = document.createElement('label');
    row.className = `day ${d.kind}` + (d.shifts ? ' has-shift' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.disabled = !d.shifts;
    cb.checked = d.selected;
    cb.onchange = () => {
      state.days[i].selected = cb.checked;
      state.pdfBytes = null;
      document.getElementById('send').style.display = 'none';
      updateTotal();
    };
    row.appendChild(cb);
    const span = document.createElement('span');
    let desc = `${String(d.day).padStart(2, '0')} (${wd[d.weekday]})`;
    if (d.label) desc += ` — ${d.label}`;
    else if (d.shifts) {
      const parts = [];
      if (d.shifts.exp1) parts.push(`${d.shifts.exp1.in}h–${d.shifts.exp1.out}h`);
      if (d.shifts.exp2) parts.push(`${d.shifts.exp2.in}h–${d.shifts.exp2.out}h${d.shifts.exp2.local ? ' (' + d.shifts.exp2.local + ')' : ''}`);
      desc += ` — ${parts.join(' + ')}`;
    }
    span.textContent = desc;
    row.appendChild(span);
    box.appendChild(row);
  });
  updateTotal();
}

function updateTotal() {
  document.getElementById('total').textContent = `Total do mês: ${totalHours(state.days)} h`;
}

async function generate() {
  const btn = document.getElementById('generate');
  btn.disabled = true;
  btn.textContent = 'Gerando...';
  try {
    const imgs = state.bundle.images;
    const coordImgs = (state.coordinator && state.coordinator.images) || {};
    const images = {
      rubrica: imgs.rubrica ? b64ToBuf(imgs.rubrica) : null,
      signature: imgs.signature ? b64ToBuf(imgs.signature) : null,
      stampPreceptor: imgs.stamp ? b64ToBuf(imgs.stamp) : null,
      coordSignature: coordImgs.signature ? b64ToBuf(coordImgs.signature) : null,
      coordStamp: coordImgs.stamp ? b64ToBuf(coordImgs.stamp) : null,
    };
    const pdfBytes = await generateSheetPdf({
      preceptor: { name: state.bundle.name, especialidade: state.bundle.especialidade },
      monthName: MONTH_NAMES[state.month - 1],
      year: YEAR,
      days: state.days,
      images,
      stamps: {
        preceptorLines: state.bundle.stampLines || null,
        coordLines: (state.coordinator && state.coordinator.stampLines) || null,
      },
    });
    state.pdfBytes = pdfBytes;
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    const frame = document.getElementById('preview');
    const zoom = Math.max(30, Math.floor(((frame.clientHeight || 700) - 10) / 1123 * 100));
    frame.src = `${url}#toolbar=0&navpanes=0&zoom=${zoom}`;
    const dl = document.getElementById('download');
    dl.href = url;
    dl.download = pdfFilename();
    dl.style.display = 'inline-block';
    document.getElementById('send').style.display = 'block';
    setStatus('status', 'Confira a folha ao lado antes de assinar.', '');
  } catch (err) {
    setStatus('status', `Erro ao gerar: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Conferir folha (preview)';
  }
}

function pdfFilename() {
  const month = MONTH_NAMES[state.month - 1].toLowerCase();
  return `folha-${month}-${YEAR}-${state.preceptorId}.pdf`;
}

async function signAndSend() {
  if (!state.pdfBytes) return;
  const btn = document.getElementById('send');
  btn.disabled = true;
  setStatus('status', 'Enviando...', '');
  try {
    let binary = '';
    state.pdfBytes.forEach((b) => { binary += String.fromCharCode(b); });
    const monthLabel = `${MONTH_NAMES[state.month - 1]} ${YEAR}`;
    await api({
      action: 'send',
      preceptorId: state.preceptorId,
      authKey: state.authKey,
      pdfBase64: btoa(binary),
      filename: pdfFilename(),
      monthLabel,
      totalHours: totalHours(state.days),
      subject: `Folha de ponto ${monthLabel} - ${state.bundle.name}`,
      body: `Folha de ponto assinada eletronicamente pelo sistema HFC.\n\n` +
        `Preceptor: ${state.bundle.name}\nSetor: ${state.bundle.especialidade}\n` +
        `Mês: ${monthLabel}\nTotal: ${totalHours(state.days)} h`,
    });
    setStatus('status', 'Folha assinada e enviada com sucesso!', 'ok');
  } catch (err) {
    setStatus('status', `Falha no envio: ${err.message}. Baixe o PDF e envie manualmente.`, 'error');
    btn.disabled = false;
  }
}

init();
