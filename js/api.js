/* Thin client for the Apps Script backend. */

async function api(payload) {
  if (!CONFIG.scriptUrl) throw new Error('Backend não configurado');
  const res = await fetch(CONFIG.scriptUrl, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'Erro desconhecido');
  return out;
}
