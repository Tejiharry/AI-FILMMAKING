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

// Windows-app mode (started by the desktop shortcut): stop when no studio window has been open
// for a minute — unless a generation is still running, which keeps the studio alive until it ends.
if (process.env.STUDIO_APP_MODE === '1') {
  let seen = false, idleSince = Date.now();
  setInterval(() => {
    const clients = app.clientCount();
    if (clients > 0) { seen = true; idleSince = Date.now(); return; }
    if (app.busy()) { idleSince = Date.now(); return; }
    const limit = seen ? 60_000 : 180_000; // first window gets 3 min to appear
    if (Date.now() - idleSince > limit) { console.log('No studio window open — shutting down.'); shutdown(); }
  }, 5000).unref();
}
