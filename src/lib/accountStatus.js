// Account status helpers for the doctor / clinic / patient apps.
// The server is the source of truth (status: pending | active | rejected | suspended | deleted).

export async function fetchAccountStatus(type, { id, phone } = {}) {
  const q = new URLSearchParams({ type, ...(id ? { id } : {}), ...(phone ? { phone } : {}) });
  try {
    const res = await fetch(`/api/account/status?${q}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // network issues should never log a user out
  }
}
