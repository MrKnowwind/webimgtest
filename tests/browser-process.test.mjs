import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { initializeBrowserProcessor, processInBrowser } from '../client/src/browser-process.js';

before(async () => {
  await initializeBrowserProcessor(
    await readFile(new URL(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm'))),
    await readFile(new URL('../node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm', import.meta.url)),
  );
});

test('网页实际使用的 WASM 引擎能无损转换 WebP，保留透明、ICC、EXIF 并验证像素', async () => {
  const input = await sharp({ create: { width: 24, height: 18, channels: 4, background: { r: 12, g: 89, b: 151, alpha: .5 } } })
    .withIccProfile('srgb').withExif({ IFD0: { Artist: 'Browser test' } }).png().toBuffer();
  const result = await processInBrowser(input, { format: 'webp', mode: 'lossless', quality: 85 });
  assert.equal(result.report.verified, true);
  assert.equal(result.report.inputPixelHash, result.report.outputPixelHash);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.hasAlpha, true);
  assert.deepEqual(metadata.icc, (await sharp(input).metadata()).icc);
  assert.ok(metadata.exif);
});

test('网页 PNG 无损优化保留完全透明像素下的 RGB 和 ICC，真实调用 Oxipng', async () => {
  const raw = Buffer.from([17, 39, 88, 0, 30, 80, 120, 128, 200, 90, 10, 255, 14, 29, 40, 0]);
  const input = await sharp(raw, { raw: { width: 2, height: 2, channels: 4 } }).withIccProfile('srgb').withExif({ IFD0: { Artist: 'PNG metadata' } }).png().toBuffer();
  const result = await processInBrowser(input, { format: 'png', mode: 'lossless' });
  assert.equal(result.report.verified, true); assert.ok(result.report.engines.includes('Oxipng WASM'));
  const out = await sharp(result.buffer).raw().toBuffer();
  assert.deepEqual(out, await sharp(input).raw().toBuffer());
  assert.deepEqual((await sharp(result.buffer).metadata()).exif, (await sharp(input).metadata()).exif);
  const webp = await processInBrowser(input, { format: 'webp', mode: 'lossless' });
  assert.equal(webp.report.verified, true);
  assert.deepEqual(await sharp(webp.buffer).raw().toBuffer(), await sharp(input).raw().toBuffer());
});

test('网页 JPEG 原样直出；跨格式 JPEG 无损和未经授权的透明铺底被拒绝', async () => {
  const jpeg = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#91a4c9' } }).jpeg().toBuffer();
  const pass = await processInBrowser(jpeg, { format: 'jpg', mode: 'lossy' });
  assert.deepEqual(Buffer.from(pass.buffer), jpeg); assert.equal(pass.report.mode, 'passthrough');
  const transparent = await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: .5 } } }).png().toBuffer();
  await assert.rejects(processInBrowser(transparent, { format: 'jpg', mode: 'lossless' }), /JPEG.*无损/);
  await assert.rejects(processInBrowser(transparent, { format: 'jpg', mode: 'lossy' }), /透明/);
});

test('网页四种输出格式均生成真实可解码图片，缩放始终保持比例', async () => {
  const input = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#395c8a' } }).png().toBuffer();
  for (const format of ['png', 'jpg', 'webp', 'avif']) {
    const result = await processInBrowser(input, { format, mode: 'lossy', quality: 70, width: 16, height: 16 });
    const metadata = await sharp(result.buffer).metadata();
    assert.equal(metadata.width, 16); assert.equal(metadata.height, 8);
    assert.equal(metadata.format, format === 'avif' ? 'heif' : format === 'jpg' ? 'jpeg' : format);
    assert.equal(result.report.verified, false);
  }
});

test('网页 PNG 缩放无损校验基准清楚；高位深不会误判为像素无损', async () => {
  const input = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#223d76' } }).png().toBuffer();
  const resized = await processInBrowser(input, { format: 'png', mode: 'lossless', width: 16 });
  assert.equal(resized.report.verified, true); assert.equal(resized.report.verificationScope, 'resized');
  const highDepth = await sharp(input).toColourspace('rgb16').png().toBuffer();
  assert.equal(highDepth[24], 16);
  await assert.rejects(processInBrowser(highDepth, { format: 'png', mode: 'lossless' }), /高位深/);
});

test('网页能读取四种真实输入；EXIF 方向不丢失，体积变大时给出提醒', async () => {
  const source = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#466c89' } }).png().toBuffer();
  for (const format of ['png', 'jpeg', 'webp', 'avif']) {
    const input = await sharp(source).toFormat(format).toBuffer();
    const result = await processInBrowser(input, { format: 'png', mode: 'lossy' });
    assert.equal((await sharp(result.buffer).metadata()).format, 'png');
  }
  const oriented = await sharp(source).withMetadata({ orientation: 6 }).png().toBuffer();
  const result = await processInBrowser(oriented, { format: 'webp', mode: 'lossless' });
  assert.equal((await sharp(result.buffer).metadata()).orientation, 6);
  assert.equal(result.report.verified, true);
  if (result.report.outputBytes > result.report.inputBytes) assert.ok(result.report.warnings.includes('输出体积比原文件大'));
});
