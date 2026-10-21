import React, { useEffect, useState } from 'react';
import { Save, Receipt, ShieldAlert, FlaskConical } from 'lucide-react';
import { Card, PageHeader, ErrorNote, useToast } from '../ui';

export default function Settings({ api }) {
  const [s, setS] = useState(null);
  const [meta, setMeta] = useState({ states: {}, defaultBadWords: [], effectiveBadWordCount: 0 });
  const [extra, setExtra] = useState('');
  const [disabled, setDisabled] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const toast = useToast();

  const load = () => api.get('/settings').then(d => {
    setS(d.settings); setMeta(d);
    setExtra((d.settings.extraBadWords || []).join('\n'));
    setDisabled((d.settings.disabledBadWords || []).join('\n'));
  }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const set = (k, v) => setS(p => ({ ...p, [k]: v }));
  const saveGst = async e => {
    e.preventDefault(); setSaving(true);
    try {
      const r = await api.put('/settings', {
        businessName: s.businessName, businessGstin: s.businessGstin, businessStateCode: s.businessStateCode,
        gstRate: Number(s.gstRate), sacCode: s.sacCode, subscriptionSacCode: s.subscriptionSacCode, bookingFeeSacCode: s.bookingFeeSacCode,
        invoicePrefix: s.invoicePrefix, pricesInclusiveOfGst: s.pricesInclusiveOfGst, bookingPlatformFee: Number(s.bookingPlatformFee)
      });
      setS(r.settings); toast.success('GST settings saved');
    } catch (e2) { toast.error(e2.message); } finally { setSaving(false); }
  };
  const saveWords = async () => {
    setSaving(true);
    try {
      const r = await api.put('/settings', { extraBadWords: extra, disabledBadWords: disabled });
      setS(r.settings); setMeta(m => ({ ...m, effectiveBadWordCount: r.effectiveBadWordCount }));
      toast.success(`Word list saved. ${r.rescan ? `Re-scanned ${r.rescan.scanned} reviews: ${r.rescan.newlyFlagged} newly flagged, ${r.rescan.unflagged} restored.` : ''}`);
    } catch (e2) { toast.error(e2.message); } finally { setSaving(false); }
  };
  const test = () => api.post('/moderation/test', { text: testText }).then(setTestResult).catch(e => toast.error(e.message));

  if (!s) return <div><PageHeader title="Settings" /><ErrorNote error={err} />{!err && <p className="adm-muted">Loading…</p>}</div>;
  return (
    <div>
      <PageHeader title="Settings" subtitle="GST configuration and review moderation word list." />
      <div className="adm-grid-2">
        <Card title={<><Receipt size={16} style={{ verticalAlign: '-3px' }} /> GST & invoicing</>}>
          <form onSubmit={saveGst} className="adm-form">
            <label className="adm-field"><span>Business / legal name</span><input value={s.businessName || ''} onChange={e => set('businessName', e.target.value)} /></label>
            <label className="adm-field"><span>Business GSTIN</span><input value={s.businessGstin || ''} onChange={e => set('businessGstin', e.target.value.toUpperCase())} placeholder="e.g. 32ABCDE1234F1Z5" maxLength={15} /></label>
            <label className="adm-field"><span>Business state (place of supply origin)</span>
              <select value={s.businessStateCode || ''} onChange={e => set('businessStateCode', e.target.value)}>
                <option value="">Select…</option>
                {Object.entries(meta.states).map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
              </select>
              <small className="adm-muted">Same state as the customer → CGST + SGST; different state → IGST. Customers with unknown state are treated as intra-state.</small>
            </label>
            <div className="adm-form-row">
              <label className="adm-field"><span>GST rate (%)</span><input type="number" min="0" max="28" step="0.01" value={s.gstRate} onChange={e => set('gstRate', e.target.value)} /></label>
              <label className="adm-field"><span>Invoice prefix</span><input value={s.invoicePrefix || ''} onChange={e => set('invoicePrefix', e.target.value)} maxLength={4} /></label>
            </div>
            <div className="adm-form-row">
              <label className="adm-field"><span>Default SAC</span><input value={s.sacCode || ''} onChange={e => set('sacCode', e.target.value)} /></label>
              <label className="adm-field"><span>Subscription SAC</span><input value={s.subscriptionSacCode || ''} onChange={e => set('subscriptionSacCode', e.target.value)} placeholder="(default)" /></label>
              <label className="adm-field"><span>Booking fee SAC</span><input value={s.bookingFeeSacCode || ''} onChange={e => set('bookingFeeSacCode', e.target.value)} placeholder="(default)" /></label>
            </div>
            <div className="adm-form-row">
              <label className="adm-field"><span>Booking platform fee (₹)</span><input type="number" min="0" value={s.bookingPlatformFee ?? 49} onChange={e => set('bookingPlatformFee', e.target.value)} /></label>
              <label className="adm-check"><input type="checkbox" checked={s.pricesInclusiveOfGst !== false} onChange={e => set('pricesInclusiveOfGst', e.target.checked)} /> Listed prices include GST</label>
            </div>
            <p className="adm-muted adm-small">Invoice numbers are sequential per financial year: <code>{(s.invoicePrefix || 'FAD')}/26-27/000001</code>. Changes apply to new transactions only.</p>
            <button className="btn-primary adm-btn" disabled={saving}><Save size={15} /> Save GST settings</button>
          </form>
        </Card>

        <Card title={<><ShieldAlert size={16} style={{ verticalAlign: '-3px' }} /> Review bad-word filter</>}>
          <p className="adm-muted adm-small">Built-in list: <strong>{meta.defaultBadWords.length}</strong> English, Hindi & Malayalam (transliterated) terms in <code>server/config/profanity.js</code>. Active terms now: <strong>{meta.effectiveBadWordCount}</strong>. <button type="button" className="adm-link" onClick={() => setShowDefaults(v => !v)}>{showDefaults ? 'Hide' : 'Show'} built-in list</button></p>
          {showDefaults && <div className="adm-wordcloud">{meta.defaultBadWords.map(w => <span key={w}>{w}</span>)}</div>}
          <div className="adm-form-row">
            <label className="adm-field"><span>Extra words / phrases (one per line)</span><textarea rows={7} value={extra} onChange={e => setExtra(e.target.value)} placeholder={'e.g.\nquack\nfraud doctor'} /></label>
            <label className="adm-field"><span>Disable built-in words (one per line)</span><textarea rows={7} value={disabled} onChange={e => setDisabled(e.target.value)} placeholder="e.g. idiot" /></label>
          </div>
          <button className="btn-primary adm-btn" onClick={saveWords} disabled={saving}><Save size={15} /> Save word list & re-scan reviews</button>
          <div className="adm-test-box">
            <label className="adm-field"><span><FlaskConical size={13} /> Test a sentence</span>
              <div style={{ display: 'flex', gap: 8 }}><input value={testText} onChange={e => setTestText(e.target.value)} placeholder="Type a sample review…" onKeyDown={e => e.key === 'Enter' && test()} /><button type="button" className="btn-secondary adm-btn" onClick={test}>Test</button></div>
            </label>
            {testResult && <div className={`adm-alert ${testResult.isFlagged ? 'adm-alert-error' : 'adm-alert-success'}`}>{testResult.isFlagged ? `Would be flagged: ${testResult.badWordsFound.join(', ')}` : 'Clean — would be published'}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
