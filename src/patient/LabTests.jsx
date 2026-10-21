import React, { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Search, Home, Building2, ShoppingCart, Loader2, Clock, X, CheckCircle2, Info, Download } from 'lucide-react';
import { Card, Tabs, ErrorNote, useToast, useConfirm, Modal } from '../admin/ui';
import { apiFetch, inr, fmtDate } from '../lib/api';
import PaymentSheet from '../components/PaymentSheet';
import { useT } from '../i18n';
import { nextDates } from './SlotPicker';
import { downloadBlob } from './PrescriptionModal';

const STATUS_TONE = { AwaitingPayment: 'amber', Confirmed: 'blue', SampleCollected: 'purple', Processing: 'purple', ReportReady: 'green', Cancelled: 'red', Expired: 'slate' };
const FLOW = ['Confirmed', 'SampleCollected', 'Processing', 'ReportReady'];

function Checkout({ client, user, lab, tests, fee, onClose, onDone }) {
  const t = useT();
  const toast = useToast();
  const canHome = lab.homeCollection && tests.every(x => x.homeCollection);
  const addr = user?.addressDetails || {};
  const [v, setV] = useState({ mode: canHome ? 'home_collection' : 'lab_visit', slotDate: nextDates(2)[1], slotWindow: lab.collectionWindows?.[0] || '', memberId: '', address: { line1: addr.line1 || '', area: addr.area || '', city: addr.city || '', state: addr.state || '', pincode: addr.pincode || '', landmark: addr.landmark || '' } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pay, setPay] = useState(null);
  const subtotal = tests.reduce((s, x) => s + x.price, 0);
  const total = subtotal + (v.mode === 'home_collection' ? fee : 0);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await client.post('/lab-orders', { labId: lab.id, testIds: tests.map(x => x.id), mode: v.mode, slotDate: v.slotDate, slotWindow: v.slotWindow, memberId: v.memberId || undefined, address: v.mode === 'home_collection' ? v.address : undefined });
      setPay(r);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const a = v.address;
  const setA = patch => setV(x => ({ ...x, address: { ...x.address, ...patch } }));
  return (
    <Modal open title={<><ShoppingCart size={16} /> {t('lab.checkout')}</>} onClose={busy ? undefined : onClose} width={560}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary adm-btn" onClick={submit} disabled={busy || (v.mode === 'home_collection' && (!a.line1 || !/^\d{6}$/.test(a.pincode || '')))} data-testid="lab-pay">{busy && <Loader2 size={14} className="adm-spin" />} {t('lab.payAmount', { amount: inr(total) })}</button></>}>
      <ErrorNote error={error} />
      <p className="adm-small"><b>{lab.name}</b>{lab.accreditation ? ` • ${lab.accreditation}` : ''}</p>
      <ul className="fx-lab-cart">{tests.map(x => <li key={x.id}><span>{x.name}</span><b>{inr(x.price)}</b></li>)}</ul>
      {tests.some(x => x.preparation) && <p className="fx-note fx-note-info adm-small"><Info size={13} /> {tests.filter(x => x.preparation).map(x => `${x.name}: ${x.preparation}`).join(' • ')}</p>}
      <div className="fx-chips" role="radiogroup" aria-label={t('lab.mode')}>
        <button type="button" role="radio" aria-checked={v.mode === 'home_collection'} disabled={!canHome} className={`fx-chip ${v.mode === 'home_collection' ? 'on' : ''}`} onClick={() => setV({ ...v, mode: 'home_collection' })}><Home size={13} /> {t('lab.home')} (+{inr(fee)})</button>
        <button type="button" role="radio" aria-checked={v.mode === 'lab_visit'} className={`fx-chip ${v.mode === 'lab_visit' ? 'on' : ''}`} onClick={() => setV({ ...v, mode: 'lab_visit' })}><Building2 size={13} /> {t('lab.visit')}</button>
      </div>
      <div className="fx-grid">
        <label className="adm-field"><span>{t('lab.date')}</span><select value={v.slotDate} onChange={e => setV({ ...v, slotDate: e.target.value })}>{nextDates(8).map(d => <option key={d} value={d}>{fmtDate(d)}</option>)}</select></label>
        {(lab.collectionWindows || []).length > 0 && <label className="adm-field"><span>{t('lab.window')}</span><select value={v.slotWindow} onChange={e => setV({ ...v, slotWindow: e.target.value })}>{lab.collectionWindows.map(w => <option key={w}>{w}</option>)}</select></label>}
        {(user?.familyMembers || []).length > 0 && <label className="adm-field"><span>{t('book.forWhom')}</span><select value={v.memberId} onChange={e => setV({ ...v, memberId: e.target.value })}><option value="">{t('book.myself')}</option>{user.familyMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
      </div>
      {v.mode === 'home_collection' && (
        <div className="fx-grid">
          <label className="adm-field"><span>{t('lab.addr')} *</span><input value={a.line1} onChange={e => setA({ line1: e.target.value })} maxLength={200} /></label>
          <label className="adm-field"><span>{t('lab.area')}</span><input value={a.area} onChange={e => setA({ area: e.target.value })} maxLength={100} /></label>
          <label className="adm-field"><span>{t('lab.city')}</span><input value={a.city} onChange={e => setA({ city: e.target.value })} maxLength={80} /></label>
          <label className="adm-field"><span>{t('lab.pincode')} *</span><input value={a.pincode} inputMode="numeric" maxLength={6} onChange={e => setA({ pincode: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="adm-field"><span>{t('lab.landmark')}</span><input value={a.landmark} onChange={e => setA({ landmark: e.target.value })} maxLength={120} /></label>
        </div>
      )}
      <dl className="fx-breakdown">
        <div><dt>{t('lab.tests')}</dt><dd>{inr(subtotal)}</dd></div>
        {v.mode === 'home_collection' && <div><dt>{t('lab.collectionFee')}</dt><dd>{inr(fee)}</dd></div>}
        <div className="strong"><dt>{t('book.payNow')}</dt><dd>{inr(total)}</dd></div>
      </dl>
      {pay && (
        <PaymentSheet payment={pay.payment} client={client} title={t('lab.payTitle')} description={`${lab.name} • ${fmtDate(pay.labOrder.slotDate)} ${pay.labOrder.slotWindow || ''}`}
          breakdown={[{ label: t('lab.tests'), value: pay.labOrder.subtotal }, ...(pay.labOrder.collectionFee ? [{ label: t('lab.collectionFee'), value: pay.labOrder.collectionFee }] : [])]}
          prefill={{ name: user?.name, phone: user?.phone }}
          onSuccess={() => { setPay(null); toast.success(t('lab.booked')); onDone(); }}
          onCancel={() => { setPay(null); setError(t('lab.payCancelled')); }} />
      )}
    </Modal>
  );
}

function Orders({ client }) {
  const t = useT();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const load = () => client.get('/lab-orders').then(r => setItems(r.items)).catch(e => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = o => confirm({
    title: t('lab.cancelTitle'), danger: true, confirmLabel: t('bk.cancelConfirm'), message: t('lab.cancelRule'),
    onConfirm: async () => { const r = await client.post(`/lab-orders/${o.id}/cancel`, {}); toast.success(r.message); load(); }
  });
  if (error) return <ErrorNote error={error} />;
  if (!items) return <div className="fx-center"><Loader2 className="adm-spin" /></div>;
  if (!items.length) return <div className="fx-empty"><FlaskConical size={34} /><h3>{t('lab.noOrders')}</h3></div>;
  return (
    <div className="fx-booking-list">
      {items.map(o => {
        const step = FLOW.indexOf(o.status);
        return (
          <article key={o.id} className="fx-booking-card" data-testid="lab-order">
            <div className="fx-row fx-between"><span className="fx-token">{o.orderCode}</span><span className={`adm-badge adm-badge-${STATUS_TONE[o.status] || 'slate'}`}>{t(`labst.${o.status}`)}</span></div>
            <h3>{o.labName}</h3>
            <p className="adm-small">{o.tests.map(x => x.name).join(', ')}</p>
            <p className="adm-small"><Clock size={12} /> {fmtDate(o.slotDate)} {o.slotWindow} • {o.mode === 'home_collection' ? t('lab.home') : t('lab.visit')}{o.patientName ? ` • ${o.patientName}` : ''}</p>
            {step >= 0 && (
              <ol className="fx-track" aria-label={t('lab.tracking')}>
                {FLOW.map((s, i) => <li key={s} className={i <= step ? 'done' : ''}><span />{t(`labst.${s}`)}</li>)}
              </ol>
            )}
            <p className="adm-small">{t('lab.total')}: <b>{inr(o.total)}</b>{o.refundAmount > 0 ? ` • ${t('bk.refunded', { amount: inr(o.refundAmount) })}` : ''}</p>
            <div className="fx-row fx-wrap">
              {o.status === 'ReportReady' && (o.reportRecordIds || []).map((rid, i) => (
                <button key={rid} className="btn-secondary adm-btn adm-btn-sm" onClick={() => downloadBlob(client, `/me/records/${rid}/file`, `${o.orderCode}-report-${i + 1}`).catch(e => toast.error(e.message))}><Download size={13} /> {t('lab.report')}{o.reportRecordIds.length > 1 ? ` ${i + 1}` : ''}</button>
              ))}
              {['Confirmed', 'AwaitingPayment'].includes(o.status) && <button className="adm-btn adm-btn-danger-soft adm-btn-sm" onClick={() => cancel(o)}><X size={13} /> {t('common.cancel')}</button>}
            </div>
          </article>
        );
      })}
      {confirmEl}
    </div>
  );
}

/** Lab tests: catalogue → cart (one lab) → lab visit / home collection → Razorpay → tracking → report in health record. */
export default function LabTests({ client, user, signedIn, onRequireLogin }) {
  const t = useT();
  const toast = useToast();
  const [tab, setTab] = useState('book');
  const [labs, setLabs] = useState([]);
  const [fee, setFee] = useState(99);
  const [tests, setTests] = useState(null);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState({ search: '', category: '', labId: '', home: '' });
  const [cart, setCart] = useState([]);
  const [checkout, setCheckout] = useState(false);
  useEffect(() => { apiFetch('/api/labs').then(r => { setLabs(r.labs); setFee(r.homeCollectionFee ?? 99); }).catch(() => {}); }, []);
  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
      apiFetch(`/api/lab-tests?${p}`).then(r => { setTests(r.tests); if (!q.category) setCategories(r.categories); }).catch(() => setTests([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q]);
  const lab = useMemo(() => labs.find(l => l.id === cart[0]?.labId), [labs, cart]);
  const add = x => {
    if (cart.some(c => c.id === x.id)) { setCart(cart.filter(c => c.id !== x.id)); return; }
    if (cart.length && cart[0].labId !== x.labId) { toast.info(t('lab.oneLab')); setCart([x]); return; }
    setCart([...cart, x]);
  };
  return (
    <div>
      <Tabs tabs={[{ value: 'book', label: t('lab.bookTab') }, { value: 'orders', label: t('lab.ordersTab') }]} value={tab} onChange={v => (v === 'orders' && !signedIn ? onRequireLogin() : setTab(v))} />
      {tab === 'orders' ? <Orders client={client} /> : (
        <>
          <div className="fx-filter-row">
            <div className="fx-searchbar fx-grow"><Search size={16} className="fx-search-icon" /><input type="search" value={q.search} onChange={e => setQ({ ...q, search: e.target.value })} placeholder={t('lab.search')} aria-label={t('lab.search')} /></div>
            <select className="fx-pill-select" value={q.category} onChange={e => setQ({ ...q, category: e.target.value })} aria-label={t('lab.category')}><option value="">{t('lab.allCategories')}</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
            <select className="fx-pill-select" value={q.labId} onChange={e => setQ({ ...q, labId: e.target.value })} aria-label={t('lab.lab')}><option value="">{t('lab.allLabs')}</option>{labs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <button type="button" className={`fx-pill ${q.home ? 'on' : ''}`} aria-pressed={Boolean(q.home)} onClick={() => setQ({ ...q, home: q.home ? '' : 'true' })}><Home size={14} /> {t('lab.home')}</button>
          </div>
          {tests === null ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : tests.length === 0 ? <div className="fx-empty"><FlaskConical size={34} /><h3>{t('lab.none')}</h3></div> : (
            <div className="doctors-grid">
              {tests.map(x => {
                const inCart = cart.some(c => c.id === x.id);
                return (
                  <article key={x.id} className={`doc-card fx-lab-card ${inCart ? 'on' : ''}`} data-testid="lab-test">
                    <div className="fx-row fx-between"><h3>{x.name}</h3>{x.code && <span className="adm-badge adm-badge-slate">{x.code}</span>}</div>
                    <p className="fx-doc-meta">{x.labName} • {x.category} • {x.sampleType}</p>
                    {x.preparation && <p className="adm-small"><Info size={12} /> {x.preparation}</p>}
                    <p className="adm-small adm-muted"><Clock size={12} /> {t('lab.tat', { n: x.tatHours })}{x.homeCollection ? ` • ${t('lab.homeAvailable')}` : ''}</p>
                    <div className="fx-doc-foot">
                      <div>{x.mrp > x.price && <small className="adm-muted fx-strike">{inr(x.mrp)}</small>}<strong>{inr(x.price)}</strong></div>
                      <button className={`${inCart ? 'btn-secondary' : 'btn-primary'} adm-btn adm-btn-sm`} onClick={() => add(x)} data-testid="lab-add">{inCart ? <><CheckCircle2 size={13} /> {t('lab.added')}</> : t('lab.add')}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {cart.length > 0 && (
            <div className="fx-cart-bar" role="region" aria-label={t('lab.cart')}>
              <span><ShoppingCart size={15} /> {t('lab.inCart', { n: cart.length })} • <b>{inr(cart.reduce((s, x) => s + x.price, 0))}</b>{lab ? ` • ${lab.name}` : ''}</span>
              <button className="btn-primary adm-btn" onClick={() => (signedIn ? setCheckout(true) : onRequireLogin())} data-testid="lab-checkout">{t('lab.checkout')}</button>
            </div>
          )}
          {checkout && lab && <Checkout client={client} user={user} lab={lab} tests={cart} fee={fee} onClose={() => setCheckout(false)} onDone={() => { setCheckout(false); setCart([]); setTab('orders'); }} />}
          <Card><p className="adm-small adm-muted">{t('lab.note')}</p></Card>
        </>
      )}
    </div>
  );
}
