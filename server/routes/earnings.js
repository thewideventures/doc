// Earnings / analytics / invoices for the doctor and clinic portals (same handlers, scoped to the signed-in entity).
import { LedgerTransaction } from '../models/index.js';
import { earningsSummary, statementRows, invoicesFor, parseRange } from '../lib/earnings.js';
import { invoicePdf, statementPdf, sendPdf } from '../lib/pdf.js';
import { getSettings } from '../lib/settings.js';
import { validate, z, zId } from '../lib/validate.js';
import { rateLimit, userKey } from '../lib/rateLimit.js';
import { httpError } from '../lib/bookings.js';
import { wrap } from './common.js';

const rangeQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const pdfLimit = rateLimit({ name: 'pdf', windowMs: 60 * 60 * 1000, max: 60, key: userKey, message: 'Too many downloads. Please try again later.' });

/** resolve(req) -> { type: 'doctor'|'clinic', entity } (entity = the signed-in doctor / clinic document) */
export function mountEarnings(router, resolve) {
  router.get('/earnings', validate({ query: rangeQuery }), wrap(async (req, res) => {
    const { type, entity } = await resolve(req);
    res.json({ success: true, ...(await earningsSummary(type, entity, parseRange(req.query))) });
  }));
  router.get('/earnings/statement.pdf', pdfLimit, validate({ query: rangeQuery }), wrap(async (req, res) => {
    const { type, entity } = await resolve(req);
    const range = parseRange(req.query);
    const s = await earningsSummary(type, entity, range);
    const rows = await statementRows(type, entity, range);
    const buf = await statementPdf({
      entityName: entity.name, entityType: type, from: range.from, to: range.to, rows, payouts: s.payouts.list,
      summary: { completed: s.bookings.completed, noShow: s.bookings.noShow, noShowRate: s.noShowRate, onlineCollected: s.revenue.onlineCollected, atClinic: s.revenue.atClinic, refunded: s.revenue.refunded, net: s.revenue.net, paidOut: s.payouts.paidOut, balance: s.payouts.balance.available }
    });
    sendPdf(res, buf, `statement-${range.from}-to-${range.to}.pdf`);
  }));
  router.get('/invoices', wrap(async (req, res) => {
    const { type, entity } = await resolve(req);
    res.json({ success: true, invoices: await invoicesFor(type, entity) });
  }));
  router.get('/invoices/:id/pdf', pdfLimit, validate({ params: z.object({ id: zId }) }), wrap(async (req, res) => {
    const { type, entity } = await resolve(req);
    const t = await LedgerTransaction.findOne({ id: req.params.id, partyType: type, partyId: entity.id }).lean(); // ownership check
    if (!t) throw httpError(404, 'Invoice not found');
    sendPdf(res, await invoicePdf(t, await getSettings()), `${t.invoiceNumber.replace(/\//g, '-')}.pdf`);
  }));
}
