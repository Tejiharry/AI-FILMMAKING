import { createApp } from './app.js';
import { detectMode } from './media.js';

const app = createApp();
const addr = await app.listen();
const ff = await detectMode();
console.log(`Harry AI FILM STUDIO running at http://${addr.address}:${addr.port}`);
console.log(`ffmpeg: ${ff}${ff === 'none' ? ' — media analysis, thumbnails and the mock provider need ffmpeg' : ''}`);
const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
