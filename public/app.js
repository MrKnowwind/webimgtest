import { pixelCoverage } from './metrics.js';
import { imagesFromFiles, collectDroppedImages } from './import-images.js';

const $ = (id) => document.getElementById(id);
const items = [];
let selectedId = null;
let nextId = 0;
let generation = 0;
let toastTimer;
let zoomed = false;
let importing = false;
const demos = [['gems', 'Crystal Quest']];
const imageLimit = 500;
const selected = () => items.find((item) => item.id === selectedId);
const bytesLabel = (bytes) => bytes == null ? '未知' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
const timeLabel = (ms) => ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
const text = (id, value) => { $(id).textContent = value; };

function notify(message, error = false) {
  clearTimeout(toastTimer);
  text('toast', message);
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const start = performance.now();
    let settled = false;
    const timer = setTimeout(() => finish(new Error('图片加载超时（20 秒）')), 20_000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (error) { image.src = ''; reject(error); }
      else resolve(result);
    }
    image.onload = async () => {
      const decodeStart = performance.now();
      try {
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('无法读取图片尺寸');
        const entry = performance.getEntriesByName(image.currentSrc, 'resource').at(-1);
        finish(null, {
          width: image.naturalWidth, height: image.naturalHeight,
          loadMs: performance.now() - start, decodeMs: performance.now() - decodeStart,
          bytes: entry?.decodedBodySize > 0 ? entry.decodedBodySize : null,
          transferBytes: entry?.transferSize > 0 ? entry.transferSize : null,
        });
      } catch { finish(new Error('浏览器无法解码此图片')); }
    };
    image.onerror = () => finish(new Error('图片无法加载，请检查链接、访问权限或文件格式'));
    image.src = src;
  });
}

async function addImage({ src, name, file, demo = false, renderNow = true }) {
  if (items.length >= imageLimit) {
    if (file) URL.revokeObjectURL(src);
    throw new Error(`最多保留 ${imageLimit} 张图片`);
  }
  const currentGeneration = generation;
  try {
    const result = await loadImage(src);
    if (currentGeneration !== generation || items.length >= imageLimit) {
      if (file) URL.revokeObjectURL(src);
      return;
    }
    if (demo && items.some((item) => !item.demo)) return;
    const item = { ...result, id: ++nextId, src, originalSrc: src, name, local: !!file, demo,
      bytes: file ? file.size : result.bytes,
      type: file?.type || (new URL(src, location.href).pathname.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '线上图片'),
    };
    if (!demo) {
      for (let index = items.length - 1; index >= 0; index--) if (items[index].demo) items.splice(index, 1);
    }
    items.push(item);
    if (selectedId == null || !demo) selectedId = item.id;
    if (renderNow) render();
  } catch (error) {
    if (file) URL.revokeObjectURL(src);
    throw error;
  }
}

async function addFiles(images) {
  if (importing) { notify('正在导入，请稍候'); return; }
  if (!images.length) { notify('未找到支持的图片', true); return; }
  importing = true;
  const batch = generation;
  let imported = 0, skipped = 0;
  $('import-status').hidden = false;
  try {
    for (const { file, path } of images) {
      if (batch !== generation) break;
      if (items.length >= imageLimit) { notify(`已达 ${imageLimit} 张上限，剩余图片未导入`, true); break; }
      if (file.size > 25 * 1024 * 1024) { skipped++; continue; }
      try { await addImage({ src: URL.createObjectURL(file), name: path, file, renderNow: false }); imported++; }
      catch { skipped++; }
      text('import-status', `导入 ${imported + skipped} / ${images.length}`);
      if ((imported + skipped) % 12 === 0) render();
    }
    if (batch === generation && skipped) notify(`已导入 ${imported} 张，跳过 ${skipped} 张（超过 25 MB 或无法解码）`, true);
  } finally {
    importing = false; $('import-status').hidden = true; render();
  }
}

