export class ProcessingError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

export function normalizeOptions(options = {}) {
  const format = options.format === 'jpg' ? 'jpeg' : options.format || 'webp';
  const mode = options.mode || 'lossless';
  const quality = Number(options.quality ?? 85);
  if (!['png', 'jpeg', 'webp', 'avif'].includes(format) || !['lossless', 'lossy'].includes(mode)) throw new ProcessingError('不支持的格式或压缩模式', 400);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new ProcessingError('质量应为 1–100 的整数', 400);
  const dimension = (value) => {
    if (value == null || value === '') return undefined;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 12000) throw new ProcessingError('缩放尺寸应为 1–12000 的整数', 400);
    return number;
  };
  const width = dimension(options.width), height = dimension(options.height);
  const background = options.background || '#ffffff';
  if (!/^#[0-9a-f]{6}$/i.test(background)) throw new ProcessingError('铺底颜色应为六位十六进制颜色', 400);
  return { format, mode, quality, width, height, background,
    allowReencode: options.allowReencode === true, flattenAlpha: options.flattenAlpha === true };
}

export function targetSize(width, height, options) {
  const ratio = Math.min(1, options.width ? options.width / width : 1, options.height ? options.height / height : 1);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)), resized: ratio < 1 };
}

export function bytesEqual(a, b) {
  return !!a && !!b && a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function sha256(bytes) {
  const input = new Uint8Array(bytes.length); input.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function outputName(name, format) {
  const base = name.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]*$/, '').replace(/[\x00-\x1f<>:"|?*]/g, '_').slice(0, 120) || 'image';
  return `${base}_processed.${format === 'jpeg' ? 'jpg' : format}`;
}
