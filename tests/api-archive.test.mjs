import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import JSZip from 'jszip';
import { createApp } from '../server/app.mjs';
import { createArchive } from '../shared/archive.js';

test('真实 HTTP 上传转换、像素报告与 ZIP 下载内容能相互验证', async (t) => {
  const server = createApp({ serveStatic: false }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const input = await sharp({ create: { width: 16, height: 12, channels: 4, background: { r: 40, g: 80, b: 120, alpha: .5 } } }).png().toBuffer();
  const form = new FormData(); form.append('image', new Blob([input]), 'cover.png');
  form.append('options', JSON.stringify({ format: 'webp', mode: 'lossless' }));
  const response = await fetch(`${base}/api/process`, { method: 'POST', body: form });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/webp/);
  const report = JSON.parse(decodeURIComponent(response.headers.get('x-image-report')));
  const output = new Uint8Array(await response.arrayBuffer());
  assert.equal(report.verified, true); assert.equal(report.inputPixelHash, report.outputPixelHash);
  assert.equal((await sharp(output).metadata()).format, 'webp');
  const zip = await JSZip.loadAsync(await createArchive([
    { name: '../cover.png', buffer: output, report }, { name: 'cover.jpg', buffer: output, report },
  ]));
  assert.ok(zip.file('cover_processed.webp')); assert.ok(zip.file('cover_processed_2.webp'));
  assert.deepEqual(await zip.file('cover_processed.webp').async('uint8array'), output);
  const savedReports = JSON.parse(await zip.file('verification.json').async('string'));
  assert.equal(savedReports.length, 2); assert.equal(savedReports[0].inputPixelHash, report.inputPixelHash);
  assert.ok(Object.keys(zip.files).every((name) => !name.includes('../')));
  const bad = new FormData(); bad.append('image', new Blob([Buffer.from('not an image')]), 'x.png');
  assert.equal((await fetch(`${base}/api/process`, { method: 'POST', body: bad })).status, 422);
  const invalid = new FormData(); invalid.append('image', new Blob([input]), 'cover.png'); invalid.append('options', '{bad');
  assert.equal((await fetch(`${base}/api/process`, { method: 'POST', body: invalid })).status, 400);
});
