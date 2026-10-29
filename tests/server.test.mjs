import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('HTTP 预览提供网页和图片，丢失资源返回 404，拒绝写入请求', { timeout: 5000 }, async (t) => {
  const child = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const [chunk] = await once(child.stdout, 'data');
  const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(url, 'server prints its bound address');
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Cover Lab/);
  const asset = await fetch(`${url}/demo/gems.svg?cache-test=1`);
  assert.equal(asset.headers.get('content-type'), 'image/svg+xml');
  assert.match(await asset.text(), /<svg/);
  assert.equal((await fetch(`${url}/missing.png`)).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});
