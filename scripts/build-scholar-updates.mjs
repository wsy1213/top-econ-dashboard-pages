import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'scholar-registry.json');
const AUTHOR_ID_FILE = path.join(DATA_DIR, 'scholar-author-ids.json');
const OUT_FILE = path.join(DATA_DIR, 'scholar-updates.json');
const HISTORY_DIR = path.join(DATA_DIR, 'scholar-history');
const DAYS_BACK = Number(process.env.SCHOLAR_UPDATE_DAYS || 8);
const REQUEST_TIMEOUT_MS = Number(process.env.SCHOLAR_REQUEST_TIMEOUT_MS || 20000);
const CONCURRENCY = Math.max(1, Number(process.env.SCHOLAR_FETCH_CONCURRENCY || 1));
const MIN_REQUEST_INTERVAL_MS = Number(process.env.SCHOLAR_REQUEST_INTERVAL_MS || 1100);
const SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || '';
let nextRequestAt = 0;

const TOPICS = [
  ['中国宏观与增长', /china|chinese|macroeconom|growth|business cycle|monetary/i],
  ['贸易与全球化', /trade|tariff|export|import|supply chain|global value chain|wto/i],
  ['产业与企业', /firm|industry|manufactur|innovation|productivity|subsid/i],
  ['金融与公司', /finance|bank|credit|bond|stock|capital market|corporate/i],
  ['劳动与人口', /labor|labour|wage|employment|migration|population|education|health/i],
  ['公共财政与政策', /tax|fiscal|government|public|regulation|policy|welfare/i],
  ['环境与能源', /environment|climate|pollution|carbon|energy/i],
  ['城市与空间', /urban|city|housing|land|spatial|regional|transport/i],
  ['经济史与政治经济', /history|historical|political economy|institution/i]
];

