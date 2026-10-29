// ratio >= 1 表示像素数量满足当前显示尺寸与 DPR；这不评价原图压缩伪影。
export function pixelCoverage(width, height, renderedWidth, renderedHeight, dpr, fit) {
  const x = width / renderedWidth;
  const y = height / renderedHeight;
  const scale = fit === 'contain' ? Math.max(x, y) : Math.min(x, y);
  return { ratio: scale / dpr, targetWidth: Math.ceil(renderedWidth * dpr), targetHeight: Math.ceil(renderedHeight * dpr) };
}
