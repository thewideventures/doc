// Storage abstraction for uploaded files.
// Default driver stores files on local disk under server/uploads (or UPLOAD_DIR):
//   public/  -> served at /api/files/<key> (profile photos, logos, gallery)
//   private/ -> never served statically (verification documents); streamed by authorised routes only.
// To move to S3 / Cloudinary later, implement the same 4 methods (save, url, stream, remove) in a new driver
// and select it with STORAGE_DRIVER. Keys stay the same, so DB records do not change.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(here, '..', '..', 'uploads'));
export const PUBLIC_URL_PREFIX = '/api/files';

function safeKey(key) {
  const k = String(key || '').replace(/\\/g, '/');
  if (!/^(public|private)\/[a-z0-9_\-/]+\.[a-z0-9]{2,5}$/i.test(k) || k.includes('..')) throw new Error('Invalid storage key');
  return k;
}

const localDriver = {
  name: 'local',
  async save({ buffer, folder, ext, visibility = 'public' }) {
    const cleanFolder = String(folder || 'misc').replace(/[^a-z0-9_\-/]/gi, '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(9).toString('hex')}.${ext}`;
    const key = safeKey(`${visibility === 'private' ? 'private' : 'public'}/${cleanFolder}/${name}`);
    const full = path.join(UPLOAD_ROOT, key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buffer, { flag: 'wx' });
    return { key, url: this.url(key) };
  },
  url(key) {
    return key.startsWith('public/') ? `${PUBLIC_URL_PREFIX}/${key.slice('public/'.length)}` : '';
  },
  stream(key) {
    const full = path.join(UPLOAD_ROOT, safeKey(key));
    if (!full.startsWith(UPLOAD_ROOT + path.sep) || !fs.existsSync(full)) return null;
    return fs.createReadStream(full);
  },
  async remove(key) {
    try {
      const full = path.join(UPLOAD_ROOT, safeKey(key));
      if (full.startsWith(UPLOAD_ROOT + path.sep)) await fs.promises.unlink(full);
    } catch { /* already gone */ }
  }
};

const drivers = { local: localDriver };

export function getStorage() {
  const name = process.env.STORAGE_DRIVER || 'local';
  return drivers[name] || localDriver;
}

/** Convert a public URL produced by this storage back to its key (to clean up replaced files). */
export function keyFromPublicUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(`${PUBLIC_URL_PREFIX}/`)) return null;
  try { return safeKey(`public/${url.slice(PUBLIC_URL_PREFIX.length + 1)}`); } catch { return null; }
}

export async function removeIfReplaced(oldUrl, newUrl) {
  if (!oldUrl || oldUrl === newUrl) return;
  const key = keyFromPublicUrl(oldUrl);
  if (key) await getStorage().remove(key);
}

const PRIVATE_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
/** Stream a private file to an authorised caller with defensive headers. Returns false when missing. */
export function sendPrivateFile(res, doc) {
  const stream = getStorage().stream(doc.key);
  if (!stream) return false;
  res.setHeader('Content-Type', PRIVATE_MIME.has(doc.mime) ? doc.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${String(doc.originalName || 'document').replace(/[^\w.\- ]/g, '_').slice(0, 100) || 'document'}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // PDFs keep the browser viewer working (it cannot run in a sandboxed document); images are fully sandboxed
  res.setHeader('Content-Security-Policy', doc.mime === 'application/pdf' ? "default-src 'none'; object-src 'self'; frame-ancestors 'none'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}
