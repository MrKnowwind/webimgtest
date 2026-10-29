import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processImage } from '../server/process-image.mjs';

test('PNG 无损优化实际经过 Oxipng，保留 RGBA、ICC、EXIF 并提供相同像素哈希', async () => {
  const input = await sharp({ create: { width: 24, height: 18, channels: 4, background: { r: 30, g: 80, b: 130, alpha: .5 } } })
    .withIccProfile('srgb').withExif({ IFD0: { Artist: 'Cover Lab test' } }).png().toBuffer();
  const original = Buffer.from(input);
  const result = await processImage(input, { format: 'png', mode: 'lossless', quality: 85 });
  assert.deepEqual(input, original, '不改变原始 Buffer');
  assert.equal(result.report.verified, true);
  assert.equal(result.report.inputPixelHash, result.report.outputPixelHash);
  assert.ok(result.report.engines.includes('Oxipng'));
  const before = await sharp(input).metadata(), after = await sharp(result.buffer).metadata();
  assert.deepEqual(after.icc, before.icc);
  assert.deepEqual(after.exif, before.exif);
  assert.equal(after.hasAlpha, true);
});

test('同格式 JPEG 默认原样保留，PNG 不能被标为无损 JPEG', async () => {
  const input = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#6281aa' } }).jpeg({ quality: 72 }).toBuffer();
  const result = await processImage(input, { format: 'jpg', mode: 'lossy', quality: 85 });
  assert.deepEqual(result.buffer, input);
  assert.equal(result.report.mode, 'passthrough');
  const png = await sharp(input).png().toBuffer();
  await assert.rejects(processImage(png, { format: 'jpg', mode: 'lossless' }), /JPEG.*无损/);
});

test('PNG 转 WebP 无损时保留半透明像素和 ICC，并逐像素验证', async () => {
  const input = await sharp({ create: { width: 20, height: 12, channels: 4, background: { r: 11, g: 59, b: 147, alpha: .5 } } })
    .withIccProfile('srgb').png().toBuffer();
  const result = await processImage(input, { format: 'webp', mode: 'lossless', quality: 85 });
  assert.equal((await sharp(result.buffer).metadata()).format, 'webp');
  assert.equal(result.report.verified, true);
  assert.equal(result.report.inputPixelHash, result.report.outputPixelHash);
  assert.equal((await sharp(result.buffer).metadata()).hasAlpha, true);
});

test('等比例缩放以缩放后像素为基准，并明确标记原图已改变', async () => {
  const input = await sharp({ create: { width: 80, height: 40, channels: 4, background: '#254d88' } }).png().toBuffer();
  const result = await processImage(input, { format: 'png', mode: 'lossless', width: 20, height: 20 });
  assert.equal(result.report.width, 20); assert.equal(result.report.height, 10);
  assert.equal(result.report.verificationScope, 'resized'); assert.equal(result.report.verified, true);
  assert.ok(result.report.warnings.some((warning) => warning.includes('原图像素已改变')));
});

test('真实 PNG/JPG/WebP/AVIF 有损输出均可解码，透明转 JPG 必须明确允许铺底', async () => {
  const input = await sharp({ create: { width: 16, height: 12, channels: 4, background: { r: 90, g: 20, b: 160, alpha: .4 } } }).png().toBuffer();
  await assert.rejects(processImage(input, { format: 'jpg', mode: 'lossy' }), /透明/);
  for (const format of ['png', 'jpg', 'webp', 'avif']) {
    const result = await processImage(input, { format, mode: 'lossy', quality: 65, flattenAlpha: true });
    const metadata = await sharp(result.buffer).metadata();
    assert.equal(metadata.width, 16); assert.equal(metadata.height, 12);
    assert.equal(metadata.format, format === 'jpg' ? 'jpeg' : format === 'avif' ? 'heif' : format);
    assert.equal(result.report.verified, false);
  }
});

test('无损失败不能返回伪造成功；非法参数被拒绝', async () => {
  const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#172c59' } }).png().toBuffer();
  await assert.rejects(processImage(input, { quality: 101 }), /质量/);
  await assert.rejects(processImage(input, { width: -1 }), /缩放/);
  await assert.rejects(processImage(input, { format: 'gif' }), /格式/);
  try {
    const result = await processImage(input, { format: 'avif', mode: 'lossless' });
    assert.equal(result.report.verified, true); assert.equal(result.report.inputPixelHash, result.report.outputPixelHash);
  } catch (error) { assert.match(error.message, /像素一致性验证失败|ICC/); }
});
