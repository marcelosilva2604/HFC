/* Admin page: registers preceptors (encrypting their bundle in the browser)
 * and stores the coordinator's signature/stamp. */

const WEEKDAYS = [
  ['mon', 'Segunda'], ['tue', 'Terça'], ['wed', 'Quarta'],
  ['thu', 'Quinta'], ['fri', 'Sexta'], ['sat', 'Sábado'], ['sun', 'Domingo'],
];

function buildPatternTable() {
  const table = document.getElementById('pattern');
  table.innerHTML = `
    <tr><th rowspan="2">Dia</th><th colspan="3">1º Expediente</th><th colspan="3">2º Expediente</th></tr>
    <tr><th>Entrada</th><th>Saída</th><th>Local</th><th>Entrada</th><th>Saída</th><th>Local</th></tr>`;
  for (const [key, label] of WEEKDAYS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label}</td>` +
      ['e1in', 'e1out', 'e1loc', 'e2in', 'e2out', 'e2loc'].map((f) => {
        const isLocal = f.endsWith('loc');
        return `<td><input id="${key}-${f}" class="${isLocal ? 'local' : ''}" ` +
          `type="${isLocal ? 'text' : 'number'}" ${isLocal ? '' : 'min="0" max="23"'}></td>`;
      }).join('');
    table.appendChild(tr);
  }
}

function readPattern() {
  const pattern = {};
  for (const [key] of WEEKDAYS) {
    const val = (f) => document.getElementById(`${key}-${f}`).value.trim();
    const day = {};
    if (val('e1in') !== '' && val('e1out') !== '') {
      day.exp1 = { in: +val('e1in'), out: +val('e1out') };
      if (val('e1loc')) day.exp1.local = val('e1loc');
    }
    if (val('e2in') !== '' && val('e2out') !== '') {
      day.exp2 = { in: +val('e2in'), out: +val('e2out') };
      if (val('e2loc')) day.exp2.local = val('e2loc');
    }
    if (day.exp1 || day.exp2) pattern[key] = day;
  }
  return pattern;
}

function fileToB64(input) {
  const file = input.files[0];
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function slugify(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function setStatus(id, msg, kind) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = kind || '';
}

function readStampLines(prefix) {
  return ['1', '2', '3', '4']
    .map((n) => (document.getElementById(`${prefix}Stamp${n}`) || { value: '' }).value.trim())
    .filter(Boolean);
}

function adminToken() {
  return document.getElementById('adminToken').value.trim();
}

async function refreshList() {
  try {
    const out = await api({ action: 'adminList', adminToken: adminToken() });
    const ul = document.getElementById('registered');
    ul.innerHTML = '';
    if (!out.preceptors.length) {
      ul.innerHTML = '<li>Nenhum preceptor cadastrado ainda.</li>';
      return;
    }
    for (const p of out.preceptors) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `${p.name} (${p.id})`;
      li.appendChild(span);
      const btn = document.createElement('button');
      btn.className = 'small';
      btn.textContent = 'Remover';
      btn.onclick = async () => {
        if (!confirm(`Remover ${p.name}?`)) return;
        await api({ action: 'remove', adminToken: adminToken(), preceptorId: p.id });
        refreshList();
      };
      li.appendChild(btn);
      ul.appendChild(li);
    }
  } catch (err) {
    document.getElementById('registered').innerHTML = `<li class="error">${err.message}</li>`;
  }
}

async function savePreceptor() {
  const btn = document.getElementById('save');
  btn.disabled = true;
  setStatus('status', 'Cadastrando...', '');
  try {
    const name = document.getElementById('pName').value.trim();
    const esp = document.getElementById('pEsp').value.trim();
    const password = document.getElementById('pSenha').value;
    if (!name || !esp || !password) throw new Error('Preencha nome, especialidade e senha');
    const pattern = readPattern();
    if (!Object.keys(pattern).length) throw new Error('Preencha o padrão semanal');
    const rubrica = await fileToB64(document.getElementById('pRubrica'));
    const signature = await fileToB64(document.getElementById('pAssinatura'));
    if (!rubrica || !signature) throw new Error('Rubrica e assinatura são obrigatórias');
    const stampLines = readStampLines('p');
    if (!stampLines.length) throw new Error('Preencha ao menos uma linha do carimbo');

    const salt = newSalt();
    const { authKey, encKey } = await deriveKeys(password, salt);
    const bundle = await encryptBundle(encKey, {
      name, especialidade: esp,
      email: document.getElementById('pEmail').value.trim(),
      pattern,
      images: { rubrica, signature },
      stampLines,
    });
    await api({
      action: 'register',
      adminToken: adminToken(),
      preceptorId: slugify(name),
      name, salt, authKey, bundle,
    });
    setStatus('status', `Cadastrado! Entregue a senha ao preceptor: ${password}`, 'ok');
    refreshList();
  } catch (err) {
    setStatus('status', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function saveCoordinator() {
  const btn = document.getElementById('saveCoord');
  btn.disabled = true;
  setStatus('coordStatus', 'Salvando...', '');
  try {
    const signature = await fileToB64(document.getElementById('cAssinatura'));
    if (!signature) throw new Error('Envie a assinatura');
    const stampLines = readStampLines('c');
    if (!stampLines.length) throw new Error('Preencha ao menos uma linha do carimbo');
    await api({
      action: 'setCoordinator',
      adminToken: adminToken(),
      coordinator: { images: { signature }, stampLines },
    });
    setStatus('coordStatus', 'Coordenador salvo!', 'ok');
  } catch (err) {
    setStatus('coordStatus', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

buildPatternTable();
document.getElementById('adminToken').value = localStorage.getItem('hfc_admin_token') || '';
document.getElementById('adminToken').addEventListener('change', () =>
  localStorage.setItem('hfc_admin_token', adminToken()));
document.getElementById('refresh').onclick = refreshList;
document.getElementById('save').onclick = savePreceptor;
document.getElementById('saveCoord').onclick = saveCoordinator;
if (adminToken()) refreshList();
