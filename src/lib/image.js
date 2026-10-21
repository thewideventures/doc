// Canvas helpers: crop (with rotation) + resize + compress to WebP (JPEG fallback).
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read this image. Please choose a JPG, PNG or WEBP photo.'));
    img.src = src;
  });
}

const rad = d => (d * Math.PI) / 180;
function rotatedSize(w, h, rotation) {
  const r = rad(rotation);
  return { width: Math.abs(Math.cos(r) * w) + Math.abs(Math.sin(r) * h), height: Math.abs(Math.sin(r) * w) + Math.abs(Math.cos(r) * h) };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), type, quality));
}

/** Returns { blob, type, ext, width, height } — output max `maxSize` px on the long edge. */
export async function cropImage(src, pixelCrop, { rotation = 0, maxSize = 800, quality = 0.85 } = {}) {
  const img = await loadImage(src);
  const { width: bw, height: bh } = rotatedSize(img.width, img.height, rotation);
  const stage = document.createElement('canvas');
  stage.width = Math.round(bw); stage.height = Math.round(bh);
  const sctx = stage.getContext('2d');
  sctx.translate(bw / 2, bh / 2);
  sctx.rotate(rad(rotation));
  sctx.translate(-img.width / 2, -img.height / 2);
  sctx.drawImage(img, 0, 0);

  const scale = Math.min(1, maxSize / Math.max(pixelCrop.width, pixelCrop.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(pixelCrop.width * scale));
  out.height = Math.max(1, Math.round(pixelCrop.height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(stage, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, out.width, out.height);

  let blob = await canvasToBlob(out, 'image/webp', quality);
  let type = 'image/webp', ext = 'webp';
  if (!blob || blob.type !== 'image/webp') { blob = await canvasToBlob(out, 'image/jpeg', quality); type = 'image/jpeg'; ext = 'jpg'; }
  return { blob, type, ext, width: out.width, height: out.height };
}

/** Resize without cropping (gallery photos). */
export async function compressImage(file, { maxSize = 1600, quality = 0.82 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return cropImage(url, { x: 0, y: 0, width: img.width, height: img.height }, { maxSize, quality });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}
