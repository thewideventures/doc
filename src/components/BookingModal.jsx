import React, { useEffect, useMemo, useState } from 'react';
import { X, MapPin, Calendar, Clock, User, ChevronLeft, Loader2, CheckCircle2, Navigation, Video, Home, Building2, Hospital, AlertCircle, Info } from 'lucide-react';
import { apiFetch, createClient, getSession, inr, fmtDate, fmtTime, LOCATION_KIND_LABEL, MODE_LABEL, MODE_SHORT } from '../lib/api';
import PaymentSheet from './PaymentSheet';

export const KIND_ICON = { clinic: Building2, own_clinic: Building2, hospital: Hospital, home_visit: Home, online: Video };
const STEPS = ['Location', 'Date & time', 'Confirm'];

export function ModeBadge({ mode, tokenAmount }) {
  const tone = mode === 'free' ? 'green' : mode === 'paid' ? 'blue' : mode === 'token' ? 'amber' : 'slate';
  return <span className={`adm-badge adm-badge-${tone}`}>{MODE_SHORT[mode] || mode}{mode === 'token' && tokenAmount ? ` ${inr(tokenAmount)}` : ''}</span>;
}

/**
 * Multi-location booking flow:
 * location → date → slot → patient (self / family member) → summary by booking mode → book → pay (paid / token).
 */
