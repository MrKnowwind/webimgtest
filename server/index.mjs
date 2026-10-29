import { createApp } from './app.mjs';
const port = Number(process.env.PORT || 3001);
const server = createApp().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Cover Lab server: http://127.0.0.1:${server.address().port}`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
