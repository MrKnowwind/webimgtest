import { createServer } from 'vite';
import { createApp } from '../server/app.mjs';
const api = createApp({ serveStatic: false }).listen(3001, '127.0.0.1');
const vite = await createServer();
await vite.listen(); vite.printUrls();
async function close() { await vite.close(); api.close(() => process.exit(0)); }
process.on('SIGINT', close); process.on('SIGTERM', close);
