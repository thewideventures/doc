// Shared secure upload pipeline for private health files (lab reports, documents):
// multer memory storage (size-capped) -> magic-byte sniff -> processUpload (image re-encode / PDF active-content
// scan) -> private storage. Private files are never served statically; only authorised routes stream them.
import multer from 'multer';
import { processUpload } from './fileSafety.js';
import { getStorage } from './storage/index.js';

const MB = 1024 * 1024;
export const MAX_IMAGE = Math.max(0.2, Number(process.env.UPLOAD_MAX_IMAGE_MB) || 3) * MB;
export const MAX_DOC = Math.max(0.5, Number(process.env.UPLOAD_MAX_DOC_MB) || 8) * MB;

/** Detect the real file type from magic bytes (never trust the client's mimetype / extension). */
export function sniffType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (buf.slice(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' };
  return null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(MAX_IMAGE, MAX_DOC), files: 1, fields: 12, fieldSize: 2048, parts: 14 } });

/** Express middleware: one multipart file in field "file", JSON errors. */
export function singleFile(req, res, next) {
  upload.single('file')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is too large. Images up to ${MAX_IMAGE / MB} MB, PDFs up to ${MAX_DOC / MB} MB.`, code: 'FILE_TOO_LARGE' });
    return res.status(400).json({ error: 'Upload failed — send one file in the "file" field' });
  });
}

const fail = (status, error, code) => Object.assign(new Error(error), { status, code });

/** Validate + sanitise + store the uploaded file privately. Returns { key, mime, size, originalName }. */
export async function storePrivateUpload(req, { folder, accept = ['image', 'pdf'] }) {
  if (!req.file?.buffer?.length) throw fail(400, 'No file received (field name must be "file")', 'NO_FILE');
  const type = sniffType(req.file.buffer);
  if (!type || !accept.includes(type.kind)) throw fail(415, accept.includes('pdf') ? 'Only PDF, JPG, PNG or WEBP files are allowed' : 'Only JPG, PNG or WEBP images are allowed', 'UNSUPPORTED_TYPE');
  const max = type.kind === 'image' ? MAX_IMAGE : MAX_DOC;
  if (req.file.size > max) throw fail(413, `File is too large (max ${max / MB} MB)`, 'FILE_TOO_LARGE');
  let safe;
  try { safe = await processUpload(req.file.buffer, type); }
  catch (e) { throw fail(415, e.message, 'UNSAFE_FILE'); }
  const saved = await getStorage().save({ buffer: safe.buffer, folder, ext: safe.ext, visibility: 'private' });
  return { key: saved.key, mime: safe.mime, size: safe.buffer.length, originalName: String(req.file.originalname || '').replace(/[^\w.\- ]/g, '').slice(0, 120) || `file.${safe.ext}` };
}
