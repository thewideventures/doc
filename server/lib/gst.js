import { Counter, LedgerTransaction } from '../models/index.js';

// GST state codes (as used in GSTIN / GSTR-1 place of supply)
export const STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory'
};

export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function stateCodeFromName(name) {
  if (!name) return '';
  const n = String(name).trim().toLowerCase();
  const hit = Object.entries(STATE_CODES).find(([, v]) => v.toLowerCase() === n);
  return hit ? hit[0] : '';
}

export function stateCodeFromGstin(gstin) {
  const g = String(gstin || '').trim();
  return /^\d{2}/.test(g) ? g.slice(0, 2) : '';
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function isValidGstin(g) {
  return GSTIN_RE.test(String(g || '').trim().toUpperCase());
}

/** Indian financial year label for a date, e.g. 2026-27 */
export function financialYear(date = new Date()) {
  const d = new Date(date);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/**
 * Compute GST split.
 * amount: price; inclusive: whether amount already includes GST.
 * Intra-state (party state == business state, or party state unknown) => CGST+SGST, else IGST.
 */
export function computeGst({ amount, rate, inclusive, partyStateCode, businessStateCode }) {
  const r = Number(rate) || 0;
  const amt = Number(amount) || 0;
  const taxableValue = round2(inclusive ? amt / (1 + r / 100) : amt);
  const totalTax = round2(inclusive ? amt - taxableValue : (taxableValue * r) / 100);
  const pos = partyStateCode || businessStateCode || '';
  const intra = !partyStateCode || !businessStateCode || partyStateCode === businessStateCode;
  let cgst = 0, sgst = 0, igst = 0;
  if (intra) {
    cgst = round2(totalTax / 2);
    sgst = round2(totalTax - cgst);
  } else {
    igst = totalTax;
  }
  return {
    taxableValue,
    gstRate: r,
    supplyType: intra ? 'intra' : 'inter',
    placeOfSupply: pos ? `${pos}-${STATE_CODES[pos] || ''}` : '',
    cgstRate: intra ? r / 2 : 0,
    sgstRate: intra ? r / 2 : 0,
    igstRate: intra ? 0 : r,
    cgst, sgst, igst,
    totalTax,
    invoiceValue: round2(taxableValue + totalTax)
  };
}

/** Atomically allocate the next sequential invoice number for the FY. */
export async function nextInvoiceNumber(prefix = 'FAD', date = new Date(), series = 'invoice') {
  const fy = financialYear(date);
  // Separate sequences: tax invoices ('invoice'), GST credit notes ('credit'), refund vouchers ('refund')
  const key = `${series}:${fy}`;
  const c = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
  const shortFy = `${fy.slice(2, 4)}-${fy.slice(5, 7)}`;
  // GST rules: max 16 chars, unique per FY. e.g. "FAD/26-27/000001" (16 chars)
  const p = String(prefix || 'FAD').replace(/[^A-Za-z0-9-]/g, '').slice(0, 4);
  return { invoiceNumber: `${p}/${shortFy}/${String(c.seq).padStart(6, '0')}`, invoiceSeq: c.seq, financialYear: fy };
}

/**
 * Record a GST ledger transaction.
 * opts: { type, category, partyType, partyId, partyName, partyPhone, partyGstin, partyStateCode,
 *         amount (taxable supply amount; inclusive per settings), passThroughAmount, description, plan, bookingId,
 *         doctorId, sacCode, txnDate, paymentReference }
 */
export async function recordLedgerTransaction(opts, settings) {
  const txnDate = opts.txnDate ? new Date(opts.txnDate) : new Date();
  const businessStateCode = settings.businessStateCode || '';
  const partyStateCode = opts.partyStateCode || stateCodeFromGstin(opts.partyGstin) || '';
  const inclusive = opts.inclusive !== undefined ? opts.inclusive : settings.pricesInclusiveOfGst !== false;
  const gst = computeGst({
    amount: opts.amount,
    rate: opts.gstRate ?? settings.gstRate ?? 18,
    inclusive,
    partyStateCode,
    businessStateCode
  });
  const series = opts.series || 'invoice';
  const prefix = series === 'credit' ? 'CN' : series === 'refund' ? 'RF' : settings.invoicePrefix;
  const inv = await nextInvoiceNumber(prefix, txnDate, series);
  const sac = opts.sacCode
    || (opts.type === 'subscription' ? settings.subscriptionSacCode : settings.bookingFeeSacCode)
    || settings.sacCode || '998399';
  const pass = round2(opts.passThroughAmount || 0);
  const txn = new LedgerTransaction({
    id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...inv,
    type: opts.type,
    category: opts.category,
    partyType: opts.partyType,
    partyId: opts.partyId || '',
    partyName: opts.partyName || '',
    partyPhone: opts.partyPhone || '',
    partyGstin: (opts.partyGstin || '').toUpperCase(),
    partyStateCode,
    partyState: STATE_CODES[partyStateCode] || '',
    description: opts.description || '',
    plan: opts.plan || '',
    bookingId: opts.bookingId || '',
    doctorId: opts.doctorId || '',
    sacCode: sac,
    ...gst,
    passThroughAmount: pass,
    totalAmount: round2(gst.invoiceValue + pass),
    businessStateCode,
    businessGstin: settings.businessGstin || '',
    status: opts.status || 'paid',
    paymentMethod: opts.paymentMethod || 'online',
    paymentReference: opts.paymentReference || '',
    documentType: series === 'credit' ? 'credit_note' : series === 'refund' ? 'refund_voucher' : 'invoice',
    originalInvoiceNumber: opts.originalInvoiceNumber || '',
    bookingMode: opts.bookingMode || '',
    amountDueAtClinic: round2(opts.amountDueAtClinic || 0),
    payeeType: opts.payeeType || '',
    payeeId: opts.payeeId || '',
    paymentOrderId: opts.paymentOrderId || '',
    razorpayOrderId: opts.razorpayOrderId || '',
    razorpayPaymentId: opts.razorpayPaymentId || '',
    razorpayRefundId: opts.razorpayRefundId || '',
    txnDate
  });
  await txn.save();
  return txn;
}

/** Classify a transaction into a GSTR-1 section. */
export function gstr1Section(t) {
  if (t.documentType === 'refund_voucher') return 'NIL'; // pass-through refund only, no GST impact
  if (t.documentType === 'credit_note') return t.partyGstin ? 'CDNR' : 'B2CS'; // B2C small credit notes net off in B2CS
  if (t.partyGstin) return 'B2B';
  // B2C Large: inter-state supply to unregistered person with invoice value > ₹1,00,000 (from Aug 2024)
  if (t.supplyType === 'inter' && t.invoiceValue > 100000) return 'B2CL';
  return 'B2CS';
}