function normalized(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nameTokens(value = '') {
  return String(value).toLowerCase().match(/[a-z]+/g) || [];
}

function dateKey(daysBack) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const waitMs = Math.max(0, nextRequestAt - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Top-Econ-Scholar-Dashboard/1.0 (research monitor)',
        ...(SEMANTIC_SCHOLAR_API_KEY ? { 'x-api-key': SEMANTIC_SCHOLAR_API_KEY } : {})
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function semanticScholarUrl(pathname, params) {
  const url = new URL(`https://api.semanticscholar.org/graph/v1/${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, String(value));
  }
  return url;
}

function candidateScore(scholar, candidate) {
  const target = normalized(scholar.name);
  const actual = normalized(candidate.name);
  if (!target || !actual) return -100;
  let score = target === actual ? 100 : 0;
  const targetTokens = nameTokens(scholar.name);
  const actualTokens = nameTokens(candidate.name);
  if (targetTokens.length && actualTokens.length
    && targetTokens.every((token) => actualTokens.includes(token))) score += 25;

  const institution = String(scholar.institution || '').toLowerCase();
  const candidateInstitutions = (candidate.affiliations || []).map((item) => String(item || '').toLowerCase());
  if (institution && candidateInstitutions.some((item) => item && (institution.includes(item) || item.includes(institution)))) {
    score += 30;
  }
  return score;
}

async function resolveAuthor(scholar) {
  const data = await fetchJson(semanticScholarUrl('author/search', {
    query: scholar.name,
    limit: 10,
    fields: 'name,affiliations,paperCount'
  }));
  const ranked = (data.data || [])
    .map((candidate) => ({ candidate, score: candidateScore(scholar, candidate) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const exactNameCandidates = ranked.filter(({ candidate }) => normalized(candidate.name) === normalized(scholar.name));
  // A name-only match is safe only when the index returns one exact candidate.
  // When names collide, require corroborating institution evidence.
  const minimumScore = exactNameCandidates.length === 1 ? 125 : 155;
  if (!best || best.score < minimumScore) return '';
  return best.candidate.authorId || '';
}

function classify(title, abstract) {
  const text = `${title || ''} ${abstract || ''}`;
  const tags = TOPICS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  return tags.length ? tags.slice(0, 3) : ['其他经济研究'];
}

function authorMatchesWork(work, authorId) {
  return (work.authors || []).some((author) => author.authorId === authorId);
}

function workUrl(work) {
  return work.externalIds?.DOI ? `https://doi.org/${work.externalIds.DOI}` : work.url || '';
}

function workType(work) {
  const types = work.publicationTypes || [];
  if (types.includes('Preprint')) return '预印本';
  if (types.includes('JournalArticle')) return '期刊论文';
  if (types.includes('BookChapter')) return '书籍章节';
  return '研究成果';
}

function isScholarlyWork(work) {
  const allowed = new Set(['JournalArticle', 'Preprint', 'BookChapter', 'Review', 'Report']);
  return (work.publicationTypes || []).some((type) => allowed.has(type));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function mapWithConcurrency(items, worker) {
  const results = [];
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
}

async function main() {
  const registry = await readJson(REGISTRY_FILE, null);
  if (!registry?.scholars?.length) {
    throw new Error(`Scholar registry missing or empty: ${REGISTRY_FILE}`);
  }

  const previous = await readJson(OUT_FILE, { records: [] });
  const authorCache = await readJson(AUTHOR_ID_FILE, { version: 3, authors: {} });
  const authorIds = authorCache.version === 3 ? authorCache.authors || {} : {};
  const previousKeys = new Set((previous.records || []).map((record) => record.key));
  const fromDate = dateKey(DAYS_BACK);
  const records = [];
  const unresolved = [];

  const scanResults = await mapWithConcurrency(registry.scholars, async (scholar) => {
    try {
      const authorId = authorIds[scholar.name] || await resolveAuthor(scholar);
      if (!authorId) {
        return { unresolved: { name: scholar.name, reason: '身份匹配置信度不足' } };
      }
      authorIds[scholar.name] = authorId;
      const works = await fetchJson(semanticScholarUrl(`author/${authorId}/papers`, {
        limit: 100,
        fields: 'title,abstract,authors,year,publicationDate,publicationTypes,externalIds,url,venue'
      }));
      const scholarRecords = [];
      for (const work of works.data || []) {
        if (!authorMatchesWork(work, authorId) || !isScholarlyWork(work)) continue;
        const publicationDate = work.publicationDate || (work.year ? `${work.year}-01-01` : '');
        if (!publicationDate || publicationDate < fromDate) continue;
        const key = `${scholar.name}|${normalized(work.externalIds?.DOI || work.title)}`;
        const abstract = work.abstract || '';
        scholarRecords.push({
          key,
          scholar: scholar.name,
          scholarZh: scholar.nameZh || '',
          institution: scholar.institution || '',
          homepage: scholar.homepage || '',
          title: work.title || 'Untitled',
          date: publicationDate,
          type: workType(work),
          url: workUrl(work),
          source: 'Semantic Scholar',
          tags: classify(work.title, abstract),
          abstract: abstract.slice(0, 520),
          isNew: !previousKeys.has(key)
        });
      }
      return { records: scholarRecords };
    } catch (error) {
      return { unresolved: { name: scholar.name, reason: error.message } };
    }
  });

  for (const result of scanResults) {
    if (result?.unresolved) unresolved.push(result.unresolved);
    records.push(...(result?.records || []));
  }

  const unique = new Map();
  for (const record of records) unique.set(record.key, record);
  const sorted = [...unique.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const nowIso = new Date().toISOString();
  const payload = {
    generatedAt: nowIso,
    windowStart: fromDate,
    scholarCount: registry.scholars.length,
    records: sorted,
    newRecordCount: sorted.filter((record) => record.isNew).length,
    unresolved
  };

  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.writeFile(AUTHOR_ID_FILE, `${JSON.stringify({ version: 3, authors: authorIds }, null, 2)}\n`, 'utf8');
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(HISTORY_DIR, `${nowIso.slice(0, 10)}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Scholar scan complete: ${sorted.length} papers, ${unresolved.length} unresolved scholars.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
