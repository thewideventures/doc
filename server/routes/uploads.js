// File uploads (multer, memory storage) with type sniffing + size limits, stored via the storage abstraction.
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { requireUser } from '../lib/userAuth.js';
import { rateLimit, userKey } from '../lib/rateLimit.js';
import { getStorage } from '../lib/storage/index.js';
import { notify } from '../lib/notify.js';
import { processUpload } from '../lib/fileSafety.js';
import { sniffType } from '../lib/uploadPipeline.js';
import log from '../lib/logger.js';

const router = express.Router();
const MB = 1024 * 1024;
const MAX_IMAGE = Math.max(0.2, Number(process.env.UPLOAD_MAX_IMAGE_MB) || 3) * MB;
const MAX_DOC = Math.max(0.5, Number(process.env.UPLOAD_MAX_DOC_MB) || 8) * MB;
const MAX_DOCS_PER_DOCTOR = 6;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(MAX_IMAGE, MAX_DOC), files: 1, fields: 10, fieldSize: 1024, parts: 12 }
});

const sniff = sniffType;

const PURPOSES = {
  doctor_photo: { roles: ['doctor', 'clinic'], accept: ['image'], folder: 'doctors' },
  clinic_logo: { roles: ['clinic'], accept: ['image'], folder: 'clinics' },
  clinic_gallery: { roles: ['clinic'], accept: ['image'], folder: 'clinics/gallery' },
  patient_photo: { roles: ['patient'], accept: ['image'], folder: 'patients' },
  member_photo: { roles: ['patient'], accept: ['image'], folder: 'patients/members' },
  doctor_document: { roles: ['doctor'], accept: ['image', 'pdf'], folder: 'doctor-docs', private: true }
};

const DOC_TYPES = { registration_certificate: 'Medical registration certificate', degree_certificate: 'Degree certificate', id_proof: 'Government ID proof', other: 'Other document' };

router.post('/',
  requireUser(),
  rateLimit({ name: 'upload', windowMs: 60 * 60 * 1000, max: 40, key: userKey, message: 'Upload limit reached. Please try again in an hour.' }),
  (req, res, next) => upload.single('file')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is too large. Images up to ${MAX_IMAGE / MB} MB, documents up to ${MAX_DOC / MB} MB.`, code: 'FILE_TOO_LARGE' });
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }),
  async (req, res) => {
    try {
      const purpose = String(req.body?.purpose || req.query.purpose || '');
      const cfg = Object.hasOwn(PURPOSES, purpose) ? PURPOSES[purpose] : null;
      if (!cfg) return res.status(400).json({ error: 'Unknown upload purpose' });
      if (!cfg.roles.includes(req.auth.role)) return res.status(403).json({ error: 'You cannot upload this type of file' });
      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'No file received (field name must be "file")' });
      const type = sniff(req.file.buffer);
      if (!type || !cfg.accept.includes(type.kind)) {
        return res.status(415).json({ error: cfg.accept.includes('pdf') ? 'Only JPG, PNG, WEBP or PDF files are allowed' : 'Only JPG, PNG or WEBP images are allowed', code: 'UNSUPPORTED_TYPE' });
      }
      const max = type.kind === 'image' ? MAX_IMAGE : MAX_DOC;
      if (req.file.size > max) return res.status(413).json({ error: `File is too large (max ${max / MB} MB)`, code: 'FILE_TOO_LARGE' });

      // Re-encode images (strips EXIF / GPS, normalises orientation, defeats polyglots); reject active PDF content
      let safe;
      try { safe = await processUpload(req.file.buffer, type); }
      catch (e) { return res.status(415).json({ error: e.message, code: 'UNSAFE_FILE' }); }

      const owner = req.auth.doctor?.id || req.auth.clinic?.id || req.auth.uid;
      const storage = getStorage();
      const saved = await storage.save({ buffer: safe.buffer, folder: `${cfg.folder}/${owner}`, ext: safe.ext, visibility: cfg.private ? 'private' : 'public' });

      if (purpose === 'doctor_document') {
        const doctor = req.auth.doctor;
        if ((doctor.documents || []).length >= MAX_DOCS_PER_DOCTOR) {
          await storage.remove(saved.key);
          return res.status(400).json({ error: `You can upload up to ${MAX_DOCS_PER_DOCTOR} documents. Remove one first.` });
        }
        const docType = Object.hasOwn(DOC_TYPES, String(req.body?.docType || '')) ? req.body.docType : 'registration_certificate';
        const entry = {
          id: `docf-${crypto.randomBytes(5).toString('hex')}`, docType, label: DOC_TYPES[docType],
          key: saved.key, originalName: String(req.file.originalname || '').replace(/[^\w.\- ]/g, '').slice(0, 120),
          mime: safe.mime, size: safe.buffer.length, status: 'submitted', uploadedAt: new Date()
        };
        doctor.documents.push(entry);
        await doctor.save();
        await notify({ type: 'admin', id: 'admin' }, { type: 'document', title: 'Verification document uploaded', body: `${doctor.name} uploaded ${entry.label}`, data: { doctorId: doctor.id } });
        const { key, ...meta } = entry;
        return res.json({ success: true, document: meta, message: 'Document uploaded. The FindADoc team will review it during verification.' });
      }
      res.json({ success: true, url: saved.url, mime: safe.mime, size: safe.buffer.length });
    } catch (err) {
      log.error('Upload error', { err: err.message });
      res.status(500).json({ error: 'Upload failed' });
    }
  });

router.get('/limits', (req, res) => res.json({ maxImageMb: MAX_IMAGE / MB, maxDocumentMb: MAX_DOC / MB, imageTypes: ['image/jpeg', 'image/png', 'image/webp'], documentTypes: ['application/pdf', 'image/jpeg', 'image/png'], docTypes: DOC_TYPES }));

export default router;
