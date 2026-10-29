import sharp from 'sharp';
import oxipng from 'oxipng-bin';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeOptions, targetSize, ProcessingError } from '../shared/options.js';

const exec = promisify(execFile);
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const decodeOptions = { limitInputPixels: 24_000_000, failOn: 'warning' };
export { ProcessingError };

async function optimizePng(buffer) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cover-lab-png-'));
  try {
    const source = path.join(directory, 'source.png'), output = path.join(directory, 'optimized.png');
    await writeFile(source, buffer);
    // 不使用 --strip 或 --alpha：保留元数据和透明像素下的 RGB。
    await exec(process.env.OXIPNG_PATH || oxipng, ['-o', '2', '--out', output, source], { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
    return await readFile(output);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function pixels(buffer, depth, resize) {
  let pipeline = sharp(buffer, decodeOptions).keepMetadata();
  if (resize) pipeline = pipeline.resize(resize);
  return pipeline.toColourspace(depth === 'ushort' ? 'rgb16' : 'srgb').ensureAlpha().raw({ depth }).toBuffer({ resolveWithObject: true });
}

export async function processImage(input, options = {}) {
  options = normalizeOptions(options);
  const metadata = await sharp(input, decodeOptions).metadata();
  const sourceFormat = metadata.format === 'heif' && metadata.compression === 'av1' ? 'avif' : metadata.format;
  if (!['png', 'jpeg', 'webp', 'avif'].includes(sourceFormat)) throw new ProcessingError('仅支持 PNG、JPG、WebP 和 AVIF');
  if ((metadata.pages || 1) > 1) throw new ProcessingError('暂不处理动画或多帧图片，以免丢失帧');
  const size = targetSize(metadata.width, metadata.height, options);
  const resize = size.resized ? { width: size.width, height: size.height, fit: 'inside', withoutEnlargement: true } : undefined;
  const passThrough = sourceFormat === options.format && sourceFormat !== 'png' && !resize && (!options.allowReencode || options.mode === 'lossless');
  if (!passThrough && options.mode === 'lossless' && options.format === 'jpeg') throw new ProcessingError('JPEG 跨格式转换或缩放不支持可验证的无损编码；请选择 PNG / WebP');
  if (!passThrough && options.mode === 'lossless' && metadata.space === 'cmyk') throw new ProcessingError('CMYK 转换需要改变色彩空间，无法保证逐像素无损');
  if (!passThrough && options.mode === 'lossless' && metadata.depth !== 'uchar' && options.format !== 'png') throw new ProcessingError('高位深图片转换为该格式无法保证像素一致，请保留 PNG');
  const warnings = [];
  let buffer, engines = [];
  if (passThrough) {
    buffer = Buffer.from(input);
    warnings.push('同格式文件原样保留，未再次编码；这不表示源文件本身采用无损编码');
  } else if (sourceFormat === 'png' && options.format === 'png' && !resize && options.mode === 'lossless') {
    buffer = await optimizePng(input); engines = ['Oxipng'];
  } else {
    let pipeline = sharp(input, decodeOptions).keepMetadata();
    if (resize) pipeline = pipeline.resize(resize);
    if (options.format === 'jpeg' && metadata.hasAlpha && !(await sharp(input).stats()).isOpaque) {
      if (!options.flattenAlpha) throw new ProcessingError('JPEG 不支持透明通道；请更换格式或明确允许铺底');
      pipeline = pipeline.flatten({ background: options.background }); warnings.push(`透明通道已铺底为 ${options.background}`);
    }
    if (metadata.space === 'cmyk') { pipeline = pipeline.toColourspace('srgb').withIccProfile('srgb'); warnings.push('CMYK 已转换为 sRGB，原 ICC 无法直接沿用'); }
    const lossless = options.mode === 'lossless';
    const quality = lossless ? 100 : options.quality;
    if (options.format === 'png') pipeline = pipeline.png({ compressionLevel: 9, palette: !lossless, quality });
    if (options.format === 'webp') pipeline = pipeline.webp({ lossless, quality, alphaQuality: 100, effort: 5 });
    if (options.format === 'jpeg') pipeline = pipeline.jpeg({ quality: options.quality, mozjpeg: true });
    if (options.format === 'avif') pipeline = pipeline.avif({ lossless, quality, chromaSubsampling: '4:4:4', effort: 4 });
    buffer = await pipeline.toBuffer(); engines = ['Sharp'];
    if (options.format === 'png') { buffer = await optimizePng(buffer); engines.push('Oxipng'); }
  }
  const depth = metadata.depth === 'ushort' ? 'ushort' : 'uchar';
  const verified = passThrough || options.mode === 'lossless';
  let inputPixelHash = null, outputPixelHash = null;
  if (verified) {
    const before = await pixels(input, depth, resize), after = await pixels(buffer, depth);
    if (!before.data.equals(after.data) || before.info.width !== after.info.width || before.info.height !== after.info.height) throw new ProcessingError('像素一致性验证失败（含透明像素 RGB）；请改用 PNG 或有损模式');
    inputPixelHash = hash(before.data); outputPixelHash = hash(after.data);
  }
  const outputMetadata = await sharp(buffer).metadata();
  const iccPreserved = !metadata.icc || metadata.icc.equals(outputMetadata.icc || Buffer.alloc(0));
  if (!iccPreserved && verified) throw new ProcessingError('ICC 配置无法原样保留，不能声明无损');
  if (!iccPreserved) warnings.push('ICC 配置未能原样保留');
  for (const field of ['exif', 'xmp', 'iptc']) if (metadata[field] && !outputMetadata[field]) warnings.push(`${field.toUpperCase()} 不受目标容器支持，未能保留`);
  if (resize) warnings.push('已等比例缩放；像素校验以缩放后结果为基准，原图像素已改变');
  if (buffer.length > input.length) warnings.push('输出体积比原文件大');
  return { buffer, report: {
    format: options.format, mode: passThrough ? 'passthrough' : options.mode, verified, verificationScope: resize ? 'resized' : 'original',
    inputPixelHash, outputPixelHash, pixelDepth: depth, iccPreserved,
    inputSha256: hash(input), outputSha256: hash(buffer),
    inputBytes: input.length, outputBytes: buffer.length,
    width: outputMetadata.width, height: outputMetadata.height,
    inputWidth: metadata.width, inputHeight: metadata.height,
    engines, warnings,
  } };
}
