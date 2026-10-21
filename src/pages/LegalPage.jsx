import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, ArrowLeft, Mail, Phone, MapPin } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useI18n, LanguageSwitcher } from '../i18n';
import { LEGAL } from '../i18n/legal';

/** Privacy policy, terms of use and grievance redressal (DPDP Act 2023, IT Rules 2021). */
export default function LegalPage({ kind }) {
  const { t, lang } = useI18n();
  const [contact, setContact] = useState(null);
  useEffect(() => { apiFetch('/api/legal/contact').then(setContact).catch(() => {}); }, []);
  useEffect(() => { const prev = document.title; document.title = `${t(`legal.${kind}`)} | FindADoc`; return () => { document.title = prev; }; }, [kind, t]);
  const doc = (LEGAL[lang] || LEGAL.en)[kind] || LEGAL.en[kind];
  const g = contact?.grievanceOfficer;
  return (
    <div className="fx-public-page">
      <header className="fx-public-head">
        <Link to="/" className="fx-row"><span className="fx-logo fx-logo-sm"><Stethoscope size={18} /></span><span className="fx-logo-text">FindA<span>Doc</span></span></Link>
        <div className="fx-row"><LanguageSwitcher compact /><Link to="/" className="adm-link"><ArrowLeft size={13} /> {t('nav.home')}</Link></div>
      </header>
      <main className="fx-public-main">
        <article className="adm-card fx-legal" data-testid={`legal-${kind}`}>
          <h1>{t(`legal.${kind}`)}</h1>
          <p className="adm-small adm-muted">{t('legal.updated', { date: '2026-10' })}{lang !== 'en' ? ` • ${t('legal.englishPrevails')}` : ''}</p>
          {doc.map(([h, body]) => (
            <section key={h}><h2>{h}</h2>{body.split('\n').map((para, i) => <p key={i}>{para}</p>)}</section>
          ))}
          {(kind === 'grievance' || kind === 'privacy') && (
            <section className="fx-legal-contact">
              <h2>{t('legal.officer')}</h2>
              {g ? (
                <ul>
                  <li><b>{g.name}</b></li>
                  {g.email && <li><Mail size={13} /> <a className="adm-link" href={`mailto:${g.email}`}>{g.email}</a></li>}
                  {g.phone && <li><Phone size={13} /> {g.phone}</li>}
                  {g.address && <li><MapPin size={13} /> {g.address}</li>}
                  <li className="adm-small adm-muted">{t('legal.timelines', { ack: contact.acknowledgementHours, days: contact.responseTimeDays })}</li>
                </ul>
              ) : <p className="adm-muted">…</p>}
            </section>
          )}
          <nav className="fx-row fx-wrap fx-mt">
            <Link className="adm-link" to="/privacy">{t('legal.privacy')}</Link>
            <Link className="adm-link" to="/terms">{t('legal.terms')}</Link>
            <Link className="adm-link" to="/grievance">{t('legal.grievance')}</Link>
          </nav>
        </article>
      </main>
    </div>
  );
}
