/* PDF generator that mimics the official "Registro de Frequência – Preceptor"
 * form of the Prefeitura de Piracicaba. Layout metrics were extracted from the
 * official monthly .xlsx templates (column widths, row heights, fonts). */

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait, points
const MARGIN = { left: 30, right: 18, top: 26 };

/* Excel column widths (chars) converted to px (7*w+5), for the 11 visible
 * table columns: Dia, Hora, Rubrica, Hora, Rubrica, Local,
 * Hora, Rubrica, Hora, Rubrica, Local. */
const COL_PX = [38, 52, 79, 52, 84, 91, 51, 81, 52, 79, 108];

const GRAY = { r: 0.62, g: 0.62, b: 0.62 };
const LIGHT_LINE = 0.6;

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/* images: { rubrica, signature, stampPreceptor, coordSignature, coordStamp }
 * each as Uint8Array (PNG) or null. */
async function generateSheetPdf({ preceptor, monthName, year, days, images }) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);

  const times = await doc.embedFont(StandardFonts.TimesRomanBold);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const logoCoreme = await doc.embedJpg(await fetchBytes('assets/image1.jpg'));
  const logoPira = await doc.embedPng(await fetchBytes('assets/logo-pira.png'));

  const embed = async (bytes) => (bytes ? doc.embedPng(bytes) : null);
  const imgRubrica = await embed(images.rubrica);
  const imgSignature = await embed(images.signature);
  const imgStamp = await embed(images.stampPreceptor);
  const imgCoordSig = await embed(images.coordSignature);
  const imgCoordStamp = await embed(images.coordStamp);

  const black = rgb(0, 0, 0);
  const gray = rgb(GRAY.r, GRAY.g, GRAY.b);

  const contentW = PAGE.width - MARGIN.left - MARGIN.right;
  const scale = contentW / COL_PX.reduce((a, b) => a + b, 0);
  const colW = COL_PX.map((w) => w * scale);
  const colX = [MARGIN.left];
  for (const w of colW) colX.push(colX[colX.length - 1] + w);
  const tableRight = colX[colX.length - 1];

  // y grows downward in this helper coordinate system
  let y = MARGIN.top;
  const toPdfY = (yy) => PAGE.height - yy;

  const line = (x1, y1, x2, y2, w = LIGHT_LINE) =>
    page.drawLine({ start: { x: x1, y: toPdfY(y1) }, end: { x: x2, y: toPdfY(y2) }, thickness: w, color: black });

  const rect = (x, yy, w, h, opts = {}) =>
    page.drawRectangle({
      x, y: toPdfY(yy + h), width: w, height: h,
      borderColor: black, borderWidth: opts.border === false ? 0 : LIGHT_LINE,
      color: opts.fill || undefined,
    });

  const text = (str, x, yy, opts = {}) => {
    const font = opts.font || helv;
    const size = opts.size || 8;
    let tx = x;
    if (opts.center) tx = x - font.widthOfTextAtSize(str, size) / 2;
    page.drawText(str, { x: tx, y: toPdfY(yy), size, font, color: black });
  };

  const centerInCol = (str, col, yy, opts = {}) =>
    text(str, colX[col] + colW[col] / 2, yy, { ...opts, center: true });

  /* ---------- Header ---------- */
  const headerTop = y;
  y += 6;
  const cx = MARGIN.left + contentW / 2;
  text('Prefeitura do Município de Piracicaba', cx, y + 14, { font: times, size: 17, center: true });
  text('Secretaria Municipal de Saúde', cx, y + 30, { font: times, size: 13, center: true });
  text('Estado de São Paulo - BRASIL', cx, y + 41, { font: times, size: 8.5, center: true });
  text('Registro de Frequência – Preceptor', cx, y + 58, { font: helvBold, size: 15, center: true });

  // logos
  const cw = 118; const ch = cw * (logoCoreme.height / logoCoreme.width);
  page.drawImage(logoCoreme, { x: MARGIN.left + 6, y: toPdfY(y + 12 + ch), width: cw, height: ch });
  const pw = 86; const ph = pw * (logoPira.height / logoPira.width);
  page.drawImage(logoPira, { x: tableRight - pw - 8, y: toPdfY(y + 8 + ph), width: pw, height: ph });

  y += 66;
  rect(MARGIN.left, headerTop, contentW, y - headerTop);

  /* ---------- Nome / Especialidade / Mês ---------- */
  const nameRowH = 15;
  rect(MARGIN.left, y, 55, nameRowH);
  text('Nome:', MARGIN.left + 3, y + 10.5, { size: 8 });
  rect(MARGIN.left + 55, y, contentW - 55, nameRowH);
  text(preceptor.name, MARGIN.left + 55 + (contentW - 55) / 2, y + 10.5, { size: 9, center: true });
  y += nameRowH + 3;

  const espRowH = 17;
  const mesW = colW[9] + colW[10];
  rect(MARGIN.left, y, 75, espRowH);
  text('Especialidade:', MARGIN.left + 3, y + 11.5, { size: 8 });
  rect(MARGIN.left + 75, y, contentW - 75 - mesW, espRowH);
  text(preceptor.especialidade, MARGIN.left + 75 + (contentW - 75 - mesW) / 2, y + 11.5, { size: 9, center: true, font: helvBold });
  rect(tableRight - mesW, y, mesW, espRowH);
  text('Mês / Ano', tableRight - mesW / 2, y + 7.5, { size: 7.5, center: true, font: helvBold });
  text(`${monthName.toLowerCase()} ${year}`, tableRight - mesW / 2, y + 15, { size: 7.5, center: true, font: helvBold });
  y += espRowH + 2;

  /* ---------- Table header (3 rows) ---------- */
  const h1 = 13, h2 = 11, h3 = 11;
  const headTop = y;

  // Dia column spans all 3 header rows
  rect(MARGIN.left, y, colW[0], h1 + h2 + h3);
  text('Dia', colX[0] + colW[0] / 2, y + (h1 + h2 + h3) / 2 + 3, { font: helvBold, size: 9, center: true });

  // Expediente group headers
  const exp1X = colX[1], exp1W = colW[1] + colW[2] + colW[3] + colW[4] + colW[5];
  const exp2X = colX[6], exp2W = colW[6] + colW[7] + colW[8] + colW[9] + colW[10];
  rect(exp1X, y, exp1W, h1);
  text('Primeiro Expediente', exp1X + (exp1W - colW[5]) / 2, y + 9.5, { font: helvBold, size: 9, center: true });
  rect(exp2X, y, exp2W, h1);
  text('Segundo Expediente', exp2X + (exp2W - colW[10]) / 2, y + 9.5, { font: helvBold, size: 9, center: true });
  y += h1;

  // Entrada / Saída / Local
  const pairs = [
    { x: colX[1], w: colW[1] + colW[2], label: 'Entrada' },
    { x: colX[3], w: colW[3] + colW[4], label: 'Saída' },
    { x: colX[5], w: colW[5], label: 'Local', tall: true },
    { x: colX[6], w: colW[6] + colW[7], label: 'Entrada' },
    { x: colX[8], w: colW[8] + colW[9], label: 'Saída' },
    { x: colX[10], w: colW[10], label: 'Local', tall: true },
  ];
  for (const p of pairs) {
    const hh = p.tall ? h2 + h3 : h2;
    rect(p.x, y, p.w, hh);
    text(p.label, p.x + p.w / 2, y + (p.tall ? (h2 + h3) / 2 + 3 : 8), { font: helvBold, size: 8, center: true });
  }
  y += h2;

  // Hora / Rubrica sub-headers
  for (const col of [1, 2, 3, 4, 6, 7, 8, 9]) {
    rect(colX[col], y, colW[col], h3);
    centerInCol(col % 5 === 1 || col === 3 || col === 8 ? 'Hora' : 'Rubrica', col, y + 8, { font: helvBold, size: 7.5 });
  }
  y += h3;

  /* ---------- Month title row ---------- */
  const monthRowH = 12;
  rect(MARGIN.left, y, contentW, monthRowH);
  text(`${monthName} ${year}`, cx, y + 9, { font: helvBold, size: 9.5, center: true });
  y += monthRowH;

  /* ---------- Day rows ---------- */
  const rowH = Math.min(15.6, (700 - y) / days.length);
  const fmtHour = (h) => `${h}`;

  for (const d of days) {
    const isBlocked = d.kind !== 'workday';
    const shaded = d.kind === 'saturday' || d.kind === 'sunday';

    if (shaded) rect(MARGIN.left, y, contentW, rowH, { fill: gray });

    // day number cell
    rect(MARGIN.left, y, colW[0], rowH, { fill: shaded ? gray : undefined });
    centerInCol(String(d.day), 0, y + rowH / 2 + 2.5, { size: 8 });

    if (isBlocked) {
      rect(colX[1], y, tableRight - colX[1], rowH, { fill: shaded ? gray : undefined });
      text(d.label, colX[1] + (tableRight - colX[1]) / 2, y + rowH / 2 + 2.5, { font: helvBold, size: 8, center: true });
    } else {
      for (let col = 1; col <= 10; col++) rect(colX[col], y, colW[col], rowH);
      if (d.selected && d.shifts) {
        const s = d.shifts;
        const rubH = rowH - 1.6;
        const drawRub = (col) => {
          if (!imgRubrica) return;
          const rw = Math.min(colW[col] - 4, rubH * (imgRubrica.width / imgRubrica.height));
          const rh = rw / (imgRubrica.width / imgRubrica.height);
          page.drawImage(imgRubrica, {
            x: colX[col] + (colW[col] - rw) / 2,
            y: toPdfY(y + rowH / 2 + rh / 2),
            width: rw, height: rh,
          });
        };
        if (s.exp1) {
          centerInCol(fmtHour(s.exp1.in), 1, y + rowH / 2 + 2.5, { size: 8 });
          drawRub(2);
          centerInCol(fmtHour(s.exp1.out), 3, y + rowH / 2 + 2.5, { size: 8 });
          drawRub(4);
          if (s.exp1.local) centerInCol(s.exp1.local, 5, y + rowH / 2 + 2.5, { size: 7.5 });
        }
        if (s.exp2) {
          centerInCol(fmtHour(s.exp2.in), 6, y + rowH / 2 + 2.5, { size: 8 });
          drawRub(7);
          centerInCol(fmtHour(s.exp2.out), 8, y + rowH / 2 + 2.5, { size: 8 });
          drawRub(9);
          if (s.exp2.local) centerInCol(s.exp2.local, 10, y + rowH / 2 + 2.5, { size: 7.5 });
        }
      }
    }
    y += rowH;
  }
  line(MARGIN.left, headTop, MARGIN.left, y, 1);
  line(tableRight, headTop, tableRight, y, 1);

  /* ---------- Footer: signatures, stamps, total ---------- */
  y += 22;
  const sigLineW = 200;

  const drawSigBlock = (label, yy, sigImg, stampImg, stampFallback) => {
    text(label, MARGIN.left + 4, yy, { size: 8.5 });
    const lx = MARGIN.left + 118;
    line(lx, yy + 1.5, lx + sigLineW, yy + 1.5, 0.8);
    if (sigImg) {
      const sh = 30; const sw = sh * (sigImg.width / sigImg.height);
      page.drawImage(sigImg, { x: lx + (sigLineW - sw) / 2, y: toPdfY(yy), width: sw, height: sh });
    }
    text('Carimbo:', lx + sigLineW + 14, yy, { size: 8.5 });
    if (stampImg) {
      const th = 34; const tw = th * (stampImg.width / stampImg.height);
      page.drawImage(stampImg, { x: lx + sigLineW + 55, y: toPdfY(yy + 8), width: tw, height: th });
    } else if (stampFallback) {
      stampFallback.forEach((ln, i) => text(ln, lx + sigLineW + 55, yy - 6 + i * 9, { size: 7.5 }));
    }
  };

  drawSigBlock('Assinatura – Preceptor:', y, imgSignature, imgStamp, null);
  y += 34;
  drawSigBlock('Assinatura - Coordenador:', y, imgCoordSig, imgCoordStamp, null);

  // total hours, annotated at the right edge like the handwritten originals
  const total = totalHours(days);
  text(`= ${total} h`, tableRight - 24, y + 2, { font: helvBold, size: 10, center: true });

  return doc.save();
}
