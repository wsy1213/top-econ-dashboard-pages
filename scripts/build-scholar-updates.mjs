import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
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
const INITIAL_LOOKBACK_DAYS = Math.max(1, Number(process.env.SCHOLAR_INITIAL_LOOKBACK_DAYS || 180));
const USER_AGENT = 'China-Economist-Monitor/1.0 (academic homepage monitor)';

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

function initialCutoff() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - INITIAL_LOOKBACK_DAYS);
  return date.toISOString().slice(0, 10);
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

function topicTags(scholar, title) {
  const fromRegistry = String(scholar.chinaTopic || '')
    .split(/[、,，;；/|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (fromRegistry.length) return fromRegistry;
  if (/china|chinese|中国/i.test(title)) return ['中国经济研究'];
  return ['经济学研究'];
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
      tags: topicTags(scholar, anchor.text)
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

async function main() {
  const registry = await readJson(REGISTRY_FILE, null);
  if (!registry?.scholars?.length) throw new Error(`Scholar registry missing or empty: ${REGISTRY_FILE}`);
  const cache = await readJson(CACHE_FILE, { version: 1, seen: {} });
  const hadBaseline = Object.keys(cache.seen || {}).length > 0;
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
  const records = hadBaseline
    ? allRecords.filter((record) => record.isNew)
    : allRecords.filter((record) => record.date && record.date >= initialCutoff());
  for (const key of unique.keys()) cache.seen[key] ||= nowIso;
  const payload = {
    generatedAt: nowIso,
    source: '学者个人主页及其 Research / Publications / Working Papers 页面',
    scholarCount: registry.scholars.length,
    scannedScholarCount: registry.scholars.length,
    checkedCount,
    records,
    newRecordCount: records.length,
    initialScan: !hadBaseline,
    initialLookbackDays: !hadBaseline ? INITIAL_LOOKBACK_DAYS : undefined,
    failures
  };
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, `${JSON.stringify({ version: 1, seen: cache.seen }, null, 2)}\n`, 'utf8');
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(HISTORY_DIR, `${nowIso.slice(0, 10)}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Homepage scan complete: ${checkedCount}/${registry.scholars.length} homepages checked, ${records.length} visible records, ${failures.length} failures.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