export default function BookingModal({ doctor, isOpen, onClose, initialLocationId, onBooked, onRequireLogin, onSessionExpired }) {
  const client = useMemo(() => createClient('patient', { onExpired: onSessionExpired }), [onSessionExpired]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [locId, setLocId] = useState('');
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotReason, setSlotReason] = useState('');
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [time, setTime] = useState('');
  const [me, setMe] = useState(null);
  const [memberId, setMemberId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payment, setPayment] = useState(null);
  const [pending, setPending] = useState(null); // { booking, quote }
  const [done, setDone] = useState(null);
  const [cancelHours, setCancelHours] = useState(4);

  const session = getSession('patient');

  useEffect(() => {
    if (!isOpen || !doctor) return;
    setStep(0); setDone(null); setError(''); setPayment(null); setPending(null); setTime(''); setDate(''); setNote('');
    setLoading(true);
    apiFetch(`/api/doctors/${encodeURIComponent(doctor.id)}`)
      .then(r => {
        setDetail(r.doctor); setCancelHours(r.cancellationWindowHours ?? 4);
        const locs = r.doctor.locations || [];
        const initial = locs.find(l => l.id === initialLocationId) || (locs.length === 1 ? locs[0] : null);
        if (initial) { setLocId(initial.id); setStep(1); } else setLocId('');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    if (session) client.get('/me').then(r => { setMe(r.user); setPatientName(r.user.name && r.user.name !== 'Patient User' ? r.user.name : ''); }).catch(() => {});
  }, [isOpen, doctor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loc = detail?.locations?.find(l => l.id === locId);
  const q = loc?.quote;

  // dates for the chosen location
  useEffect(() => {
    if (!loc || !detail) return;
    setSlotsLoading(true); setTime('');
    apiFetch(`/api/doctors/${detail.id}/availability?locationId=${loc.id}`)
      .then(r => { setDates(r.dates || []); setDate(r.date || r.dates?.[0] || ''); setSlots(r.slots || []); setSlotReason(r.reason || ''); })
      .catch(e => setError(e.message))
      .finally(() => setSlotsLoading(false));
  }, [locId, detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickDate = d => {
    setDate(d); setTime(''); setSlotsLoading(true);
    apiFetch(`/api/doctors/${detail.id}/availability?locationId=${loc.id}&date=${d}`)
      .then(r => { setSlots(r.slots || []); setSlotReason(r.reason || ''); })
      .catch(e => setError(e.message))
      .finally(() => setSlotsLoading(false));
  };

  if (!isOpen || !doctor) return null;

  const book = async () => {
    if (!session) { onRequireLogin?.(); return; }
    if (!memberId && patientName.trim().length < 2) { setError('Please enter the patient name'); return; }
    setBusy(true); setError('');
    try {
      const r = await client.post('/bookings', { doctorId: detail.id, locationId: loc.id, date, time, memberId: memberId || undefined, patientName: memberId ? undefined : patientName.trim(), note });
      if (r.requiresPayment) { setPending({ booking: r.booking, quote: r.quote }); setPayment(r.payment); }
      else { setDone({ booking: r.booking, message: r.message }); onBooked?.(r.booking); }
    } catch (e) {
      setError(e.message);
      if (e.code === 'SLOT_TAKEN' || /slot/i.test(e.message)) pickDate(date);
    } finally { setBusy(false); }
  };

  const locations = detail?.locations || [];
  const kindIcon = k => { const I = KIND_ICON[k] || MapPin; return <I size={18} />; };
  const available = slots.filter(s => s.available);

  return (
    <div className="fx-overlay" onClick={() => !busy && !payment && onClose()}>
      <div className="fx-sheet fx-booking" role="dialog" aria-modal="true" aria-label={`Book ${doctor.name}`} onClick={e => e.stopPropagation()}>
        <div className="fx-sheet-head">
          {step > 0 && !done ? <button className="adm-icon-btn" onClick={() => setStep(s => Math.max(0, s - 1))} aria-label="Back"><ChevronLeft size={18} /></button> : null}
          <div className="fx-head-doc">
            <img src={doctor.photo} alt="" />
            <div><h3>{doctor.name}</h3><small>{(doctor.specialities || []).slice(0, 2).join(' • ')}</small></div>
          </div>
          <button className="adm-icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
        </div>
        {!done && (
          <ol className="fx-stepper" aria-label="Booking steps">
            {STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}><span>{i + 1}</span>{s}</li>)}
          </ol>
        )}

        <div className="fx-sheet-body">
          {loading && <div className="fx-center"><Loader2 className="adm-spin" /> Loading availability…</div>}
          {error && <div className="adm-alert adm-alert-error"><AlertCircle size={16} /> {error}</div>}

          {done ? (
            <div className="fx-done">
              <CheckCircle2 size={44} />
              <h3>{done.booking.status === 'Pending' ? 'Booking requested' : 'Appointment confirmed'}</h3>
              <p className="adm-muted">{done.message}</p>
              <dl className="fx-breakdown">
                <div><dt>Token</dt><dd className="adm-code">{done.booking.bookingCode || done.booking.id}</dd></div>
                <div><dt>When</dt><dd>{fmtDate(done.booking.date)}, {fmtTime(done.booking.timeSlot)}</dd></div>
                <div><dt>Where</dt><dd>{done.booking.locationName || loc?.name}</dd></div>
                <div><dt>Payment</dt><dd>{done.booking.modeLabel}</dd></div>
                {done.booking.amountDueAtClinic > 0 && <div><dt>Pay at clinic</dt><dd>{inr(done.booking.amountDueAtClinic)}</dd></div>}
              </dl>
              <div className="fx-row fx-center-row">
                {done.booking.directionsUrl && <a className="btn-secondary adm-btn" href={done.booking.directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={15} /> Get directions</a>}
                <button className="btn-primary adm-btn" onClick={onClose}>Done</button>
              </div>
            </div>
          ) : !loading && detail && (
            <>
              {step === 0 && (
                <div className="fx-loc-list" role="radiogroup" aria-label="Choose where to consult">
                  {locations.length === 0 && <p className="adm-muted">This doctor has not published any consultation locations yet.</p>}
                  {locations.map(l => (
                    <button key={l.id} type="button" role="radio" aria-checked={locId === l.id} className={`fx-loc ${locId === l.id ? 'on' : ''}`} onClick={() => { setLocId(l.id); setStep(1); }}>
                      <span className="fx-loc-icon">{kindIcon(l.kind)}</span>
                      <span className="fx-loc-main">
                        <strong>{l.name}</strong>
                        <small>{LOCATION_KIND_LABEL[l.kind]} • {l.addressText}</small>
                        <span className="fx-row fx-wrap"><ModeBadge mode={l.quote?.mode || l.bookingMode} tokenAmount={l.quote?.tokenAmount} /><span className="adm-small">Fee {inr(l.fee)}</span>{l.schedule?.days?.length ? <span className="adm-small adm-muted">{l.schedule.days.join(', ')}</span> : null}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {step === 1 && loc && (
                <div>
                  <div className="fx-loc-summary">{kindIcon(loc.kind)} <div><strong>{loc.name}</strong><small>{loc.addressText}</small></div>
                    {loc.directionsUrl && <a href={loc.directionsUrl} target="_blank" rel="noopener noreferrer" className="adm-link"><Navigation size={13} /> Directions</a>}
                  </div>
                  <h4 className="fx-label"><Calendar size={14} /> Choose a date</h4>
                  {dates.length === 0 && !slotsLoading ? <p className="adm-muted">No upcoming availability at this location.</p> : (
                    <div className="fx-date-strip">
                      {dates.map(d => {
                        const dt = new Date(`${d}T00:00:00+05:30`);
                        return (
                          <button key={d} type="button" className={`fx-date ${d === date ? 'on' : ''}`} onClick={() => pickDate(d)} aria-pressed={d === date}>
                            <small>{dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}</small>
                            <strong>{dt.toLocaleDateString('en-IN', { day: '2-digit', timeZone: 'Asia/Kolkata' })}</strong>
                            <small>{dt.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })}</small>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <h4 className="fx-label"><Clock size={14} /> Choose a time</h4>
                  {slotsLoading ? <div className="fx-center"><Loader2 className="adm-spin" size={16} /> Checking slots…</div> : (
                    available.length === 0 ? <p className="adm-muted">{slotReason || (slots.length && slots.every(x => x.reason === 'past') ? 'No more slots left today. Please pick another date.' : 'All slots are booked for this day. Try another date.')}</p> : (
                      <div className="fx-slots">
                        {slots.map(s => (
                          <button key={s.time} type="button" disabled={!s.available} className={`fx-slot ${time === s.time ? 'on' : ''}`} onClick={() => setTime(s.time)} title={s.reason === 'booked' ? 'Already booked' : s.reason === 'past' ? 'Too soon' : ''}>
                            {fmtTime(s.time)}
                          </button>
                        ))}
                      </div>
                    )
                  )}
                </div>
              )}

              {step === 2 && loc && q && (
                <div className="fx-confirm">
                  <div className="fx-loc-summary">{kindIcon(loc.kind)} <div><strong>{fmtDate(date)} • {fmtTime(time)}</strong><small>{loc.name} — {loc.addressText}</small></div></div>
                  <h4 className="fx-label"><User size={14} /> Who is the appointment for?</h4>
                  {!session ? (
                    <p className="fx-note fx-note-info"><Info size={14} /> Sign in with your mobile number to book.</p>
                  ) : (
                    <>
                      {(me?.familyMembers || []).length > 0 && (
                        <div className="fx-chips">
                          <button type="button" className={`fx-chip ${!memberId ? 'on' : ''}`} onClick={() => setMemberId('')}>Myself</button>
                          {me.familyMembers.map(m => <button key={m.id} type="button" className={`fx-chip ${memberId === m.id ? 'on' : ''}`} onClick={() => setMemberId(m.id)}>{m.name} <small>({m.relation})</small></button>)}
                        </div>
                      )}
                      {!memberId && (
                        <label className="adm-field"><span>Patient name *</span><input value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="Full name" autoComplete="name" /></label>
                      )}
                      <label className="adm-field" style={{ marginTop: 10 }}><span>Note for the doctor (optional)</span><textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder={loc.kind === 'home_visit' ? 'House name, landmark and the main symptom' : 'Main symptom or reason for visit'} /></label>
                    </>
                  )}
                  <h4 className="fx-label">Payment</h4>
                  <div className={`fx-mode fx-mode-${q.mode}`}>
                    <ModeBadge mode={q.mode} tokenAmount={q.tokenAmount} />
                    <p>{MODE_LABEL[q.mode]}</p>
                  </div>
                  <dl className="fx-breakdown">
                    <div><dt>Consultation fee</dt><dd>{inr(q.fee)}</dd></div>
                    {q.mode === 'token' && <div><dt>Booking amount (adjusted in fee)</dt><dd>{inr(q.tokenAmount)}</dd></div>}
                    {q.platformFee > 0 && <div><dt>Platform fee (incl. 18% GST)</dt><dd>{inr(q.platformFee)}</dd></div>}
                    <div className="strong"><dt>Pay now</dt><dd>{inr(q.payNow)}</dd></div>
                    <div><dt>Pay at {loc.kind === 'online' ? 'consultation' : loc.kind === 'home_visit' ? 'visit' : 'clinic'}</dt><dd>{inr(q.dueAtClinic)}</dd></div>
                  </dl>
                  <p className="adm-muted adm-small">Free cancellation up to {cancelHours} hours before the appointment{q.payNow > 0 ? ' (consultation amount refunded; platform fee is non-refundable)' : ''}.</p>
                </div>
              )}
            </>
          )}
        </div>

        {!done && !loading && detail && step > 0 && (
          <div className="adm-modal-foot">
            {step === 1 && <button className="btn-primary adm-btn fx-grow" disabled={!time} onClick={() => setStep(2)} data-testid="booking-next">Continue{time ? ` • ${fmtTime(time)}` : ''}</button>}
            {step === 2 && (session
              ? <button className="btn-primary adm-btn fx-grow" disabled={busy} onClick={book} data-testid="booking-confirm">{busy ? <Loader2 size={15} className="adm-spin" /> : null}{q?.payNow > 0 ? `Book & pay ${inr(q.payNow)}` : loc?.autoConfirm === false ? 'Request appointment' : 'Confirm booking'}</button>
              : <button className="btn-primary adm-btn fx-grow" onClick={() => onRequireLogin?.()}>Sign in to book</button>)}
          </div>
        )}
      </div>

      {payment && pending && (
        <PaymentSheet
          payment={payment} client={client}
          title="Pay to confirm your slot"
          description={`${doctor.name} • ${fmtDate(pending.booking.date)}, ${fmtTime(pending.booking.timeSlot)} • slot held for 15 minutes`}
          breakdown={[
            ...(pending.quote.passThrough > 0 ? [{ label: pending.quote.mode === 'token' ? 'Booking amount' : 'Consultation fee', value: pending.quote.passThrough }] : []),
            ...(pending.quote.platformFee > 0 ? [{ label: 'Platform fee (incl. GST)', value: pending.quote.platformFee }] : [])
          ]}
          prefill={{ name: patientName, phone: session?.user?.phone || me?.phone }}
          onSuccess={r => { setPayment(null); setDone({ booking: r.booking, message: r.message }); onBooked?.(r.booking); }}
          onCancel={() => { setPayment(null); setPending(null); setError('Payment cancelled — your slot was released.'); pickDate(date); }}
        />
      )}
    </div>
  );
}
