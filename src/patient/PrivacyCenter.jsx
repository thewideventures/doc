import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Download, Trash2, Loader2, Languages, IdCard, FileText, Scale, MessageSquareWarning, Undo2 } from 'lucide-react';
import { Card, ErrorNote, useToast, Modal } from '../admin/ui';
import { fmtDateLong } from '../lib/api';
import { useT, LanguageSwitcher } from '../i18n';
import { downloadBlob } from './PrescriptionModal';

const TOGGLES = ['health_data', 'whatsapp_reminders', 'sms_reminders', 'marketing'];

function AbhaCard({ client }) {
  const t = useT();
  const toast = useToast();
  const [s, setS] = useState(null);
  const [v, setV] = useState({ id: '', otp: '', txnId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => client.get('/me/abha').then(setS).catch(e => setError(e.message)), [client]);
  useEffect(() => { load(); }, [load]);
  if (!s) return null;
  const init = async e => {
    e.preventDefault(); setBusy(true); setError('');
    const raw = v.id.trim();
    const body = raw.includes('@') ? { abhaAddress: raw } : { abhaNumber: raw.replace(/[\s-]/g, '') };
    try { const r = await client.post('/me/abha/init', body); setV(x => ({ ...x, txnId: r.txnId })); toast.info(r.message); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const confirmOtp = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await client.post('/me/abha/confirm', { txnId: v.txnId, otp: v.otp }); toast.success(t('abha.linked')); setV({ id: '', otp: '', txnId: '' }); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const unlink = async () => { setBusy(true); try { await client.del('/me/abha'); load(); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const a = s.abha || {};
  return (
    <Card title={<><IdCard size={16} /> {t('abha.title')}</>}>
      <p className="adm-small adm-muted">{t('abha.explain')}</p>
      <ErrorNote error={error} />
      {!s.enabled ? <p className="fx-note fx-note-info adm-small" data-testid="abha-disabled">{t('abha.disabled')}</p>
        : a.status === 'linked' ? (
          <div className="fx-row fx-between fx-wrap">
            <span><ShieldCheck size={14} className="fx-ok" /> {t('abha.linkedAs', { id: a.address || a.number })} <small className="adm-muted">({fmtDateLong(a.linkedAt)})</small></span>
            <button className="adm-btn adm-btn-danger-soft adm-btn-sm" onClick={unlink} disabled={busy}>{t('abha.unlink')}</button>
          </div>
        ) : !v.txnId ? (
          <form className="fx-row fx-wrap" onSubmit={init}>
            <input className="adm-input" value={v.id} onChange={e => setV({ ...v, id: e.target.value })} placeholder={t('abha.idPh')} aria-label={t('abha.idPh')} maxLength={60} />
            <button className="btn-primary adm-btn" disabled={busy || v.id.trim().length < 5}>{busy && <Loader2 size={14} className="adm-spin" />} {t('abha.sendOtp')}</button>
          </form>
        ) : (
          <form className="fx-row fx-wrap" onSubmit={confirmOtp}>
            <input className="adm-input" value={v.otp} inputMode="numeric" maxLength={6} onChange={e => setV({ ...v, otp: e.target.value.replace(/\D/g, '') })} placeholder={t('abha.otp')} aria-label={t('abha.otp')} autoComplete="one-time-code" />
            <button className="btn-primary adm-btn" disabled={busy || v.otp.length !== 6}>{t('abha.verify')}</button>
            <button type="button" className="adm-link" onClick={() => setV({ id: v.id, otp: '', txnId: '' })}>{t('common.back')}</button>
          </form>
        )}
      {s.enabled && s.provider === 'mock' && <p className="adm-small adm-muted">{t('abha.mockNote')}</p>}
    </Card>
  );
}

/** DPDP Act: notice, consents (timestamped), data export, deletion request with grace period, ABHA, preferences. */
export default function PrivacyCenter({ client, onUserChange }) {
  const t = useT();
  const toast = useToast();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [del, setDel] = useState(null); // { confirm, reason }
  const load = useCallback(() => client.get('/me/privacy').then(setP).catch(e => setError(e.message)), [client]);
  useEffect(() => { load(); }, [load]);
  if (!p) return error ? <ErrorNote error={error} /> : <div className="fx-center"><Loader2 className="adm-spin" /></div>;

  const setConsent = async (purpose, granted) => {
    setBusy(purpose);
    try { const r = await client.post('/me/consents', { consents: [{ purpose, granted }], method: 'settings' }); setP(x => ({ ...x, consents: r.consents })); onUserChange?.(r.user); toast.success(t('privacy.saved')); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const exportData = async () => {
    setBusy('export');
    try { await downloadBlob(client, '/me/export', `findadoc-my-data-${new Date().toISOString().slice(0, 10)}.json`); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const requestDeletion = async () => {
    setBusy('delete');
    try { const r = await client.post('/me/deletion', { confirm: del.confirm, reason: del.reason || undefined }); toast.success(r.message); setDel(null); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const cancelDeletion = async () => {
    setBusy('undelete');
    try { const r = await client.del('/me/deletion'); toast.success(r.message); load(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const c = p.consents || {};

  return (
    <div className="fx-privacy">
      <Card title={<><Languages size={16} /> {t('privacy.language')}</>}><LanguageSwitcher /></Card>
      <Card title={<><ShieldCheck size={16} /> {t('privacy.consents')}</>}>
        <p className="adm-small adm-muted">{t('privacy.noticeAccepted', { version: p.acceptedVersion || '—', date: p.acceptedAt ? fmtDateLong(p.acceptedAt) : '—' })} <a className="adm-link" href="/privacy">{t('legal.privacy')}</a></p>
        <ul className="fx-consents">
          {TOGGLES.map(k => (
            <li key={k}>
              <label className="fx-switch">
                <input type="checkbox" checked={Boolean(c[k]?.granted)} disabled={busy === k} onChange={e => setConsent(k, e.target.checked)} data-testid={`consent-${k}`} />
                <span><b>{t(`consent.${k}`)}</b><small>{t(`consent.${k}.desc`)}</small>{c[k]?.at && <small className="adm-muted">{t('privacy.lastChanged', { date: fmtDateLong(c[k].at) })}</small>}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>
      <AbhaCard client={client} />
      <Card title={<><Download size={16} /> {t('privacy.export')}</>}>
        <p className="adm-small adm-muted">{t('privacy.exportDesc')}</p>
        <button className="btn-secondary adm-btn" onClick={exportData} disabled={busy === 'export'} data-testid="export-data">{busy === 'export' ? <Loader2 size={14} className="adm-spin" /> : <Download size={14} />} {t('privacy.exportBtn')}</button>
      </Card>
      <Card title={<><Trash2 size={16} /> {t('privacy.delete')}</>}>
        {p.deletion ? (
          <div className="fx-note fx-note-warn" data-testid="deletion-scheduled">
            <p>{t('privacy.deletionScheduled', { date: fmtDateLong(p.deletion.scheduledFor) })}</p>
            <button className="btn-secondary adm-btn adm-btn-sm" onClick={cancelDeletion} disabled={busy === 'undelete'}><Undo2 size={14} /> {t('privacy.cancelDeletion')}</button>
          </div>
        ) : (
          <>
            <p className="adm-small adm-muted">{t('privacy.deleteDesc', { n: p.graceDays })}</p>
            <button className="adm-btn adm-btn-danger-soft" onClick={() => setDel({ confirm: '', reason: '' })} data-testid="delete-account">{t('privacy.deleteBtn')}</button>
          </>
        )}
      </Card>
      <Card>
        <div className="fx-row fx-wrap">
          <a className="adm-link" href="/privacy"><FileText size={13} /> {t('legal.privacy')}</a>
          <a className="adm-link" href="/terms"><Scale size={13} /> {t('legal.terms')}</a>
          <a className="adm-link" href="/grievance"><MessageSquareWarning size={13} /> {t('legal.grievance')}</a>
        </div>
      </Card>
      {del && (
        <Modal open title={t('privacy.deleteBtn')} onClose={() => setDel(null)} width={480}
          footer={<><button className="btn-secondary adm-btn" onClick={() => setDel(null)}>{t('common.cancel')}</button><button className="adm-btn adm-btn-danger" disabled={del.confirm !== 'DELETE' || busy === 'delete'} onClick={requestDeletion} data-testid="delete-confirm">{t('privacy.deleteBtn')}</button></>}>
          <p className="adm-small">{t('privacy.deleteWarn', { n: p.graceDays })}</p>
          <label className="adm-field"><span>{t('privacy.typeDelete')}</span><input value={del.confirm} onChange={e => setDel({ ...del, confirm: e.target.value })} autoComplete="off" data-testid="delete-type" /></label>
          <label className="adm-field"><span>{t('bk.reason')}</span><input value={del.reason} maxLength={300} onChange={e => setDel({ ...del, reason: e.target.value })} /></label>
        </Modal>
      )}
    </div>
  );
}

/** First-run privacy notice (DPDP s.5): must be acknowledged; optional purposes are opt-in. */
export function ConsentGate({ client, onDone }) {
  const t = useT();
  const [v, setV] = useState({ health_data: true, whatsapp_reminders: false, sms_reminders: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accept = async () => {
    setBusy(true); setError('');
    try {
      const r = await client.post('/me/consents', { method: 'onboarding', consents: [{ purpose: 'privacy_notice', granted: true }, ...Object.entries(v).map(([purpose, granted]) => ({ purpose, granted }))] });
      onDone?.(r.user);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal open title={<><ShieldCheck size={16} /> {t('gate.title')}</>} width={560}
      footer={<button className="btn-primary adm-btn fx-grow" onClick={accept} disabled={busy} data-testid="consent-accept">{busy && <Loader2 size={14} className="adm-spin" />} {t('gate.accept')}</button>}>
      <div className="fx-gate" data-testid="consent-gate">
        <p>{t('gate.intro')}</p>
        <ul className="fx-gate-list">
          <li>{t('gate.p1')}</li><li>{t('gate.p2')}</li><li>{t('gate.p3')}</li><li>{t('gate.p4')}</li>
        </ul>
        <p className="adm-small"><a className="adm-link" href="/privacy" target="_blank" rel="noopener">{t('legal.privacy')}</a> • <a className="adm-link" href="/terms" target="_blank" rel="noopener">{t('legal.terms')}</a></p>
        <h4 className="fx-label">{t('gate.optional')}</h4>
        <ErrorNote error={error} />
        {Object.keys(v).map(k => (
          <label key={k} className="fx-switch"><input type="checkbox" checked={v[k]} onChange={e => setV({ ...v, [k]: e.target.checked })} /> <span><b>{t(`consent.${k}`)}</b><small>{t(`consent.${k}.desc`)}</small></span></label>
        ))}
      </div>
    </Modal>
  );
}
