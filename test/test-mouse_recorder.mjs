import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function resolveRecordingPath() {
  const configured = String(process.env.MOUSE_RECORDING_PATH || '').trim();
  if (!configured) return null;
  return resolve(process.cwd(), configured);
}

export function loadMouseRecording(filePath) {
  const path = filePath || resolveRecordingPath();
  if (!path || !existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.events)) {
      console.log(`  Mouse kaydi gecersiz (events dizisi yok): ${path}`);
      return null;
    }
    return data;
  } catch (err) {
    console.log(`  Mouse kaydi okunamadi: ${err.message}`);
    return null;
  }
}

export async function replayMouseRecording(page, recording, options = {}) {
  if (!recording || !Array.isArray(recording.events) || recording.events.length === 0) {
    return false;
  }

  const { speed = 1.0, maxDurationMs = 60000 } = options;
  const events = recording.events;
  const startTime = Date.now();
  const pendingButtons = new Set();

  console.log(`  Mouse kaydi oynatiliyor: ${events.length} event, hiz: ${speed}x`);

  for (const ev of events) {
    const elapsed = Date.now() - startTime;
    if (elapsed > maxDurationMs) {
      console.log('  Mouse kaydi maksimum sureye ulasti, durduruluyor.');
      break;
    }

    const targetTime = startTime + (ev.t / speed);
    const wait = targetTime - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }

    const { type, x, y, button = 'left' } = ev;

    try {
      if (type === 'move') {
        await page.mouse.move(x, y);
      } else if (type === 'down') {
        await page.mouse.down({ button });
        pendingButtons.add(button);
      } else if (type === 'up') {
        await page.mouse.up({ button });
        pendingButtons.delete(button);
      }
    } catch (err) {
      console.log(`  Mouse oynatma hatasi (${type}): ${err.message}`);
    }
  }

  for (const button of pendingButtons) {
    try {
      await page.mouse.up({ button });
    } catch {}
  }

  console.log('  Mouse kaydi oynatimi tamamlandi.');
  return true;
}

export function hasMouseRecording() {
  return !!loadMouseRecording();
}
