/* Demo UI: fictitious preceptors, month selection, day editing and PDF preview.
 * Real preceptor data, passwords and encrypted assets come in the next phase
 * (Apps Script vault); nothing sensitive lives in this repo. */

const DEMO_PRECEPTORS = [
  {
    id: 'demo-uti',
    name: 'Dra. Exemplo de Demonstração',
    especialidade: 'UTI Pediátrica (demo)',
    pattern: {
      mon: { exp1: { in: 7, out: 13 } },
      tue: { exp1: { in: 7, out: 13 } },
      wed: { exp1: { in: 7, out: 13 } },
      thu: { exp1: { in: 7, out: 13 } },
      fri: { exp1: { in: 7, out: 13 } },
    },
  },
  {
    id: 'demo-amb',
    name: 'Dr. Modelo de Teste',
    especialidade: 'Ambulatório (demo)',
    pattern: {
      tue: { exp2: { in: 12, out: 17, local: 'UPA' } },
      thu: { exp2: { in: 12, out: 17, local: 'UPA' } },
    },
  },
];

/* Placeholder handwriting-style images rendered on a canvas, so the demo
 * needs no real signature files. */
function handwritingPng(text, { width = 300, height = 90, size = 48 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a2ea0';
  ctx.font = `italic ${size}px "Snell Roundhand", "Brush Script MT", cursive`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2);
  return new Promise((resolve) =>
    canvas.toBlob((b) => b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))), 'image/png'));
}

function stampPng(lines) {
  const canvas = document.createElement('canvas');
  canvas.width = 280;
  canvas.height = 110;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#233';
  ctx.textAlign = 'center';
  lines.forEach((ln, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}22px Georgia`;
    ctx.fillText(ln, 140, 34 + i * 26);
  });
  return new Promise((resolve) =>
    canvas.toBlob((b) => b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))), 'image/png'));
}

let state = { calendar: null, days: [], preceptor: null, month: null };

async function init() {
  state.calendar = await loadCalendar(2026);

  const selP = document.getElementById('preceptor');
  DEMO_PRECEPTORS.forEach((p, i) => selP.add(new Option(p.name, i)));

  const selM = document.getElementById('month');
  state.calendar.releasedMonths.forEach((m) =>
    selM.add(new Option(`${MONTH_NAMES[m - 1]} / 2026`, m)));

  selP.onchange = rebuild;
  selM.onchange = rebuild;
  document.getElementById('generate').onclick = generate;
  document.getElementById('send').onclick = sendByEmail;
  rebuild();
}

function setStatus(msg, kind) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = kind || '';
}

async function sendByEmail() {
  if (!CONFIG.scriptUrl) {
    setStatus('Envio ainda não configurado: falta instalar o Apps Script (ver instruções).', 'error');
    return;
  }
  if (!state.pdfBytes) return;
  const btn = document.getElementById('send');
  btn.disabled = true;
  setStatus('Enviando...', '');
  try {
    let binary = '';
    state.pdfBytes.forEach((b) => { binary += String.fromCharCode(b); });
    const monthLabel = `${MONTH_NAMES[state.month - 1]} 2026`;
    const res = await fetch(CONFIG.scriptUrl, {
      method: 'POST',
      body: JSON.stringify({
        pdfBase64: btoa(binary),
        filename: `folha-${MONTH_NAMES[state.month - 1].toLowerCase()}-2026-demo.pdf`,
        subject: `[TESTE] Folha de ponto ${monthLabel} - ${state.preceptor.name}`,
        body: `Envio de teste do sistema HFC.\n\nPreceptor: ${state.preceptor.name}\nMês: ${monthLabel}\nTotal: ${totalHours(state.days)} h`,
      }),
    });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'unknown');
    setStatus('E-mail enviado com sucesso! Confira sua caixa de entrada.', 'ok');
  } catch (err) {
    setStatus(`Falha no envio: ${err.message}. Use o botão Baixar PDF e envie manualmente.`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function rebuild() {
  state.preceptor = DEMO_PRECEPTORS[+document.getElementById('preceptor').value];
  state.month = +document.getElementById('month').value;
  const monthDays = buildMonth(state.calendar, 2026, state.month);
  state.days = applyPattern(monthDays, state.preceptor.pattern);
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
    cb.onchange = () => { state.days[i].selected = cb.checked; updateTotal(); };
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
    const firstName = state.preceptor.name.split(' ')[2] || 'Demo';
    const images = {
      rubrica: await handwritingPng(firstName.slice(0, 6), { size: 54 }),
      signature: await handwritingPng(state.preceptor.name.replace(/^Dra?\.\s*/, ''), { width: 420, size: 40 }),
      stampPreceptor: await stampPng([state.preceptor.name, state.preceptor.especialidade, 'CRM-SP 000000']),
      coordSignature: await handwritingPng('Coordenador Demo', { width: 420, size: 40 }),
      coordStamp: await stampPng(['Coordenador de Exemplo', 'Pediatra', 'CRM-SP 000000']),
    };
    const pdfBytes = await generateSheetPdf({
      preceptor: state.preceptor,
      monthName: MONTH_NAMES[state.month - 1],
      year: 2026,
      days: state.days,
      images,
    });
    state.pdfBytes = pdfBytes;
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    // single sheet per preceptor: hide the viewer's thumbnail pane and toolbar
    document.getElementById('preview').src = `${url}#toolbar=0&navpanes=0&view=FitH`;
    const dl = document.getElementById('download');
    dl.href = url;
    dl.download = `folha-${MONTH_NAMES[state.month - 1].toLowerCase()}-2026-demo.pdf`;
    dl.style.display = 'inline-block';
    document.getElementById('send').style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gerar folha (preview)';
  }
}

init();
