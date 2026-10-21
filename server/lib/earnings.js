// Doctor / clinic earnings & analytics: bookings, revenue, refunds, payouts, no-show rate, ratings, monthly series,
// GST invoices for subscription payments and a downloadable earnings statement.
import { Booking, LedgerTransaction, PayoutRequest, Review, Doctor } from '../models/index.js';
import { round2 } from './gst.js';
import { todayIST, addDays, isDateStr, istInstant } from './time.js';

export function parseRange(q = {}) {
  const today = todayIST();
  let to = isDateStr(q.to) ? q.to : today;
  let from = isDateStr(q.from) ? q.from : addDays(to, -179);
  if (from > to) [from, to] = [to, from];
  if (addDays(from, 400) < to) from = addDays(to, -400);
  return { from, to, fromAt: istInstant(from, '00:00'), toAt: new Date(istInstant(to, '00:00').getTime() + 86400000) };
}

const scope = (type, entity) => (type === 'doctor' ? { doctorId: entity.id } : { clinicId: entity.id });
const payee = (type, entity) => ({ payeeType: type, payeeId: entity.id });

export async function earningsSummary(type, entity, range) {
  const { from, to, fromAt, toAt } = range;
  const bMatch = { ...scope(type, entity), date: { $gte: from, $lte: to } };
  const [statusAgg, monthly, atClinicAgg, ledger, payouts, ratings] = await Promise.all([
    Booking.aggregate([{ $match: bMatch }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $match: bMatch }, { $group: {
      _id: { $substr: ['$date', 0, 7] }, bookings: { $sum: { $cond: [{ $in: ['$status', ['Expired', 'AwaitingPayment']] }, 0, 1] } },
      completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } }, noShow: { $sum: { $cond: [{ $eq: ['$status', 'NoShow'] }, 1, 0] } },
      atClinic: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Completed'] }, { $eq: ['$payeeType', type] }, { $eq: ['$payeeId', entity.id] }] }, '$amountDueAtClinic', 0] } }
    } }, { $sort: { _id: 1 } }]),
    Booking.aggregate([{ $match: { ...bMatch, ...payee(type, entity), status: 'Completed' } }, { $group: { _id: null, v: { $sum: '$amountDueAtClinic' } } }]),
    LedgerTransaction.aggregate([{ $match: { ...payee(type, entity), txnDate: { $gte: fromAt, $lt: toAt }, type: { $in: ['patient_fee', 'refund'] }, status: { $ne: 'failed' } } },
      { $group: { _id: { t: '$type', m: { $dateToString: { format: '%Y-%m', date: '$txnDate', timezone: 'Asia/Kolkata' } } }, pass: { $sum: '$passThroughAmount' } } }]),
    PayoutRequest.find({ entityType: type, entityId: entity.id, requestedAt: { $gte: fromAt, $lt: toAt } }).sort({ requestedAt: -1 }).select('-_id -__v -entityPhone -bankDetails').lean(),
    type === 'doctor'
      ? Review.aggregate([{ $match: { doctorId: entity.id, moderationStatus: 'visible' } }, { $group: { _id: '$rating', n: { $sum: 1 } } }])
      : Review.aggregate([{ $match: { doctorId: { $in: entity.doctorIds || [] }, moderationStatus: 'visible' } }, { $group: { _id: '$rating', n: { $sum: 1 } } }])
  ]);
  const by = Object.fromEntries(statusAgg.map(s => [s._id, s.n]));
  const completed = by.Completed || 0, noShow = by.NoShow || 0;
  const onlineByMonth = {}, refundByMonth = {};
  let online = 0, refunded = 0;
  for (const l of ledger) {
    if (l._id.t === 'patient_fee') { online += l.pass; onlineByMonth[l._id.m] = (onlineByMonth[l._id.m] || 0) + l.pass; }
    else { refunded += -l.pass; refundByMonth[l._id.m] = (refundByMonth[l._id.m] || 0) - l.pass; }
  }
  const atClinic = round2(atClinicAgg[0]?.v || 0);
  const dist = [5, 4, 3, 2, 1].map(r => ({ rating: r, count: ratings.find(x => x._id === r)?.n || 0 }));
  const reviewCount = dist.reduce((s, d) => s + d.count, 0);
  const avgRating = reviewCount ? round2(dist.reduce((s, d) => s + d.rating * d.count, 0) / reviewCount) : 0;
  const months = new Set([...monthly.map(m => m._id), ...Object.keys(onlineByMonth), ...Object.keys(refundByMonth)]);
  const series = [...months].sort().map(m => {
    const row = monthly.find(x => x._id === m) || { bookings: 0, completed: 0, noShow: 0, atClinic: 0 };
    return { month: m, bookings: row.bookings, completed: row.completed, noShow: row.noShow, revenue: round2((onlineByMonth[m] || 0) - (refundByMonth[m] || 0) + row.atClinic) };
  });
  const paidOut = round2(payouts.filter(p => ['Paid', 'Completed'].includes(p.status)).reduce((s, p) => s + p.amount, 0));
  return {
    range: { from, to },
    bookings: { total: Object.entries(by).filter(([k]) => !['Expired', 'AwaitingPayment'].includes(k)).reduce((s, [, n]) => s + n, 0), byStatus: by, completed, noShow, cancelled: by.Cancelled || 0 },
    noShowRate: completed + noShow ? round2((noShow / (completed + noShow)) * 100) : 0,
    revenue: { onlineCollected: round2(online), refunded: round2(refunded), atClinic, net: round2(online - refunded + atClinic) },
    payouts: { list: payouts, paidOut, balance: { available: round2(entity.claimPendingFee || 0), inProcess: round2(entity.payoutPendingFee || 0), paidOutAllTime: round2(entity.claimedFee || 0) } },
    ratings: { average: type === 'doctor' ? (entity.rating || avgRating) : avgRating, count: reviewCount, distribution: dist },
    series
  };
}

export async function statementRows(type, entity, range) {
  const rows = await Booking.find({ ...payee(type, entity), date: { $gte: range.from, $lte: range.to }, status: { $in: ['Confirmed', 'Completed', 'NoShow', 'Cancelled'] } })
    .sort({ date: 1, timeSlot: 1 }).limit(3000).select('date timeSlot bookingCode patientName status amountPaidOnline bookingPremiumFee refundAmount amountDueAtClinic').lean();
  return rows.map(b => ({
    date: b.date, code: b.bookingCode, patient: b.patientName, status: b.status,
    online: round2(Math.max(0, (b.amountPaidOnline || 0) - (b.bookingPremiumFee || 0) - (b.refundAmount || 0))),
    atClinic: b.status === 'Completed' ? b.amountDueAtClinic || 0 : 0
  }));
}

export async function invoicesFor(type, entity) {
  return LedgerTransaction.find({ partyType: type, partyId: entity.id }).sort({ txnDate: -1 }).limit(200)
    .select('id invoiceNumber documentType originalInvoiceNumber txnDate description plan taxableValue cgst sgst igst totalTax invoiceValue totalAmount status').lean();
}

export { Doctor };