function render() {
  $('file-list').replaceChildren();
  $('game-grid').replaceChildren();
  text('file-count', `${items.length} 张`);
  $('demo-button').hidden = items.some((item) => !item.demo);
  const repeat = Number($('repeat').value);
  text('preview-count', `${items.length * repeat} 张`);
  $('empty-state').hidden = items.length > 0;
  for (const item of items) {
    const row = document.createElement('button');
    row.className = 'file-row'; row.type = 'button'; row.setAttribute('aria-pressed', String(item.id === selectedId));
    const thumb = document.createElement('img'); thumb.src = item.src; thumb.alt = '';
    const meta = document.createElement('span'); meta.className = 'file-meta';
    const name = document.createElement('strong'); name.textContent = item.name;
    const detail = document.createElement('small'); detail.textContent = `${item.width} × ${item.height} · ${bytesLabel(item.bytes)}`;
    meta.append(name, detail);
    const mark = document.createElement('span'); mark.className = 'selected-mark'; mark.textContent = item.id === selectedId ? '✓' : '';
    row.append(thumb, meta, mark); row.addEventListener('click', () => selectItem(item.id));
    $('file-list').append(row);
  }
  for (let copy = 0; copy < repeat; copy++) {
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'game-card'; card.dataset.imageId = item.id;
      const button = document.createElement('button'); button.className = 'cover-button'; button.type = 'button';
      button.setAttribute('aria-label', `检查 ${item.name}`); button.setAttribute('aria-pressed', String(item.id === selectedId));
      const image = document.createElement('img'); image.className = 'cover-image'; image.alt = item.name; image.src = item.src;
      image.dataset.originalWidth = item.width; image.dataset.originalHeight = item.height;
      image.addEventListener('error', () => notify(`${item.name}：预览加载失败，链接可能已失效`, true), { once: true });
      button.append(image);
      const badge = document.createElement('span'); badge.className = 'selected-label'; badge.textContent = '已选'; badge.hidden = item.id !== selectedId; button.append(badge);
      button.addEventListener('click', () => selectItem(item.id));
      const info = document.createElement('div'); info.className = 'card-info';
      const dimensions = document.createElement('span'); dimensions.className = 'card-dimensions';
      const size = document.createElement('span'); size.textContent = bytesLabel(item.bytes); info.append(dimensions, size);
      const title = document.createElement('p'); title.className = 'card-title'; title.textContent = item.name;
      card.append(button, info, title); $('game-grid').append(card);
    }
  }
  requestAnimationFrame(updateInspection);
}

function selectItem(id) {
  selectedId = id;
  document.querySelectorAll('.file-row').forEach((row, index) => {
    const active = items[index].id === id;
    row.setAttribute('aria-pressed', String(active)); row.querySelector('.selected-mark').textContent = active ? '✓' : '';
  });
  document.querySelectorAll('.game-card').forEach((card) => {
    const active = Number(card.dataset.imageId) === id;
    card.querySelector('button').setAttribute('aria-pressed', String(active)); card.querySelector('.selected-label').hidden = !active;
  });
  updateInspection();
}

function updateInspection() {
  text('viewport-size', `${Math.round($('lobby').getBoundingClientRect().width)} px 预览宽度`);
  document.querySelectorAll('.game-card').forEach((card) => {
    const rect = card.querySelector('img').getBoundingClientRect();
    card.querySelector('.card-dimensions').textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  });
  const item = selected();
  $('original-button').disabled = !item;
  $('retest-button').disabled = !item || !!item.testing;
  if (!item) {
    text('selected-name', '选择一张封面');
    ['natural-size', 'render-size', 'file-size', 'sharpness', 'load-time', 'decode-time'].forEach((id) => text(id, '—'));
    text('image-type', '等待图片'); text('target-size', '含 DPR 的所需像素：—'); text('file-source', '—');
    text('sharpness-note', '仅评价像素是否足够'); $('sharpness').className = '';
    text('dpr-label', 'DPR —'); text('measurement-kind', '选择图片');
    text('load-note', '选择图片后测量');
    text('network-detail', '');
    text('inspection-note', '');
    return;
  }
  const image = document.querySelector(`.game-card[data-image-id="${item.id}"] .cover-image`);
  if (!image) return; // 批量导入时，所选图片可能尚未加入这一批 DOM。
  const rect = image.getBoundingClientRect();
  const dpr = $('density').value === 'auto' ? window.devicePixelRatio || 1 : Number($('density').value);
  const coverage = pixelCoverage(item.width, item.height, rect.width, rect.height, dpr, $('fit').value);
  const vector = item.type === 'image/svg+xml';
  text('selected-name', item.name);
  text('natural-size', `${item.width} × ${item.height}`);
  text('image-type', item.demo ? 'SVG 示例' : item.type);
  text('render-size', `${Math.round(rect.width * 10) / 10} × ${Math.round(rect.height * 10) / 10}`);
  text('target-size', `像素盒子：${coverage.targetWidth} × ${coverage.targetHeight} px`);
  text('file-size', bytesLabel(item.bytes));
  text('file-source', item.local ? '原文件' : item.bytes == null ? '以 Network 为准' : '响应体大小');
  text('dpr-label', `DPR ${Math.round(dpr * 100) / 100}`);
  text('sharpness', vector ? '矢量图' : coverage.ratio >= 1 ? '像素充足' : '可能模糊');
  $('sharpness').className = vector || coverage.ratio >= 1 ? 'good' : 'warn';
  text('sharpness-note', vector ? '可缩放' : `像素余量 ${coverage.ratio.toFixed(2)}×`);
  text('inspection-note', $('fit').value === 'fill' ? '拉伸模式可能使图片变形。' : vector ? 'SVG 示例仅用于看布局，请导入实际图片。' : '像素充足仍需检查压缩模糊。');
  text('measurement-kind', item.local ? '本地读取 + 解码' : 'URL 请求 + 解码');
  text('load-time', item.testing ? '测试中…' : timeLabel(item.loadMs));
  text('decode-time', item.testing ? '' : `decode() 等待 ${timeLabel(item.decodeMs)}`);
  text('load-note', item.local ? '本地读取，不代表网络下载速度。' : '请求至解码完成，含可能的缓存命中，不含绘制。');
  text('network-detail', item.local ? '' : item.transferBytes ? `传输 ${bytesLabel(item.transferBytes)} · 详情见 Network` : '缓存与跨域计时以 Network 为准');
}

