// Server-side PDFs with pdfkit (pure JS, no headless browser): prescriptions, GST invoices / credit notes,
// earnings statements. Uses the built-in Helvetica font, which covers Latin-1 only: "₹" is printed as "Rs."
// and characters outside Latin-1 (e.g. Malayalam / Devanagari names) are transliterated to "?" — the
// on-screen versions in the app show the full Unicode text.
import PDFDocument from 'pdfkit';
import { STATE_CODES } from './gst.js';

const latin = v => String(v ?? '').replace(/₹/g, 'Rs. ').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
const money = n => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '');

function render(build, meta = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: latin(meta.title || 'FindADoc'), Author: 'FindADoc', Producer: 'FindADoc' } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { build(doc); doc.end(); } catch (e) { reject(e); }
  });
}

const W = 499; // usable width (A4 595 - 2*48)
function rule(doc, y) { doc.moveTo(48, y ?? doc.y).lineTo(48 + W, y ?? doc.y).strokeColor('#cbd5e1').lineWidth(0.7).stroke(); }
function label(doc, k, v) { if (!v) return; doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text(`${latin(k)}: `, { continued: true }).font('Helvetica').fillColor('#0f172a').text(latin(v)); }
function footer(doc, text) { doc.fontSize(7.5).fillColor('#64748b').text(latin(text), 48, 790, { width: W, align: 'center' }); }

