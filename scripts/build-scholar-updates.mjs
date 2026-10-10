import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'scholar-registry.json');
const CACHE_FILE = path.join(DATA_DIR, 'scholar-homepage-cache.json');
const OUT_FILE = path.join(DATA_DIR, 'scholar-updates.json');
const HISTORY_DIR = path.join(DATA_DIR, 'scholar-history');
const REQUEST_TIMEOUT_MS = Number(process.env.SCHOLAR_REQUEST_TIMEOUT_MS || 12000);
const CONCURRENCY = Math.max(1, Number(process.env.HOMEPAGE_FETCH_CONCURRENCY || 6));
const MAX_DETAIL_PAGES = Math.max(0, Number(process.env.SCHOLAR_DETAIL_PAGES || 2));
const USER_AGENT = 'China-Economist-Monitor/1.0 (academic homepage monitor)';
const PDF_TEXT_TIMEOUT_MS = Number(process.env.SCHOLAR_PDF_TEXT_TIMEOUT_MS || 45000);
const PDF_MAX_BYTES = Number(process.env.SCHOLAR_PDF_MAX_BYTES || 16 * 1024 * 1024);
const BACKFILL_ENABLED = process.env.SCHOLAR_BACKFILL === '1';
const BACKFILL_DAYS = [30, 60, 90];
const BACKFILL_CANDIDATE_DAYS = Number(process.env.SCHOLAR_BACKFILL_CANDIDATE_DAYS || 120);
const BACKFILL_MAX_CANDIDATES = Number(process.env.SCHOLAR_BACKFILL_MAX_CANDIDATES || 80);
const ARCHIVE_TIMEOUT_MS = Number(process.env.SCHOLAR_ARCHIVE_TIMEOUT_MS || 10000);
const execFileAsync = promisify(execFile);

