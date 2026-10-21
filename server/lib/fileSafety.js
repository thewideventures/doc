// Upload content safety: images are decoded and re-encoded with sharp (drops EXIF/GPS/ICC metadata and any
// trailing payload), PDFs are scanned for active content. SVG / HTML / anything else is rejected by the sniffer.
import sharp from 'sharp';

const MAX_PIXELS = 40_000_000; // decompression-bomb guard
const MAX_EDGE = 2400;

export async function processUpload(buffer, type) {
  if (type.kind === 'image') {
    let img;
    try {
      img = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate(); // apply EXIF orientation, then drop metadata
      const meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
      if (!meta.width || !meta.height) throw new Error('bad image');
    } catch { throw new Error('The image could not be read. Please upload a valid JPG, PNG or WEBP.'); }
    img = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
    let out;
    if (type.mime === 'image/png') out = await img.png({ compressionLevel: 9 }).toBuffer();
    else if (type.mime === 'image/webp') out = await img.webp({ quality: 85 }).toBuffer();
    else out = await img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    return { buffer: out, mime: type.mime, ext: type.ext };
  }
  if (type.kind === 'pdf') {
    const text = buffer.toString('latin1');
    if (!/%%EOF\s*$/.test(text.slice(-1024))) throw new Error('The PDF appears to be incomplete or corrupted.');
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData)\b/.test(text)) {
      throw new Error('This PDF contains scripts, attachments or interactive content and cannot be accepted. Please upload a plain scanned PDF or a photo.');
    }
    return { buffer, mime: type.mime, ext: type.ext };
  }
  throw new Error('Unsupported file type');
}
