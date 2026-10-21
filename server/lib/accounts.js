// Account status helpers shared by public routes and admin routes.

export function statusMessage(kind, doc) {
  if (!doc) return null;
  const label = kind === 'doctor' ? 'doctor profile' : kind === 'clinic' ? 'clinic account' : 'account';
  switch (doc.status) {
    case 'suspended':
      return { code: 'ACCOUNT_SUSPENDED', blocking: true, error: `Your ${label} has been suspended: ${doc.statusReason || doc.suspensionReason || 'Please contact FindADoc support.'}`, reason: doc.statusReason || doc.suspensionReason || '' };
    case 'deleted':
      return { code: 'ACCOUNT_DELETED', blocking: true, error: `This ${label} has been removed by FindADoc administrators. Please contact support if you believe this is a mistake.` };
    case 'rejected':
      return { code: 'ACCOUNT_REJECTED', blocking: false, error: `Your ${label} verification was rejected${doc.statusReason ? `: ${doc.statusReason}` : '.'} Please update your details and contact support.`, reason: doc.statusReason || '' };
    case 'pending':
      return { code: 'ACCOUNT_PENDING', blocking: false, error: `Your ${label} is pending verification by the FindADoc admin team. It will not be publicly listed or accept bookings until approved.` };
    default:
      return null;
  }
}

/** Public-facing projection of status info. */
export function accountStatusPayload(kind, doc) {
  if (!doc) return { status: 'not_found' };
  const msg = statusMessage(kind, doc);
  return {
    status: doc.status || 'active',
    reason: doc.statusReason || '',
    message: msg?.error || '',
    code: msg?.code || 'ACCOUNT_ACTIVE',
    blocking: Boolean(msg?.blocking)
  };
}