// ---------------------------------------------------------------- prescription
export function prescriptionPdf(p) {
  return render(doc => {
    const d = p.doctor || {};
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f766e').text(latin(d.name || 'Doctor'));
    doc.font('Helvetica').fontSize(9.5).fillColor('#334155').text(latin([d.qualifications, (d.specialities || []).join(', ')].filter(Boolean).join(' | ')));
    doc.text(latin(`Reg. No. ${d.registrationNumber || '-'}${d.councilName ? ` | ${d.councilName}` : ''}`));
    if (d.locationName || d.locationAddress) doc.text(latin([d.locationName, d.locationAddress].filter(Boolean).join(', ')));
    doc.moveDown(0.4); rule(doc); doc.moveDown(0.5);
    const y = doc.y;
    doc.fontSize(9.5).fillColor('#0f172a').font('Helvetica-Bold').text('Patient: ', 48, y, { continued: true }).font('Helvetica').text(latin(`${p.patientName || ''}${p.patientAge ? `, ${p.patientAge}` : ''}${p.patientGender ? `, ${p.patientGender}` : ''}`));
    doc.font('Helvetica-Bold').text('Date: ', 380, y, { continued: true }).font('Helvetica').text(latin(p.visitDate || fmtDate(p.createdAt)));
    doc.x = 48; doc.moveDown(0.6);
    const v = p.vitals || {};
    const vit = [v.bp && `BP ${v.bp}`, v.pulse && `Pulse ${v.pulse}`, v.temperature && `Temp ${v.temperature}`, v.spo2 && `SpO2 ${v.spo2}`, v.weight && `Wt ${v.weight}`].filter(Boolean).join('   ');
    if (vit) label(doc, 'Vitals', vit);
    label(doc, 'Complaints', p.complaints);
    label(doc, 'Diagnosis', p.diagnosis);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f766e').text('Rx');
    doc.moveDown(0.2);
    const cols = [{ k: '#', w: 20 }, { k: 'Medicine', w: 160 }, { k: 'Dosage', w: 70 }, { k: 'Frequency', w: 70 }, { k: 'When', w: 80 }, { k: 'Days', w: 40 }];
    let x = 48; const hy = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569');
    for (const c of cols) { doc.text(c.k, x, hy, { width: c.w }); x += c.w + 10; }
    doc.moveDown(0.3); rule(doc); doc.moveDown(0.3);
    doc.font('Helvetica').fillColor('#0f172a');
    (p.medicines || []).forEach((m, i) => {
      if (doc.y > 720) doc.addPage();
      const ry = doc.y; x = 48;
      const vals = [String(i + 1), m.name, m.dosage, m.frequency, m.timing, m.durationDays ? String(m.durationDays) : ''];
      let maxY = ry;
      cols.forEach((c, j) => { doc.text(latin(vals[j]), x, ry, { width: c.w }); maxY = Math.max(maxY, doc.y); x += c.w + 10; });
      doc.x = 48; doc.y = maxY;
      if (m.instructions) doc.fontSize(8.5).fillColor('#475569').text(latin(`   ${m.instructions}`), 78).fontSize(9).fillColor('#0f172a');
      doc.x = 48; doc.moveDown(0.3);
    });
    if (!(p.medicines || []).length) doc.text('No medicines prescribed.');
    doc.moveDown(0.6);
    if (p.tests?.length) label(doc, 'Investigations', p.tests.join(', '));
    label(doc, 'Advice', p.advice);
    label(doc, 'Notes', p.visitNotes);
    if (p.followUp?.date || p.followUp?.afterDays) label(doc, 'Follow-up', `${p.followUp.date || `after ${p.followUp.afterDays} days`}${p.followUp.note ? ` - ${p.followUp.note}` : ''}`);
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(10).text(latin(d.name || ''), 330, doc.y, { width: 217, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).text(latin(`Reg. No. ${d.registrationNumber || '-'}`), { width: 217, align: 'right' });
    footer(doc, `Digital prescription ${p.id} (v${p.version || 1}) generated via FindADoc. Valid with the doctor's registration details above. Not valid for Schedule X / narcotic drugs.`);
  }, { title: `Prescription ${p.id}` });
}

// ---------------------------------------------------------------- GST invoice / credit note
export function invoicePdf(t, settings = {}) {
  return render(doc => {
    const title = t.documentType === 'credit_note' ? 'CREDIT NOTE' : t.documentType === 'refund_voucher' ? 'REFUND VOUCHER' : 'TAX INVOICE';
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f766e').text(latin(settings.businessName || 'FindADoc'));
    doc.font('Helvetica').fontSize(9).fillColor('#334155');
    if (settings.businessGstin) doc.text(latin(`GSTIN: ${settings.businessGstin}`));
    if (settings.businessState) doc.text(latin(`State: ${settings.businessState}${settings.businessStateCode ? ` (${settings.businessStateCode})` : ''}`));
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(title, 48, 52, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(9).text(latin(`No. ${t.invoiceNumber}`), { width: W, align: 'right' }).text(latin(`Date: ${fmtDate(t.txnDate)}`), { width: W, align: 'right' });
    if (t.originalInvoiceNumber) doc.text(latin(`Against invoice ${t.originalInvoiceNumber}`), { width: W, align: 'right' });
    doc.x = 48; doc.y = Math.max(doc.y, 120); doc.moveDown(0.5); rule(doc); doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(10).text('Billed to');
    doc.font('Helvetica').fontSize(9.5).text(latin(t.partyName || '-'));
    if (t.partyGstin) doc.text(latin(`GSTIN: ${t.partyGstin}`));
    doc.text(latin(`Place of supply: ${t.placeOfSupply || (t.partyStateCode ? `${t.partyStateCode}-${STATE_CODES[t.partyStateCode] || ''}` : '-')}`));
    doc.moveDown(0.8);
    const rows = [
      ['Description', latin(t.description || t.category)],
      ['SAC', t.sacCode],
      ['Taxable value', money(t.taxableValue)],
      ...(t.supplyType === 'intra'
        ? [[`CGST @ ${t.cgstRate}%`, money(t.cgst)], [`SGST @ ${t.sgstRate}%`, money(t.sgst)]]
        : [[`IGST @ ${t.igstRate}%`, money(t.igst)]]),
      ['Invoice value', money(t.invoiceValue)],
      ...(t.passThroughAmount ? [['Collected on behalf of provider (not a supply by us)', money(t.passThroughAmount)]] : []),
      ['Total', money(t.totalAmount)]
    ];
    for (const [k, v] of rows) {
      const y = doc.y;
      doc.font(k === 'Total' ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor('#0f172a').text(k, 48, y, { width: 300 });
      doc.text(String(v), 348, y, { width: 199, align: 'right' });
      doc.x = 48; doc.moveDown(0.35);
    }
    doc.moveDown(0.6); rule(doc); doc.moveDown(0.5);
    doc.fontSize(8.5).fillColor('#475569').text(latin(`Payment: ${t.paymentMethod || 'online'}${t.paymentReference ? ` (ref ${t.paymentReference})` : ''}. Status: ${t.status}.`));
    footer(doc, 'This is a computer-generated document and does not require a signature.');
  }, { title: `${t.invoiceNumber}` });
}

// ---------------------------------------------------------------- earnings statement
export function statementPdf({ entityName, entityType, from, to, summary, rows, payouts }) {
  return render(doc => {
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f766e').text('Earnings statement');
    doc.font('Helvetica').fontSize(9.5).fillColor('#334155').text(latin(`${entityName} (${entityType})`)).text(latin(`Period: ${from} to ${to}`)).text(latin(`Generated: ${fmtDate(new Date())}`));
    doc.moveDown(0.5); rule(doc); doc.moveDown(0.5);
    const s = summary || {};
    const kv = [['Completed visits', s.completed], ['No-shows', `${s.noShow} (${s.noShowRate}%)`], ['Collected online (consultation fees)', money(s.onlineCollected)], ['Due / collected at clinic', money(s.atClinic)], ['Refunded to patients', money(s.refunded)], ['Net earnings', money(s.net)], ['Paid out in period', money(s.paidOut)], ['Available balance (now)', money(s.balance)]];
    for (const [k, v] of kv) { const y = doc.y; doc.fontSize(9.5).fillColor('#0f172a').font('Helvetica').text(k, 48, y); doc.text(String(v ?? ''), 348, y, { width: 199, align: 'right' }); doc.x = 48; doc.moveDown(0.3); }
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).text('Bookings');
    doc.moveDown(0.2);
    const cols = [['Date', 62], ['Booking', 70], ['Patient', 120], ['Status', 62], ['Online', 70], ['At clinic', 70]];
    const header = () => { let x = 48; const y = doc.y; doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#475569'); cols.forEach(([k, w]) => { doc.text(k, x, y, { width: w }); x += w + 6; }); doc.x = 48; doc.moveDown(0.3); rule(doc); doc.moveDown(0.2); };
    header();
    doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a');
    for (const r of rows || []) {
      if (doc.y > 750) { doc.addPage(); header(); doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a'); }
      let x = 48; const y = doc.y;
      [r.date, r.code, r.patient, r.status, money(r.online), money(r.atClinic)].forEach((v, i) => { doc.text(latin(v), x, y, { width: cols[i][1], lineBreak: false, ellipsis: true }); x += cols[i][1] + 6; });
      doc.x = 48; doc.moveDown(0.25);
    }
    if (payouts?.length) {
      doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(11).text('Payouts'); doc.font('Helvetica').fontSize(8.5);
      for (const p of payouts) doc.text(latin(`${fmtDate(p.processedAt || p.requestedAt)}  ${p.referenceCode}  ${p.status}  ${money(p.amount)}`));
    }
    footer(doc, 'Statement for information. Consultation fees are collected on behalf of the provider; platform fees are invoiced separately with GST.');
  }, { title: 'Earnings statement' });
}

export function sendPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${String(filename).replace(/[^\w.\-]/g, '_').slice(0, 100)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.end(buffer);
}