const PUBLICATION_PAGE = /publications?|papers?|working[ -]?papers?|writing|论文|发表|工作论文/i;
const PAPER_URL = /doi\.org|nber\.org\/papers|ssrn\.com|arxiv\.org|ideas\.repec\.org|cepr\.org|\.pdf(?:$|[?#])/i;
const GENERIC_LINK = /^(home|about|research|publications?|papers?|working papers?|cv|curriculum vitae|download cv|google scholar|contact|teaching|news|more|read more|here|主页|关于|研究|论文|发表|工作论文|简历|联系)$/i;

function cleanText(value = '') {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeUrl(value = '') {
  try {
    return decodeURIComponent(value.replace(/&amp;/g, '&'));
  } catch {
    return value.replace(/&amp;/g, '&');
  }
}

function normalKey(value = '') {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function shortHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function absoluteUrl(href, sourceUrl) {
  try {
    const url = new URL(decodeUrl(href), sourceUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function dateWithinDays(dateValue, days) {
  if (!/^20\d{2}-\d{2}(?:-\d{2})?$/.test(String(dateValue || ''))) return false;
  return String(dateValue) >= dateDaysAgo(days).toISOString().slice(0, 10);
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/html|xml|text/i.test(contentType)) throw new Error(`Unsupported content type: ${contentType}`);
    return { url: response.url, html: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPdfText(url) {
  if (!/\.pdf(?:$|[?#])/i.test(url)) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TEXT_TIMEOUT_MS);
  let tempDir = '';
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf' },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
    const pdf = Buffer.from(await response.arrayBuffer());
    if (!pdf.length || pdf.length > PDF_MAX_BYTES) throw new Error('PDF is empty or too large');
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-abstract-'));
    const pdfFile = path.join(tempDir, 'paper.pdf');
    await fs.writeFile(pdfFile, pdf);
    const { stdout } = await execFileAsync('pdftotext', ['-f', '1', '-l', '3', '-layout', pdfFile, '-'], {
      timeout: PDF_TEXT_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024
    });
    return stdout;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function extractAbstract(pdfText) {
  const text = String(pdfText || '').replace(/\r/g, '').replace(/\f/g, '\n');
  const start = text.match(/\babstract\b\s*[:.—-]?\s*([\s\S]{180,7000})/i);
  if (!start) return '';
  const raw = start[1].split(/\b(?:keywords?|jel\s*(?:classification|codes?)?|1\.?\s+introduction|i\.?\s+introduction)\b/i)[0];
  const abstract = raw.replace(/\s+/g, ' ').trim();
  return abstract.length >= 180 && abstract.length <= 6000 ? abstract : '';
}

async function translateAbstract(abstract) {
  const text = String(abstract || '').trim();
  if (!text) return '';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return '';
    const payload = await response.json();
    return Array.isArray(payload?.[0]) ? payload[0].map((part) => part?.[0] || '').join('').trim() : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function archiveSnapshotNear(url, targetDate) {
  const query = new URL('https://archive.org/wayback/available');
  query.searchParams.set('url', url);
  query.searchParams.set('timestamp', targetDate.toISOString().slice(0, 10).replaceAll('-', ''));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS);
  try {
    const response = await fetch(query, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!response.ok) return null;
    const snapshot = (await response.json())?.archived_snapshots?.closest;
    if (!snapshot?.available || !/^\d{14}$/.test(String(snapshot.timestamp || ''))) return null;
    const snapshotDate = new Date(`${snapshot.timestamp.slice(0, 4)}-${snapshot.timestamp.slice(4, 6)}-${snapshot.timestamp.slice(6, 8)}T12:00:00Z`);
    const gapInDays = Math.abs(snapshotDate.getTime() - targetDate.getTime()) / 86400000;
    // A closest snapshot outside this narrow window cannot establish recent first appearance.
    if (gapInDays > 10) return null;
    return { timestamp: snapshot.timestamp, original: url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function wasAbsentFromArchivedPage(record) {
  if (!dateWithinDays(record.date, BACKFILL_CANDIDATE_DAYS) || !record.sourcePage) return null;
  const snapshots = [];
  for (const days of BACKFILL_DAYS) {
    const snapshot = await archiveSnapshotNear(record.sourcePage, dateDaysAgo(days));
    if (!snapshot || snapshots.some((item) => item.timestamp === snapshot.timestamp)) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS);
    try {
      const response = await fetch(`https://web.archive.org/web/${snapshot.timestamp}id_/${snapshot.original}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal
      });
      if (!response.ok) continue;
      snapshots.push({ ...snapshot, html: await response.text() });
    } catch {
      // A missing archive response is not evidence of absence.
    } finally {
      clearTimeout(timer);
    }
  }
  if (snapshots.length < 2) return null;
  const key = normalKey(record.title);
  if (!key || snapshots.some((snapshot) => normalKey(snapshot.html).includes(key))) return null;
  return snapshots.map((snapshot) => snapshot.timestamp);
}

function anchorsFromHtml(html, sourceUrl) {
  const anchors = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i) || match[1].match(/\bhref\s*=\s*([^\s>]+)/i);
    if (!hrefMatch) continue;
    const href = absoluteUrl(hrefMatch[2] || hrefMatch[1], sourceUrl);
    const text = cleanText(match[2]);
    if (href && text) anchors.push({ href, text });
  }
  return anchors;
}

function isSameSite(url, homepage) {
  try {
    return new URL(url).hostname === new URL(homepage).hostname;
  } catch {
    return false;
  }
}

function detailPageUrls(homepage, anchors) {
  const urls = [];
  const homepageUrl = new URL(homepage);
  const personalPrefix = homepageUrl.pathname.endsWith('/') ? homepageUrl.pathname : `${homepageUrl.pathname}/`;
  const isRootHomepage = homepageUrl.pathname === '/';
  for (const anchor of anchors) {
    if (!PUBLICATION_PAGE.test(`${anchor.text} ${anchor.href}`)) continue;
    if (!isSameSite(anchor.href, homepage)) continue;
    const candidateUrl = new URL(anchor.href);
    if (!isRootHomepage && !candidateUrl.pathname.startsWith(personalPrefix)) continue;
    if (!urls.some((entry) => entry.href === anchor.href) && anchor.href !== homepage) {
      const score = (candidateUrl.pathname.startsWith(personalPrefix) ? 20 : 0)
        + (/working[ -]?papers?/i.test(`${anchor.text} ${anchor.href}`) ? 8 : 0)
        + (/publications?|papers?/i.test(`${anchor.text} ${anchor.href}`) ? 5 : 0);
      urls.push({ href: anchor.href, score });
    }
  }
  return urls.sort((a, b) => b.score - a.score).slice(0, MAX_DETAIL_PAGES).map((entry) => entry.href);
}

function titleLooksLikePaper(title) {
  const words = title.match(/[A-Za-z]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  return title.length >= 18 && title.length <= 360 && words.length >= 3 && !GENERIC_LINK.test(title);
}

function extractDateNearLink(html, title) {
  const position = html.toLowerCase().indexOf(title.toLowerCase());
  if (position < 0) return '';
  const context = cleanText(html.slice(Math.max(0, position - 180), position + title.length + 180));
  const match = context.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?\b/);
  if (!match) return '';
  return match[3]
    ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
    : `${match[1]}-${String(match[2]).padStart(2, '0')}`;
}

function paperMetadata(title, abstract = '') {
  const text = `${cleanText(title)} ${cleanText(abstract)}`.toLowerCase();
  if (/asset privatization|intergenerational redistribution/.test(text)) {
    return { tags: ['公共经济', '代际分配'] };
  }
  if (/malpractice|physician|risk perception/.test(text)) {
    return { tags: ['卫生经济', '风险与激励'] };
  }
  if (/decoding china.*industrial polic/.test(text)) {
    return { tags: ['中国产业政策', '政治经济学'] };
  }
  if (/baby bust|demographic change|growth boom/.test(text)) {
    return { tags: ['人口经济学', '宏观增长'] };
  }
  if (/employment.*community|community.*employment/.test(text)) {
    return { tags: ['劳动经济学', '社会资本'] };
  }
  if (/artificial intelligence|\bai\b|human cognition|knowledge collapse/.test(text)) {
    return { tags: ['人工智能', '创新与增长'] };
  }
  if (/machine learning|incentive failures?/.test(text)) {
    return { tags: ['人工智能', '激励机制'] };
  }
  if (/workforce development/.test(text)) {
    return { tags: ['发展经济学', '人力资本'] };
  }
  if (/trade|tariff|export|import/.test(text)) {
    return { tags: ['国际贸易'] };
  }
  if (/china|chinese|中国/.test(text)) {
    return { tags: ['中国经济'] };
  }
  return { tags: ['经济学研究'] };
}

function candidateRecords(scholar, page, allowTitleOnly) {
  const results = [];
  const seen = new Set();
  for (const anchor of anchorsFromHtml(page.html, page.url)) {
    const isPaperLink = PAPER_URL.test(anchor.href);
    if (!isPaperLink && !(allowTitleOnly && titleLooksLikePaper(anchor.text))) continue;
    if (GENERIC_LINK.test(anchor.text)) continue;
    const key = `${scholar.name}|${normalKey(anchor.text) || shortHash(anchor.href)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      key,
      scholar: scholar.name,
      scholarZh: scholar.nameZh || '',
      institution: scholar.institution || '',
      homepage: scholar.homepage || '',
      title: anchor.text,
      date: extractDateNearLink(page.html, anchor.text),
      type: /working|nber|ssrn|arxiv|工作论文/i.test(`${anchor.href} ${page.url}`) ? '工作论文' : '论文 / 研究成果',
      url: anchor.href,
      source: '学者主页',
      sourcePage: page.url,
      tags: [],
      abstractEn: '',
      abstractZh: ''
    });
  }
  return results;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
}

async function scanScholar(scholar) {
  if (!scholar.homepage) return { failed: { name: scholar.name, reason: '未提供个人主页' } };
  try {
    const homepage = await fetchPage(scholar.homepage);
    const pages = [{ ...homepage, isPublicationPage: false }];
    const details = detailPageUrls(homepage.url, anchorsFromHtml(homepage.html, homepage.url));
    const detailResults = await Promise.allSettled(details.map(fetchPage));
    for (const result of detailResults) {
      if (result.status === 'fulfilled') pages.push({ ...result.value, isPublicationPage: true });
    }
    const unique = new Map();
    for (const page of pages) {
      for (const record of candidateRecords(scholar, page, page.isPublicationPage)) unique.set(record.key, record);
    }
    return { records: [...unique.values()], pageCount: pages.length };
  } catch (error) {
    return { failed: { name: scholar.name, reason: error.name === 'AbortError' ? '请求超时' : error.message } };
  }
}

async function enrichNewRecord(record) {
  const abstractEn = extractAbstract(await fetchPdfText(record.url));
  if (!abstractEn) return null;
  const abstractZh = await translateAbstract(abstractEn);
  if (!abstractZh) return null;
  return {
    ...record,
    tags: paperMetadata(record.title, abstractEn).tags,
    abstractEn,
    abstractZh
  };
}

async function main() {
  const registry = await readJson(REGISTRY_FILE, null);
  if (!registry?.scholars?.length) throw new Error(`Scholar registry missing or empty: ${REGISTRY_FILE}`);
  const cache = await readJson(CACHE_FILE, { version: 2, seen: {}, pending: {} });
  cache.seen ||= {};
  cache.pending ||= {};
  const hadBaseline = Boolean(cache.baselineEstablishedAt) || Object.keys(cache.seen).length > 0;
  const scanResults = await mapWithConcurrency(registry.scholars, scanScholar);
  const candidates = [];
  const failures = [];
  let checkedCount = 0;
  for (const result of scanResults) {
    if (result?.failed) failures.push(result.failed);
    if (result?.pageCount) checkedCount += 1;
    candidates.push(...(result?.records || []));
  }
  const unique = new Map();
  for (const record of candidates) unique.set(record.key, record);
  const nowIso = new Date().toISOString();
  const allRecords = [...unique.values()]
    .map((record) => ({ ...record, isNew: !cache.seen[record.key] }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.scholar.localeCompare(b.scholar));

  const detectedNow = hadBaseline && !BACKFILL_ENABLED ? allRecords.filter((record) => record.isNew) : [];
  for (const key of unique.keys()) cache.seen[key] ||= nowIso;
  if (!hadBaseline) cache.baselineEstablishedAt = nowIso;

  for (const record of detectedNow) {
    cache.pending[record.key] ||= { ...record, firstDetectedAt: nowIso };
  }
  const pendingRecords = Object.values(cache.pending);
  const enriched = await mapWithConcurrency(pendingRecords, async (record) => enrichNewRecord(record));
  const records = enriched.filter(Boolean).map((record) => ({
    ...record,
    firstDetectedAt: cache.pending[record.key].firstDetectedAt
  }));
  for (const record of records) delete cache.pending[record.key];

  if (BACKFILL_ENABLED) {
    const candidates = allRecords
      .filter((record) => dateWithinDays(record.date, BACKFILL_CANDIDATE_DAYS))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, BACKFILL_MAX_CANDIDATES);
    const archiveChecks = await mapWithConcurrency(candidates, async (record) => ({
      record,
      snapshots: await wasAbsentFromArchivedPage(record)
    }));
    const backfillCandidates = archiveChecks
      .filter((item) => item.snapshots)
      .map((item) => ({ ...item.record, archiveSnapshots: item.snapshots }));
    const backfillEnriched = await mapWithConcurrency(backfillCandidates, async (record) => enrichNewRecord(record));
    for (let index = 0; index < backfillEnriched.length; index += 1) {
      const record = backfillEnriched[index];
      if (!record) continue;
      records.push({
        ...record,
        firstDetectedAt: nowIso,
        detection: 'archive-backfill',
        archiveSnapshots: backfillCandidates[index].archiveSnapshots
      });
    }
  }
  const payload = {
    generatedAt: nowIso,
    source: '学者个人主页及其 Research / Publications / Working Papers 页面',
    scholarCount: registry.scholars.length,
    scannedScholarCount: registry.scholars.length,
    checkedCount,
    records,
    newRecordCount: records.length,
    baselineEstablished: Boolean(cache.baselineEstablishedAt),
    pendingAbstractCount: Object.keys(cache.pending).length,
    backfill: BACKFILL_ENABLED,
    failures
  };
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, `${JSON.stringify({
    version: 2,
    baselineEstablishedAt: cache.baselineEstablishedAt,
    seen: cache.seen,
    pending: cache.pending
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(HISTORY_DIR, `${nowIso.slice(0, 10)}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Homepage scan complete: ${checkedCount}/${registry.scholars.length} homepages checked, ${records.length} visible records, ${failures.length} failures.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
