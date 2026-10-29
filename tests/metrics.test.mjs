import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTransfer, pixelCoverage } from '../public/metrics.js';

test('按原始文件字节和 Mbps 估算传输时间，并且只计一次首包延迟', () => {
  assert.equal(estimateTransfer(125_000, 1, 150), 1150);
  assert.equal(estimateTransfer(0, 10, 100), 100);
  assert.equal(estimateTransfer(null, 10, 100), null);
});

test('裁切时按实际可用像素检查高 DPR 清晰度，不能只看原图总像素', () => {
  assert.equal(pixelCoverage(600, 800, 150, 200, 2, 'cover').ratio, 2);
  assert.equal(pixelCoverage(300, 800, 150, 200, 3, 'cover').ratio, 2 / 3);
  assert.equal(pixelCoverage(600, 200, 150, 200, 2, 'contain').ratio, 2);
  assert.equal(pixelCoverage(600, 200, 150, 200, 2, 'fill').ratio, 0.5);
});
