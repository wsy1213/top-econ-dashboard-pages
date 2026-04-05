import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DATA_DIR = path.join(ROOT, 'public', 'data');
const OUT_FILE = path.join(PUBLIC_DATA_DIR, 'site-data.json');
const ARCHIVE_FILE = path.join(PUBLIC_DATA_DIR, 'archive-data.json');
const TRANSLATION_CACHE_FILE = path.join(PUBLIC_DATA_DIR, 'translation-cache.json');
const HISTORY_DIR = path.join(PUBLIC_DATA_DIR, 'history');

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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。、“”"':：;；,.!?！？()（）\[\]{}<>《》]/g, '')
    .trim();
}

function articleKey(article) {
  const doi = normalizeText(article?.doi || '');
  if (doi) return `doi:${doi}`;

  const title = normalizeText(article?.title || '');
  const authors = normalizeText(article?.authors || '');
  if (title && authors) return `ta:${title}|${authors}`;
  if (title) return `t:${title}`;

  const url = normalizeText(article?.url || '');
  if (url) return `u:${url}`;
  return '';
}

function parseSortableTime(value) {
  const ts = new Date(value || '').getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function sortArticlesForDisplay(articles) {
  return [...articles].sort((a, b) => {
    const ta = parseSortableTime(a.date);
    const tb = parseSortableTime(b.date);
    if (ta !== tb) return tb - ta;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

async function readJsonOrDefault(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mergeArchive(existingArchive, latestPayload, nowIso) {
  const sourceMap = new Map();
  const existingSources = Array.isArray(existingArchive?.sources) ? existingArchive.sources : [];
  for (const source of existingSources) {
    sourceMap.set(source.id, {
      id: source.id,
      name: source.name,
      language: source.language,
      sourceUrl: source.sourceUrl || '',
      latestIssue: source.latestIssue || '',
      articles: Array.isArray(source.articles) ? [...source.articles] : []
    });
  }

  for (const latestSource of latestPayload.sources || []) {
    const current = sourceMap.get(latestSource.id) || {
      id: latestSource.id,
      name: latestSource.name,
      language: latestSource.language,
      sourceUrl: latestSource.sourceUrl || '',
      latestIssue: latestSource.latestIssue || '',
      articles: []
    };
    current.name = latestSource.name;
    current.language = latestSource.language;
    current.sourceUrl = latestSource.sourceUrl || current.sourceUrl || '';
    current.latestIssue = latestSource.latestIssue || current.latestIssue || '';

    const byKey = new Map(current.articles.map((a) => [articleKey(a), a]));
    for (const article of latestSource.articles || []) {
      const key = articleKey(article);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        existing.title = article.title || existing.title;
        existing.url = article.url || existing.url;
        existing.authors = article.authors || existing.authors || '';
        existing.date = article.date || existing.date || '';
        existing.articleType = article.articleType || existing.articleType || 'latest_issue';
        existing.lastSeen = nowIso;
        existing.seenCount = Number(existing.seenCount || 1) + 1;
      } else {
        byKey.set(key, {
          title: article.title || '',
          url: article.url || '',
          authors: article.authors || '',
          date: article.date || '',
          articleType: article.articleType || 'latest_issue',
          firstSeen: nowIso,
          lastSeen: nowIso,
          seenCount: 1
        });
      }
    }

    current.articles = sortArticlesForDisplay(Array.from(byKey.values()));
    sourceMap.set(latestSource.id, current);
  }

  const sources = Array.from(sourceMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const archivePayload = {
    generatedAt: nowIso,
    totals: {
      all: sources.length,
      ok: sources.filter((s) => (s.articles || []).length > 0).length,
      error: 0
    },
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      language: s.language,
      status: (s.articles || []).length ? 'ok' : 'empty',
      latestIssue: `Archive: ${(s.articles || []).length} papers`,
      sourceUrl: s.sourceUrl || '',
      articles: s.articles || []
    }))
  };

  return {
    archiveData: {
      updatedAt: nowIso,
      sources
    },
    archivePayload
  };
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

    const nowIso = new Date().toISOString();
    const existingArchive = await readJsonOrDefault(ARCHIVE_FILE, { updatedAt: '', sources: [] });
    const { archiveData, archivePayload } = mergeArchive(existingArchive, payload, nowIso);

    const translationCache = await readJsonOrDefault(TRANSLATION_CACHE_FILE, {});
    const archiveTitles = collectEnglishTitles(archivePayload);
    const missingTitles = archiveTitles.filter((t) => !translationCache[t]);
    let translatedNow = {};
    if (missingTitles.length) {
      const trRes = await fetch(`${BASE}/api/translate-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titles: missingTitles })
      });
      if (trRes.ok) {
        const trData = await trRes.json();
        translatedNow = trData?.translations || {};
      }
    }
    const translations = { ...translationCache, ...translatedNow };

    await fs.mkdir(PUBLIC_DATA_DIR, { recursive: true });
    await fs.mkdir(HISTORY_DIR, { recursive: true });

    const dayKey = nowIso.slice(0, 10);
    const historyFile = path.join(HISTORY_DIR, `${dayKey}.json`);

    await fs.writeFile(
      OUT_FILE,
      JSON.stringify({ payload, archivePayload, translations }, null, 2),
      'utf8'
    );
    await fs.writeFile(ARCHIVE_FILE, JSON.stringify(archiveData, null, 2), 'utf8');
    await fs.writeFile(TRANSLATION_CACHE_FILE, JSON.stringify(translations, null, 2), 'utf8');
    await fs.writeFile(historyFile, JSON.stringify({ payload, archivePayload, translations }, null, 2), 'utf8');
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
