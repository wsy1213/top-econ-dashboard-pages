import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DATA_DIR = path.join(ROOT, 'public', 'data');
const OUT_FILE = path.join(PUBLIC_DATA_DIR, 'site-data.json');

const HOST = '127.0.0.1';
const PORT = Number(process.env.STATIC_BUILD_PORT || 3100);
const BASE = `http://${HOST}:${PORT}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectEnglishTitles(payload) {
  const titles = [];
  for (const source of payload.sources || []) {
    if (source.language !== 'en') continue;
    for (const article of source.articles || []) {
      if (!article?.title) continue;
      const clean = String(article.title)
        .replace(/\s*(?:--|—|-|,|;)\s*by\s+.+$/i, '')
        .trim();
      if (clean) titles.push(clean);
    }
  }
  return titles;
}

async function waitForServer(timeoutMs = 180000) {
  const started = Date.now();
  let lastErr = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/latest`);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(1500);
  }
  throw new Error(`Server start timeout: ${lastErr?.message || 'unknown'}`);
}

async function main() {
  const env = {
    ...process.env,
    HOST,
    PORT: String(PORT)
  };

  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env,
    stdio: 'inherit'
  });

  try {
    await waitForServer();

    const latestRes = await fetch(`${BASE}/api/latest?force=1`, { cache: 'no-store' });
    if (!latestRes.ok) throw new Error(`latest API failed: HTTP ${latestRes.status}`);
    const payload = await latestRes.json();

    const titles = collectEnglishTitles(payload);
    let translations = {};
    if (titles.length) {
      const trRes = await fetch(`${BASE}/api/translate-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titles })
      });
      if (trRes.ok) {
        const trData = await trRes.json();
        translations = trData?.translations || {};
      }
    }

    await fs.mkdir(PUBLIC_DATA_DIR, { recursive: true });
    await fs.writeFile(
      OUT_FILE,
      JSON.stringify({ payload, translations }, null, 2),
      'utf8'
    );
    await fs.writeFile(path.join(ROOT, 'public', '.nojekyll'), '', 'utf8');
    console.log(`Static data written: ${OUT_FILE}`);
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

