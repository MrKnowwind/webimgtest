import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { processImage } from './process-image.mjs';
import { outputName } from '../shared/options.js';

export function createApp({ serveStatic = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  let active = 0;
  app.use('/api', (request, response, next) => {
    const origin = request.headers.origin;
    const allowed = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:4173,http://localhost:4173').split(',');
    if (origin && allowed.includes(origin)) {
      response.set('Access-Control-Allow-Origin', origin).set('Vary', 'Origin');
      response.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS').set('Access-Control-Allow-Headers', 'Content-Type');
      response.set('Access-Control-Expose-Headers', 'X-Image-Report');
    }
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    response.set('Cache-Control', 'no-store'); next();
  });
  app.get('/api/health', (_request, response) => response.json({ status: 'ok', engine: 'Sharp + Oxipng' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1, fieldSize: 4096, parts: 2 } });
  app.post('/api/process', (request, response, next) => {
    if (active >= 2) return response.status(429).json({ error: '服务正在处理其他图片，请稍后重试' });
    active++; let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    response.locals.release = release;
    response.on('finish', release);
    response.on('close', () => { if (!response.locals.processing) release(); });
    next();
  }, upload.single('image'), async (request, response, next) => {
    response.locals.processing = true;
    try {
      if (!request.file) return response.status(400).json({ error: '请选择图片' });
      let options;
      try { options = JSON.parse(request.body.options || '{}'); } catch { return response.status(400).json({ error: '处理参数不是有效 JSON' }); }
      const result = await processImage(request.file.buffer, options);
      response.set('X-Image-Report', encodeURIComponent(JSON.stringify(result.report)));
      response.attachment(outputName(request.file.originalname, result.report.format));
      response.type(`image/${result.report.format}`).send(result.buffer);
    } catch (error) { next(error); }
    finally { response.locals.processing = false; response.locals.release(); }
  });
  if (serveStatic) app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.use((error, _request, response, _next) => {
    const status = error instanceof multer.MulterError ? 413 : error.status || 422;
    response.status(status).json({ error: error instanceof multer.MulterError ? '单张文件不能超过 25 MB，且每次请求只能包含一张图片' : error.message || '图片处理失败' });
  });
  return app;
}
