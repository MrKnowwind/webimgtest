import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createArchive } from '../../shared/archive.js';
import { outputName } from '../../shared/options.js';
import { collectDroppedImages } from '../../public/import-images.js';
import './process.css';

const defaults = { format: 'webp', mode: 'lossless', quality: 85, original: true, width: '', height: '', allowReencode: false, flattenAlpha: false, background: '#ffffff' };
const size = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
const supported = (file) => /\.(png|jpe?g|webp|avif)$/i.test(file.name) || ['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(file.type);
const mime = (format) => `image/${format}`;
function save(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function browserRunner() {
  const worker = new Worker(new URL('./processor.worker.js', import.meta.url), { type: 'module' });
  let pending, closed = false;
  worker.onmessage = ({ data }) => { if (data.error) pending?.reject(new Error(data.error)); else pending?.resolve(data.result); pending = undefined; };
  worker.onerror = () => { closed = true; pending?.reject(new Error('编码器运行失败，请重试或减小图片')); pending = undefined; worker.terminate(); };
  return {
    run(buffer, options) { return new Promise((resolve, reject) => {
      if (closed) return reject(new Error('编码器已停止，请重新开始'));
      pending = { resolve, reject }; worker.postMessage({ buffer, options }, [buffer]);
    }); },
    close() { closed = true; pending?.reject(new Error('已停止')); pending = undefined; worker.terminate(); },
  };
}

function App() {
  const [items, setItems] = useState([]), [selected, setSelected] = useState(null);
  const [options, setOptions] = useState(defaults), [busy, setBusy] = useState(false), [zipping, setZipping] = useState(false);
  const [message, setMessage] = useState(''), [dragging, setDragging] = useState(false), [actualSize, setActualSize] = useState(false);
  const [engine, setEngine] = useState('browser'), [apiBase, setApiBase] = useState(import.meta.env.VITE_API_BASE || '');
  const itemsRef = useRef(items), runRef = useRef(null), nextId = useRef(0);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => {
    runRef.current?.runner?.close(); runRef.current?.controller.abort();
    itemsRef.current.forEach((item) => { URL.revokeObjectURL(item.url); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); });
  }, []);
  const update = (field, value) => setOptions((previous) => ({ ...previous, [field]: value }));
  const patch = (id, values) => setItems((previous) => previous.map((item) => item.id === id ? { ...item, ...values } : item));
  const current = items.find((item) => item.id === selected), finished = items.filter((item) => item.result);
  function addFiles(files, paths = []) {
    if (busy) return;
    const eligible = Array.from(files).map((file, index) => ({ file, name: paths[index] || file.webkitRelativePath || file.name })).filter(({ file }) => supported(file)), added = [];
    let bytes = items.reduce((sum, item) => sum + item.file.size, 0), skipped = files.length - eligible.length;
    for (const { file, name } of eligible) {
      if (items.length + added.length >= 50 || file.size > 25 * 1048576 || bytes + file.size > 200 * 1048576) { skipped++; continue; }
      bytes += file.size;
      added.push({ id: ++nextId.current, file, name, url: URL.createObjectURL(file), status: 'ready' });
    }
    setItems((previous) => [...previous, ...added]);
    if (selected == null && added.length) setSelected(added[0].id);
    setMessage(skipped ? `已添加 ${added.length} 张，跳过 ${skipped} 项。支持 4 种格式、单张 25 MB、共 50 张 / 200 MB。` : '');
  }
  function clear() {
    items.forEach((item) => { URL.revokeObjectURL(item.url); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); });
    setItems([]); setSelected(null); setMessage('');
  }
  async function start() {
    if (busy || !items.length) return;
    setBusy(true); setMessage('');
    const state = { stopped: false, runner: null, controller: new AbortController() }; runRef.current = state;
    const snapshot = { ...options, width: options.original ? undefined : options.width, height: options.original ? undefined : options.height };
    items.forEach((item) => { if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); });
    setItems((previous) => previous.map(({ result, resultUrl, ...item }) => ({ ...item, error: '', status: 'ready' })));
    let resultBytes = 0;
    try {
      if (!options.original && !options.width && !options.height) throw new Error('请填写最大宽度或最大高度');
      if (engine === 'browser') state.runner = browserRunner();
      else {
        const url = new URL(apiBase || location.origin);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('服务地址必须为 HTTP(S)');
      }
      for (const item of items) {
        if (state.stopped) break;
        patch(item.id, { status: 'processing' });
        try {
          let result;
          if (engine === 'browser') result = await state.runner.run(await item.file.arrayBuffer(), snapshot);
          else {
            const form = new FormData(); form.append('image', item.file); form.append('options', JSON.stringify(snapshot));
            const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/process`, { method: 'POST', body: form, signal: state.controller.signal });
            if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Sharp 服务不可用'); }
            const report = JSON.parse(decodeURIComponent(response.headers.get('X-Image-Report')));
            result = { buffer: new Uint8Array(await response.arrayBuffer()), report };
          }
          if (state.stopped) break;
          resultBytes += result.buffer.length;
          if (resultBytes > 200 * 1048576) throw new Error('本次结果超过 200 MB，请分批处理');
          const resultUrl = URL.createObjectURL(new Blob([result.buffer], { type: mime(result.report.format) }));
          patch(item.id, { result, resultUrl, status: 'done' });
        } catch (error) { patch(item.id, { status: state.stopped ? 'ready' : 'error', error: state.stopped ? '' : error.message }); }
      }
    } catch (error) { setMessage(error.message); }
    finally { state.runner?.close(); runRef.current = null; setBusy(false); }
  }
  function stop() {
    if (!runRef.current) return;
    runRef.current.stopped = true; runRef.current.runner?.close(); runRef.current.controller.abort();
  }
  async function downloadZip() {
    setZipping(true);
    try { const bytes = await createArchive(finished.map((item) => ({ name: item.name, ...item.result }))); save(new Blob([bytes], { type: 'application/zip' }), 'cover-lab-results.zip'); }
    catch (error) { setMessage(error.message); }
    finally { setZipping(false); }
  }
  const report = current?.result?.report;
  return <>
    <header className="header"><a className="brand" href="../"><span className="logo">C▱</span><strong>COVER<span>LAB</span></strong></a><nav><a href="../">封面预览</a><a href="./" aria-current="page">图片处理</a></nav><span className="privacy"><i />{engine === 'browser' ? '浏览器处理 · 无需服务器' : 'Sharp 服务处理 · 上传图片'}</span></header>
    <main className="processor">
      <div className="heading"><div><span className="eyebrow">COVER LAB / IMAGE TOOLS</span><h1>图片转换与压缩</h1></div><span className="formats">PNG / JPG / WEBP / AVIF</span></div>
      <div className="layout">
        <aside className="settings panel"><div className="panel-title"><h2>输出设置</h2><button className="link" disabled={busy} onClick={() => setOptions(defaults)}>重置</button></div>
          <label>输出格式<select aria-label="输出格式" disabled={busy} value={options.format} onChange={(e) => update('format', e.target.value)}><option value="webp">WebP</option><option value="png">PNG</option><option value="jpg">JPG</option><option value="avif">AVIF</option></select></label>
          <label>压缩模式<select aria-label="压缩模式" disabled={busy} value={options.mode} onChange={(e) => update('mode', e.target.value)}><option value="lossless">无损 · 校验像素一致</option><option value="lossy">有损 · 按质量压缩</option></select></label>
          <label className="quality-label">质量 <output>{options.quality}</output><input aria-label="质量" type="range" min="1" max="100" value={options.quality} disabled={busy || options.mode === 'lossless'} onChange={(e) => update('quality', Number(e.target.value))} /></label>
          <p className="hint">{options.mode === 'lossless' ? '无损模式不使用质量参数。' : '每次都从最初上传的文件处理。'}</p>
          <div className="setting-divider" /><label className="check"><input type="checkbox" disabled={busy} checked={options.original} onChange={(e) => update('original', e.target.checked)} />保持原始分辨率</label>
          {!options.original && <><div className="two-fields"><label>最大宽度<input aria-label="最大宽度" type="number" min="1" max="12000" placeholder="不限" disabled={busy} value={options.width} onChange={(e) => update('width', e.target.value)} /></label><label>最大高度<input aria-label="最大高度" type="number" min="1" max="12000" placeholder="不限" disabled={busy} value={options.height} onChange={(e) => update('height', e.target.value)} /></label></div><p className="hint">等比例缩小，不放大；缩放会改变原始像素。</p></>}
          <div className="setting-divider" /><label className="check"><input type="checkbox" disabled={busy || options.mode === 'lossless'} checked={options.allowReencode} onChange={(e) => update('allowReencode', e.target.checked)} />允许同格式有损重编码</label>
          <p className="hint">默认原样保留同格式的 JPG / WebP / AVIF。</p>
          {options.format === 'jpg' && <><label className="check"><input type="checkbox" disabled={busy} checked={options.flattenAlpha} onChange={(e) => update('flattenAlpha', e.target.checked)} />允许透明背景铺底</label>{options.flattenAlpha && <input aria-label="铺底颜色" type="color" disabled={busy} value={options.background} onChange={(e) => update('background', e.target.value)} />}<p className="hint">JPEG 转换不支持像素级无损，也不能保留透明。</p></>}
          <details className="advanced"><summary>可选 Sharp 服务</summary><label>处理位置<select aria-label="处理位置" disabled={busy} value={engine} onChange={(e) => setEngine(e.target.value)}><option value="browser">本机浏览器（默认）</option><option value="server">Node.js + Sharp 服务</option></select></label>{engine === 'server' && <><input aria-label="Sharp 服务地址" type="url" disabled={busy} placeholder="http://127.0.0.1:3001" value={apiBase} onChange={(e) => setApiBase(e.target.value)} /><p className="hint">图片将发送到此地址，需自行运行可选后端。</p></>}</details>
          <button className="primary full" id="start-processing" disabled={!items.length || busy} onClick={start}>{busy ? '处理中…' : `开始处理${items.length ? ` · ${items.length} 张` : ''}`}</button>
          {busy && <button className="button full" onClick={stop}>停止处理</button>}
        </aside>
        <div className="content">
          <section className={`upload panel ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={async (e) => { e.preventDefault(); setDragging(false); try { const images = await collectDroppedImages(e.dataTransfer); addFiles(images.map((image) => image.file), images.map((image) => image.path)); } catch { setMessage('文件夹读取失败，请使用选择文件夹'); } }}>
            <span className="upload-symbol">↥</span><div><h2>拖入图片，批量处理</h2><p>单张 ≤ 25 MB · 最多 50 张 / 200 MB</p></div><div className="upload-buttons"><label className="button file-button">选择图片<input aria-label="选择图片" type="file" multiple accept="image/png,image/jpeg,image/webp,image/avif" disabled={busy} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} /></label><label className="button file-button subtle">选择文件夹<input aria-label="选择文件夹" type="file" multiple webkitdirectory="" directory="" disabled={busy} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} /></label></div>
          </section>
          {message && <div className="message" role="status">{message}</div>}
          <section className="panel queue"><div className="panel-title"><h2>处理队列 <span>{items.length} 张</span></h2><div className="queue-actions"><button className="link" disabled={busy || !items.length} onClick={clear}>清空</button><button className="button zip-button" disabled={busy || zipping || !finished.length} onClick={downloadZip}>{zipping ? '打包中…' : `下载 ZIP${finished.length ? ` · ${finished.length}` : ''}`} ↓</button></div></div>
            {!items.length ? <div className="empty"><span>▧</span><p>添加图片后开始处理</p></div> : <div className="file-list">{items.map((item) => <button key={item.id} className={`file-row ${selected === item.id ? 'selected' : ''}`} onClick={() => setSelected(item.id)}><img src={item.url} alt="" /><div className="file-title"><strong>{item.name}</strong><small>{size(item.file.size)}{item.result ? ` → ${size(item.result.report.outputBytes)}` : ''}</small></div><div className="file-state">{item.status === 'processing' ? <span className="working">处理中…</span> : item.status === 'error' ? <span className="error">处理失败</span> : item.result ? <><span className={item.result.report.outputBytes > item.file.size ? 'warning' : 'success'}>{item.result.report.outputBytes === item.file.size ? '原样保留' : `${item.result.report.outputBytes > item.file.size ? '+' : ''}${((item.result.report.outputBytes / item.file.size - 1) * 100).toFixed(1)}%`}</span><small>{item.result.report.format.toUpperCase()}</small></> : <span className="muted">待处理</span>}</div></button>)}</div>}
          </section>
          <section className="panel comparison"><div className="panel-title"><h2>预览对比</h2><div><label className="check"><input type="checkbox" checked={actualSize} onChange={(e) => setActualSize(e.target.checked)} />1:1 像素</label></div></div>
            <div className={`preview-pair ${actualSize ? 'actual-size' : ''}`}><div><div className="preview-label"><span>原图</span><span>{current ? size(current.file.size) : '—'}</span></div><div className="image-stage">{current ? <img src={current.url} alt="原图预览" /> : <span>原图</span>}</div></div><div><div className="preview-label"><span>处理后</span><span>{report ? size(report.outputBytes) : '—'}</span></div><div className="image-stage">{current?.resultUrl ? <img src={current.resultUrl} alt="处理后预览" /> : <span>等待处理</span>}</div></div></div>
            {current?.error && <p className="error-box" role="alert">{current.error}</p>}
            {report && <div className="result-details"><div className="result-line"><span className={`verification ${report.verified ? 'success' : 'muted'}`}>{report.mode === 'passthrough' ? '✓ 原样保留，未再编码' : report.verified ? `✓ ${report.verificationScope === 'resized' ? '缩放后基准' : '原图'}像素一致已验证` : '有损结果 · 不承诺像素一致'}</span><button className="button" onClick={() => save(new Blob([current.result.buffer], { type: mime(report.format) }), outputName(current.name, report.format))}>下载此图 ↓</button></div><p className="dimension-line">{report.inputWidth} × {report.inputHeight} → {report.width} × {report.height} px <span>{report.engines.join(' + ') || '未编码'}</span></p>{report.warnings.map((warning, index) => <p className="warning warning-line" key={index}>{warning}</p>)}<details className="verification-details"><summary>像素校验与元数据报告</summary><dl><dt>验证范围</dt><dd>{report.verificationScope === 'resized' ? '等比例缩放后的基准' : '原始分辨率'} · {report.pixelDepth}</dd><dt>基准像素 SHA-256</dt><dd>{report.inputPixelHash || '有损模式未校验'}</dd><dt>输出像素 SHA-256</dt><dd>{report.outputPixelHash || '有损模式未校验'}</dd><dt>原文件 SHA-256</dt><dd>{report.inputSha256}</dd><dt>ICC 配置</dt><dd>{report.iccPreserved ? '保留（或原图未携带 ICC）' : '无法原样保留'}</dd></dl></details></div>}
          </section>
          <p className="footnote">原文件始终保留。ZIP 内附 verification.json 校验报告。网页引擎不对高位深、动画及部分色彩转换承诺无损；不适用时会停止并提示。</p>
        </div>
      </div>
    </main>
  </>;
}

const root = import.meta.hot?.data.root || createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<App />);
