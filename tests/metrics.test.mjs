import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixelCoverage } from '../public/metrics.js';

test('裁切时按实际可用像素检查高 DPR 清晰度，不能只看原图总像素', () => {
  assert.equal(pixelCoverage(600, 800, 150, 200, 2, 'cover').ratio, 2);
  assert.equal(pixelCoverage(300, 800, 150, 200, 3, 'cover').ratio, 2 / 3);
  assert.equal(pixelCoverage(600, 200, 150, 200, 2, 'contain').ratio, 2);
  assert.equal(pixelCoverage(600, 200, 150, 200, 2, 'fill').ratio, 0.5);
});
