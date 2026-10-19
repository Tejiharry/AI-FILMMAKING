// Post-production interchange: CMX3600 EDL, FCPXML 1.10, OpenTimelineIO JSON.
// All three are imported by DaVinci Resolve (File > Import > Timeline). Clips
// reference the generated media files at their absolute paths.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// items: [{ name, file, duration_s, fps, width, height, shot_title, scene_heading, has_audio }]
export function toTimelineItems(rows) {
  return rows.filter((r) => r.file).map((r) => ({ ...r, fps: r.fps || 24 }));
}

function tc(frames, fps) {
  const f = Math.round(fps);
  const h = Math.floor(frames / (3600 * f)), m = Math.floor(frames / (60 * f)) % 60, s = Math.floor(frames / f) % 60, fr = frames % f;
  return [h, m, s, fr].map((n) => String(n).padStart(2, '0')).join(':');
}

export function edl(title, items, fps = 24) {
  const lines = [`TITLE: ${title.replace(/[^\w .-]/g, '').slice(0, 60)}`, 'FCM: NON-DROP FRAME', ''];
  let rec = 3600 * Math.round(fps); // record starts at 01:00:00:00
  items.forEach((it, i) => {
    const n = Math.round(it.duration_s * fps);
    const reel = `AX`;
    lines.push(`${String(i + 1).padStart(3, '0')}  ${reel.padEnd(8)} V     C        ${tc(0, fps)} ${tc(n, fps)} ${tc(rec, fps)} ${tc(rec + n, fps)}`);
    lines.push(`* FROM CLIP NAME: ${path.basename(it.file)}`);
    lines.push(`* COMMENT: ${(it.shot_title ?? '').replace(/\n/g, ' ')}`);
    if (it.has_audio) {
      lines.push(`${String(i + 1).padStart(3, '0')}  ${reel.padEnd(8)} A     C        ${tc(0, fps)} ${tc(n, fps)} ${tc(rec, fps)} ${tc(rec + n, fps)}`);
      lines.push(`* FROM CLIP NAME: ${path.basename(it.file)}`);
    }
    lines.push('');
    rec += n;
  });
  return lines.join('\r\n');
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fcpxml(title, items, { fps = 24, width = 1920, height = 1080 } = {}) {
  const fd = `100/${fps * 100}s`;
  const rt = (sec) => `${Math.round(sec * fps) * 100}/${fps * 100}s`;
  const fmts = [`<format id="r0" name="FFVideoFormat${height}p${fps}" frameDuration="${fd}" width="${width}" height="${height}"/>`];
  const assets = items.map((it, i) => `<asset id="a${i + 1}" name="${esc(path.basename(it.file))}" start="0s" duration="${rt(it.duration_s)}" hasVideo="1" hasAudio="${it.has_audio ? 1 : 0}" format="r0"><media-rep kind="original-media" src="${esc(pathToFileURL(it.file).href)}"/></asset>`);
  let off = 0;
  const clips = items.map((it, i) => {
    const c = `<asset-clip ref="a${i + 1}" name="${esc(it.shot_title || path.basename(it.file))}" offset="${rt(off)}" start="0s" duration="${rt(it.duration_s)}" format="r0"><note>${esc(it.scene_heading ?? '')}</note></asset-clip>`;
    off += Math.round(it.duration_s * fps) / fps;
    return c;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    ${fmts.join('\n    ')}
    ${assets.join('\n    ')}
  </resources>
  <library>
    <event name="${esc(title)}">
      <project name="${esc(title)}">
        <sequence format="r0" duration="${rt(off)}" tcStart="3600s" tcFormat="NDF">
          <spine>
            ${clips.join('\n            ')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

export function otio(title, items, fps = 24) {
  const rt = (v) => ({ OTIO_SCHEMA: 'RationalTime.1', rate: fps, value: v });
  const range = (start, dur) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rt(start), duration: rt(dur) });
  return JSON.stringify({
    OTIO_SCHEMA: 'Timeline.1', name: title, global_start_time: rt(3600 * fps), metadata: {},
    tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: [{
      OTIO_SCHEMA: 'Track.1', name: 'V1', kind: 'Video', metadata: {},
      children: items.map((it) => {
        const n = Math.round(it.duration_s * fps);
        return { OTIO_SCHEMA: 'Clip.2', name: it.shot_title || path.basename(it.file), source_range: range(0, n), metadata: { studio: { scene: it.scene_heading, job_id: it.job_id } },
          media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', target_url: pathToFileURL(it.file).href, available_range: range(0, n), metadata: {} } },
          active_media_reference_key: 'DEFAULT_MEDIA' };
      }),
    }] },
  }, null, 2);
}
