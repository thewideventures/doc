// Subscription checkout + activation (doctor / clinic plans), recorded in the GST ledger.
import crypto from 'crypto';
import { Doctor, Clinic, PaymentOrder, LedgerTransaction } from '../models/index.js';
import { getPlans, effectivePlan } from './plans.js';
import { getSettings } from './settings.js';
import { recordLedgerTransaction } from './gst.js';
import { getPaymentProvider, paymentsNotConfigured } from './payments/index.js';
import { paymentClientPayload, httpError } from './bookings.js';
import { notify } from './notify.js';

const rid = p => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

export async function startCheckout({ audience, entity, planCode }) {
  const plans = await getPlans();
  const plan = plans.find(p => p.audience === audience && p.code === planCode);
  if (!plan || !plan.isActive) throw httpError(400, 'This plan is not available');
  const current = await effectivePlan(entity, audience);
  if (plan.price <= 0 || plan.code === 'basic') {
    // Switching to the free plan: takes effect immediately, no payment.
    if (current.code === 'basic') throw httpError(400, 'You are already on the Basic plan');
    entity.subscription = { planCode: 'basic', planName: plan.name, startedAt: new Date(), expiresAt: null, source: 'downgrade', lastOrderId: '' };
    entity.isPremium = false;
    await entity.save();
    return { activated: true, entity, plan };
  }
  const provider = getPaymentProvider();
  if (!provider) throw paymentsNotConfigured();
  const order = new PaymentOrder({
    id: rid('pay'), purpose: 'subscription', refId: plan.id, partyType: audience, partyId: entity.id,
    amount: plan.price, provider: provider.name,
    meta: { planCode: plan.code, planName: plan.name, durationDays: plan.durationDays, audience, partyName: entity.name, kind: current.code === plan.code ? 'renewal' : current.tier < plan.tier ? 'upgrade' : 'change', price: plan.price }
  });
  // price comes from the plan record on the server, never from the client
  const po = await provider.createOrder({ amount: plan.price, receipt: order.id, notes: { type: 'subscription', plan: plan.code, party: audience, partyId: entity.id, orderId: order.id } });
  order.providerOrderId = po.providerOrderId;
  await order.save();
  return {
    activated: false, plan,
    payment: paymentClientPayload(order, { description: `${plan.name} plan (${plan.durationDays} days)`, prefill: { name: entity.name, contact: entity.phone } })
  };
}

/** Activate a paid plan after payment verification. Renewing the same plan extends from the current expiry. */
export async function activateSubscription(order, { paymentId }) {
  // caller (lib/payments/apply.js) has atomically claimed the order, so this runs once per verified payment
  const audience = order.partyType;
  const Model = audience === 'doctor' ? Doctor : Clinic;
  const entity = await Model.findOne({ id: order.partyId });
  if (!entity) throw httpError(404, 'Account not found');
  const plans = await getPlans();
  const plan = plans.find(p => p.id === order.refId);
  if (!plan) throw httpError(400, 'Plan no longer exists');
  const settings = await getSettings();
  const current = await effectivePlan(entity, audience);
  const now = new Date();
  const base = current.code === plan.code && current.expiresAt && new Date(current.expiresAt) > now ? new Date(current.expiresAt) : now;
  const expiresAt = plan.durationDays > 0 ? new Date(base.getTime() + plan.durationDays * 86400000) : null;

  const txn = await LedgerTransaction.findOne({ paymentOrderId: order.id, type: 'subscription' }) || await recordLedgerTransaction({
    type: 'subscription', category: audience === 'doctor' ? 'doctor_subscription' : 'clinic_subscription',
    partyType: audience, partyId: entity.id, partyName: entity.name, partyPhone: entity.phone,
    partyGstin: entity.gstin, partyStateCode: entity.stateCode,
    amount: order.amount, plan: plan.code, paymentOrderId: order.id, paymentReference: paymentId,
    paymentMethod: order.paymentMethod ? `online:${order.paymentMethod}` : 'online',
    razorpayOrderId: order.provider === 'razorpay' ? order.providerOrderId : '', razorpayPaymentId: order.provider === 'razorpay' ? paymentId : '',
    description: `${audience === 'doctor' ? 'Doctor' : 'Clinic'} ${plan.name} plan — ${plan.durationDays} days (till ${expiresAt ? expiresAt.toISOString().slice(0, 10) : 'no expiry'})`
  }, settings);

  order.status = 'paid';
  order.providerPaymentId = paymentId;
  order.paidAt = order.paidAt || now;
  order.ledgerInvoiceNumber = txn.invoiceNumber;
  await order.save();

  entity.subscription = { planCode: plan.code, planName: plan.name, startedAt: now, expiresAt, source: 'purchase', lastOrderId: order.id };
  entity.isPremium = plan.tier > 0;
  await entity.save();
  await notify({ type: audience, id: entity.id }, {
    type: 'subscription', title: `${plan.name} plan activated`,
    body: `Invoice ${txn.invoiceNumber} • ₹${order.amount} (incl. GST). Valid till ${expiresAt ? expiresAt.toISOString().slice(0, 10) : '—'}.`,
    data: { invoiceNumber: txn.invoiceNumber }
  });
  return { entity, plan, invoice: txn };
}

/** Hourly sweep: mark expired paid plans (isPremium off) and notify once. */
export async function sweepExpiredSubscriptions() {
  const now = new Date();
  for (const [Model, audience] of [[Doctor, 'doctor'], [Clinic, 'clinic']]) {
    const expired = await Model.find({ 'subscription.planCode': { $in: ['pro', 'premium'] }, 'subscription.expiresAt': { $lt: now }, isPremium: true }).select('id name subscription').lean();
    for (const e of expired) {
      await Model.updateOne({ id: e.id }, { isPremium: false });
      await notify({ type: audience, id: e.id }, { type: 'subscription', title: 'Your plan has expired', body: `Your ${e.subscription.planName} plan expired. You are now on Basic — renew to restore your plan features.` });
    }
  }
}
