// Shared helpers for list endpoints: pagination, search & date filters.

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parsePaging(q, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/** Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive) or ?month=YYYY-MM into a Mongo range on `field`. */
export function dateRange(q, field = 'createdAt') {
  let from = null, to = null;
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
    const [y, m] = q.month.split('-').map(Number);
    from = new Date(y, m - 1, 1);
    to = new Date(y, m, 1);
  } else {
    if (q.from) { const d = new Date(q.from); if (!isNaN(d)) from = d; }
    if (q.to) {
      const d = new Date(q.to);
      if (!isNaN(d)) { to = d; if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) to = new Date(d.getTime() + 86400000); }
    }
  }
  if (!from && !to) return {};
  const r = {};
  if (from) r.$gte = from;
  if (to) r.$lt = to;
  return { [field]: r };
}

export function searchFilter(search, fields) {
  if (!search || !String(search).trim()) return {};
  const re = new RegExp(escapeRegex(String(search).trim()), 'i');
  return { $or: fields.map(f => ({ [f]: re })) };
}

export function sortSpec(sort, map, fallback = { createdAt: -1 }) {
  return map[sort] || fallback;
}

export async function paginate(Model, filter, { page, limit, skip }, sort, projection) {
  const [items, total] = await Promise.all([
    Model.find(filter, projection).sort(sort).skip(skip).limit(limit).lean(),
    Model.countDocuments(filter)
  ]);
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  return [headers.map(csvEscape).join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\r\n') + '\r\n';
}