function applySettings() {
  document.documentElement.style.setProperty('--card-width', `${$('card-width').value}px`);
  document.documentElement.style.setProperty('--card-aspect', $('aspect').value);
  document.documentElement.style.setProperty('--image-fit', $('fit').value);
  text('width-value', `${$('card-width').value} px`);
  $('game-grid').classList.toggle('hide-info', !$('show-info').checked);
  requestAnimationFrame(updateInspection);
}

async function loadDemos() {
  const batch = generation;
  $('demo-button').disabled = true;
  try {
    for (const [slug, name] of demos) {
      if (batch !== generation) break;
      if (items.some((item) => item.demo && item.name === name)) continue;
      try { await addImage({ src: new URL(`./demo/${slug}.svg`, location.href).href, name, demo: true }); }
      catch (error) { notify(`示例加载失败：${error.message}`, true); break; }
    }
  } finally { $('demo-button').disabled = false; }
}

$('file-input').addEventListener('change', (event) => { addFiles(imagesFromFiles(event.target.files)); event.target.value = ''; });
$('folder-input').addEventListener('change', (event) => { addFiles(imagesFromFiles(event.target.files)); event.target.value = ''; });
for (const event of ['dragenter', 'dragover']) $('drop-zone').addEventListener(event, (e) => { e.preventDefault(); $('drop-zone').classList.add('drag-over'); });
for (const event of ['dragleave', 'drop']) $('drop-zone').addEventListener(event, (e) => { e.preventDefault(); $('drop-zone').classList.remove('drag-over'); });
$('drop-zone').addEventListener('drop', async (event) => {
  const batch = generation;
  try {
    const images = await collectDroppedImages(event.dataTransfer);
    if (batch === generation) await addFiles(images);
  } catch { notify('文件夹读取失败，请使用“选择文件夹”', true); }
});
// 防止把图片拖到上传区之外时浏览器直接打开文件、丢失当前测试。
window.addEventListener('dragover', (event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop', (event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
$('url-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    const url = new URL($('image-url').value.trim(), location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入 HTTP(S) 图片链接或本站相对路径');
    const name = decodeURIComponent(url.pathname.split('/').pop() || url.hostname);
    await addImage({ src: url.href, name });
    $('image-url').value = '';
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});
$('clear-button').addEventListener('click', () => {
  generation++;
  $('original-dialog').close(); $('original-image').removeAttribute('src');
  for (const item of items) if (item.local) URL.revokeObjectURL(item.src);
  items.length = 0; selectedId = null; render();
});
$('demo-button').addEventListener('click', loadDemos);
for (const id of ['card-width', 'aspect', 'fit', 'density', 'show-info']) $(id).addEventListener('input', applySettings);
$('repeat').addEventListener('change', render);
function setViewport(mobile) {
  $('lobby').classList.toggle('mobile', mobile);
  $('desktop-button').setAttribute('aria-pressed', String(!mobile));
  $('mobile-button').setAttribute('aria-pressed', String(mobile));
}
$('desktop-button').addEventListener('click', () => setViewport(false));
$('mobile-button').addEventListener('click', () => setViewport(true));
$('reset-button').addEventListener('click', () => {
  $('card-width').value = 148; $('aspect').value = '3 / 4'; $('fit').value = 'cover';
  $('density').value = 'auto'; $('repeat').value = '1'; $('show-info').checked = true;
  setViewport(false); applySettings(); render();
});
$('retest-button').addEventListener('click', async () => {
  const item = selected(); if (!item || item.testing) return;
  item.testing = true; updateInspection();
  let src = item.originalSrc;
  if (!item.local && $('cache-bust').checked) {
    const url = new URL(src); url.searchParams.set('_cover_lab', `${Date.now()}-${Math.random().toString(16).slice(2)}`); src = url.href;
  }
  try {
    const result = await loadImage(src);
    if (!items.includes(item)) return;
    Object.assign(item, result, { bytes: item.local ? item.bytes : result.bytes, src });
    notify(item.local ? '本地读取与解码已完成；未产生网络下载' : 'URL 重测完成，缓存与链路详情请查看 Network');
  } catch (error) { notify(`重测失败：${error.message}`, true); }
  finally { item.testing = false; if (items.includes(item)) render(); }
});
$('guide-button').addEventListener('click', () => $('guide-dialog').showModal());
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
$('original-button').addEventListener('click', () => {
  const item = selected(); if (!item) return;
  text('original-name', item.name); $('original-image').src = item.src;
  zoomed = false; $('original-viewport').classList.remove('one-to-one'); text('zoom-button', '切换 1:1');
  $('original-dialog').showModal();
});
$('zoom-button').addEventListener('click', () => {
  zoomed = !zoomed; $('original-viewport').classList.toggle('one-to-one', zoomed); text('zoom-button', zoomed ? '适应窗口' : '切换 1:1');
});
new ResizeObserver(() => requestAnimationFrame(updateInspection)).observe($('lobby'));
window.addEventListener('resize', updateInspection);
applySettings(); render(); loadDemos();
