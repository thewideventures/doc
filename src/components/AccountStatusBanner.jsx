import React from 'react';
import { Clock, XCircle, Ban } from 'lucide-react';

/** Banner shown inside the doctor / clinic workspace for non-active accounts. */
export default function AccountStatusBanner({ status, reason, kind = 'profile' }) {
  if (!status || status === 'active') return null;
  if (status === 'pending') {
    return (
      <div className="account-banner account-banner-pending" role="status">
        <Clock size={20} />
        <div>
          <strong>Pending verification</strong>
          Your {kind} is being reviewed by the FindADoc admin team. Until it is approved it is not publicly listed and cannot accept bookings or payouts. You can still complete your details meanwhile.
        </div>
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className="account-banner account-banner-rejected" role="alert">
        <XCircle size={20} />
        <div>
          <strong>Verification rejected</strong>
          {reason ? `Reason: ${reason}. ` : ''}Please update your details and contact FindADoc support to request a re-review.
        </div>
      </div>
    );
  }
  return (
    <div className="account-banner account-banner-suspended" role="alert">
      <Ban size={20} />
      <div>
        <strong>Account {status}</strong>
        {reason ? `Reason: ${reason}` : 'Please contact FindADoc support.'}
      </div>
    </div>
  );
}
