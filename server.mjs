import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);
const FETCH_RETRIES = Number(process.env.FETCH_RETRIES || 3);
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 4);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);
const CROSSREF_MAILTO = process.env.CROSSREF_MAILTO || 'you@example.com';
const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || 12000);
const TRANSLATE_CACHE_TTL_MS = Number(process.env.TRANSLATE_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const CNKI_COOKIE = process.env.CNKI_COOKIE || '';
const CNKI_BROWSER_TIMEOUT_MS = Number(process.env.CNKI_BROWSER_TIMEOUT_MS || 90000);
const execFile = promisify(execFileCb);

const ENGLISH_JOURNALS = [
  { id: 'aer', name: 'American Economic Review', issn: '0002-8282' },
  { id: 'jpe', name: 'Journal of Political Economy', issn: '0022-3808' },
  { id: 'qje', name: 'The Quarterly Journal of Economics', issn: '0033-5533' },
  { id: 'econometrica', name: 'Econometrica', issn: '0012-9682' },
  { id: 'restud', name: 'The Review of Economic Studies', issn: '0034-6527' },
  { id: 'aej_macro', name: 'American Economic Journal: Macroeconomics', issn: '1945-7707' },
  { id: 'aej_micro', name: 'American Economic Journal: Microeconomics', issn: '1945-7669' },
  { id: 'aej_applied', name: 'American Economic Journal: Applied Economics', issn: '1945-7782' },
  { id: 'aej_policy', name: 'American Economic Journal: Economic Policy', issn: '1945-7731' },
  { id: 'restat', name: 'Review of Economics and Statistics', issn: '0034-6535' },
  { id: 'jpube', name: 'Journal of Public Economics', issn: '0047-2727' },
  { id: 'jinteco', name: 'Journal of International Economics', issn: '0022-1996' },
  {
    id: 'jebo',
    name: 'Journal of Economic Behavior and Organization',
    issns: ['0167-2681', '1879-1751']
  },
  { id: 'jde', name: 'Journal of Development Economics', issn: '0304-3878' },
  {
    id: 'jeem',
    name: 'Journal of Environmental Economics and Management',
    issns: ['0095-0696', '1096-0449']
  },
  { id: 'aer_insights', name: 'American Economic Review: Insights', issn: '2640-205X' },
  { id: 'rand', name: 'The RAND Journal of Economics', issn: '0741-6261' },
  { id: 'jole', name: 'Journal of Labor Economics', issn: '0734-306X' },
  {
    id: 'ej',
    name: 'The Economic Journal',
    issns: ['0013-0133', '1468-0297'],
    rows: 1000,
    minIssueArticles: 5
  },
  { id: 'jel', name: 'Journal of Economic Literature', issn: '0022-0515' },
  { id: 'jep', name: 'Journal of Economic Perspectives', issn: '0895-3309' }
];

const CHINESE_JOURNALS = [
  {
    id: 'zgshkx',
    name: '中国社会科学',
    mid: 'zgshk',
    useBrowserNavi: true,
    queryTitle: '中国社会科学',
    cnkiNaviUrl: 'https://navi.cnki.net/knavi/detail?p=5X5AH2tVvyCPFQWA_AzmT_EoaRSC-3duHupGwCV3RsM0dkbTQuQKsfQ51gwbby2GWTIPRHJ1vev_bw5pnWYM2unahOUlZrVyTBeQ-tHzZcc4u99tnSdmrQ==&uniplatform=NZKPT&language=CHS',
    cnkiCandidates: [
      'https://www.zgshk.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=zgshk&tp=gklb',
      'https://zgshk.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=zgshk&tp=gklb'
    ]
  },
  {
    id: 'jjyj',
    name: '经济研究',
    mid: 'jjyj',
    useBrowserNavi: true,
    queryTitle: '经济研究',
    cnkiNaviUrl: 'https://navi.cnki.net/knavi/detail?p=Mrr8WS28FcTdNvtuneLi8bT00A3zasqnJAYx6Zn4ZFiX0MHti1Gw0QVcY0NkFxoxQal1J4wpgtfyuAdeeXoYQ2DwWI7FD0d4ElXLoJFMFx5iaBgJobjdWw==&uniplatform=NZKPT&language=CHS',
    cnkiCandidates: [
      'https://www.jjyj.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=jjyj&tp=gklb',
      'https://jjyj.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=jjyj&tp=gklb'
    ]
  },
  {
    id: 'glsj',
    name: '管理世界',
    mid: 'glsj',
    useBrowserNavi: true,
    queryTitle: '管理世界',
    cnkiNaviUrl: 'https://navi.cnki.net/knavi/detail?p=ylphdrQqMu-2F3MiFYzbIOUOBNYhsJ1TmETlCoYHZ9ShkuDBnDX69bqqMN8PDWWUaxWiczdEf4NnrQCYQDgf5KDKnd1eRxjXaZA0UW887xTxiw3PD5h0mw==&uniplatform=NZKPT',
    cnkiCandidates: [
      'https://www.glsj.cbpt.cnki.net/WKB2/WebPublication/wkTextContent.aspx?colType=4&mid=glsj&tp=gklb',
      'https://glsj.cbpt.cnki.net/WKB2/WebPublication/wkTextContent.aspx?colType=4&mid=glsj&tp=gklb'
    ]
  },
  {
    id: 'jjxjk',
    name: '经济学季刊',
    mid: 'jjxjk',
    useBrowserNavi: true,
    queryTitle: '经济学季刊',
    cnkiNaviUrl: 'https://navi.cnki.net/knavi/detail?p=7DTYWqgL7DKd_eJ8nXYKpys1u-jbUM7OrL0PyvRadeRvQaIElXNJQ6v47Xvue25qhH1kSAPEQnEwYSDlhznQMhwo0pECcriC0bhBqiGo1wBGTxsdbXjzOw==&uniplatform=NZKPT',
    cnkiCandidates: [
      'https://www.jjxjk.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=jjxjk&tp=gklb',
      'https://jjxjk.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=jjxjk&tp=gklb',
      'https://www.jjxk.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=jjxk&tp=gklb'
    ]
  },
  {
    id: 'sjjj',
    name: '世界经济',
    mid: 'sjjj',
    useBrowserNavi: true,
    queryTitle: '世界经济',
    cnkiNaviUrl: 'https://navi.cnki.net/knavi/detail?p=mK1ZVKSnEbRN4zRKPbotVixY1zF5fyHv7mOpujeBn28Llrj29o2LnEmtlB8mcEYFEo4REWyJRhsQbLrQ-kZ0-vPe6in9PIY1-SFoA7vJyrgkANEDw5PC9g==&uniplatform=NZKPT&language=CHS',
    cnkiCandidates: [
      'https://www.sjjj.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=sjjj&tp=gklb',
      'https://sjjj.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=sjjj&tp=gklb',
      'https://www.jing.cbpt.cnki.net/WKB2/WebPublication/wkTextContent.aspx?colType=4&mid=jing&tp=gklb'
    ]
  },
  {
    id: 'jryj',
    name: '金融研究',
    mid: 'jryj',
    useBrowserNavi: true,
    queryTitle: '金融研究',
    cnkiNaviUrl: 'https://navi.cnki.net/knavi/detail?p=mK1ZVKSnEbTzGIisnUzuqouRd4uikbhFCyKF7IlJ2f2XDh1T15o4JfhIrXJTh62lgjkxmQOS4viepoahB1zQrm5t7nQkHjR0B41zxVvs44rQ_ZvEdx3RNA==&uniplatform=NZKPT&language=CHS',
    cnkiCandidates: [
      'https://www.jryj.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=jryj&tp=gklb',
      'https://jryj.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=jryj&tp=gklb'
    ]
  }
];

const NBER_SOURCE = {
  id: 'nber',
  name: 'NBER Working Papers',
  feedUrl: 'https://www.nber.org/rss/new.xml'
};

function parseDateFromCrossref(item) {
  const dateParts = item?.['published-print']?.['date-parts']?.[0]
    || item?.published?.['date-parts']?.[0]
    || item?.issued?.['date-parts']?.[0]
    || item?.created?.['date-parts']?.[0];

  if (!dateParts) return null;
  const [y, m = 1, d = 1] = dateParts;
  return new Date(Date.UTC(y, m - 1, d));
}

function parseOnlineDateFromCrossref(item) {
  const dateParts = item?.['published-online']?.['date-parts']?.[0]
    || item?.accepted?.['date-parts']?.[0];
  if (!dateParts) return null;
  const [y, m = 1, d = 1] = dateParts;
  return new Date(Date.UTC(y, m - 1, d));
}

function safeTitle(item) {
  if (!item?.title?.length) return 'Untitled';
  return item.title[0].replace(/\s+/g, ' ').trim();
}

function formatDate(date) {
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function buildCrossrefEndpoint(source) {
  const rows = Number(source.rows || 100);
  if (Array.isArray(source.issns) && source.issns.length) {
    return `https://api.crossref.org/journals/${encodeURIComponent(source.issns[0])}/works?sort=published&order=desc&rows=${rows}&filter=type:journal-article`;
  }
  if (source.issn) {
    return `https://api.crossref.org/journals/${encodeURIComponent(source.issn)}/works?sort=published&order=desc&rows=${rows}&filter=type:journal-article`;
  }
  const q = source.queryTitle || source.name;
  return `https://api.crossref.org/works?query.container-title=${encodeURIComponent(q)}&sort=published&order=desc&rows=120&filter=type:journal-article`;
}

function buildCrossrefFallbackEndpoint(source) {
  const q = source.queryTitle || source.name;
  return `https://api.crossref.org/works?query=${encodeURIComponent(q)}&sort=published&order=desc&rows=120&filter=type:journal-article`;
}

function normalize(str) {
  return (str || '').toLowerCase().replace(/[\s:：\-]/g, '');
}

function pickLatestIssue(items, options = {}) {
  const minIssueArticles = Number(options.minIssueArticles || 3);
  if (!items.length) {
    return { issueLabel: 'No data', selected: [] };
  }

  const enriched = items
    .map((item) => {
      const date = parseDateFromCrossref(item);
      return {
        raw: item,
        date,
        volume: item.volume || '',
        issue: item.issue || ''
      };
    })
    .sort((a, b) => {
      const ta = a.date ? a.date.getTime() : 0;
      const tb = b.date ? b.date.getTime() : 0;
      return tb - ta;
    });

  const withIssue = enriched.find((x) => x.volume || x.issue);
  let selected = [];
  let issueLabel = '';

  if (withIssue) {
    const grouped = new Map();
    for (const row of enriched) {
      const v = row.volume || '';
      const i = row.issue || '';
      if (!v && !i) continue;
      const key = `${v}||${i}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          volume: v,
          issue: i,
          items: [],
          latestTs: 0
        });
      }
      const g = grouped.get(key);
      g.items.push(row);
      const ts = row.date ? row.date.getTime() : 0;
      if (ts > g.latestTs) g.latestTs = ts;
    }

    const groups = Array.from(grouped.values()).sort((a, b) => b.latestTs - a.latestTs);
    const preferred = groups.find((g) => g.items.length >= minIssueArticles)
      || groups.find((g) => g.items.length >= 3)
      || groups[0];
    selected = preferred ? preferred.items : [];
    issueLabel = preferred
      ? `Vol. ${preferred.volume || '?'}${preferred.issue ? `, Issue ${preferred.issue}` : ''}`
      : `Vol. ${withIssue.volume || '?'}${withIssue.issue ? `, Issue ${withIssue.issue}` : ''}`;
  } else {
    const newest = enriched[0];
    const year = newest.date?.getUTCFullYear();
    const month = newest.date?.getUTCMonth();
    selected = enriched.filter((x) => x.date && x.date.getUTCFullYear() === year && x.date.getUTCMonth() === month);
    issueLabel = newest.date ? `Latest month: ${newest.date.toISOString().slice(0, 7)}` : 'Latest records';
  }

  if (!selected.length) selected = enriched.slice(0, 10);

  return {
    issueLabel,
    selected: selected.slice(0, 25)
  };
}

function firstPageNumber(item) {
  const page = String(item?.page || '').trim();
  if (!page) return Number.POSITIVE_INFINITY;
  const m = page.match(/(\d+)/);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]);
}

function sortIssueItemsForDisplay(selectedEntries) {
  return [...selectedEntries].sort((a, b) => {
    const pa = firstPageNumber(a.raw);
    const pb = firstPageNumber(b.raw);
    if (pa !== pb) return pa - pb;

    const da = a.date ? a.date.getTime() : 0;
    const db = b.date ? b.date.getTime() : 0;
    if (da !== db) return db - da;

    const ta = safeTitle(a.raw).toLowerCase();
    const tb = safeTitle(b.raw).toLowerCase();
    return ta.localeCompare(tb);
  });
}

function itemIdentityKey(item) {
  return String(item?.DOI || item?.URL || safeTitle(item)).toLowerCase();
}

function isLikelyForthcoming(item) {
  const hasIssue = Boolean(String(item?.volume || '').trim() || String(item?.issue || '').trim());
  if (hasIssue) return false;
  const relationText = JSON.stringify(item?.relation || {}).toLowerCase();
  const subtypeText = String(item?.subtype || '').toLowerCase();
  const typeText = String(item?.type || '').toLowerCase();
  const titleText = safeTitle(item).toLowerCase();
  if (relationText.includes('ahead') || relationText.includes('forthcoming')) return true;
  if (subtypeText.includes('ahead') || subtypeText.includes('forthcoming')) return true;
  if (titleText.includes('forthcoming')) return true;
  // Fallback: no volume/issue but has online publication metadata.
  return Boolean(parseOnlineDateFromCrossref(item));
}

function toArticle(entry, articleType = 'latest_issue') {
  const item = entry.raw;
  const url = item.URL || item.link?.[0]?.URL || '';
  const authors = (item.author || [])
    .map((a) => [a.given, a.family].filter(Boolean).join(' ').trim())
    .filter(Boolean)
    .join(', ');

  return {
    title: safeTitle(item),
    url,
    authors,
    date: formatDate(entry.onlineDate || entry.date),
    articleType
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': `Top-Econ-Journals-Reader/1.0 (mailto:${CROSSREF_MAILTO})`,
        ...extraHeaders
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithRetry(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        if (shouldRetryStatus(res.status) && attempt < FETCH_RETRIES) {
          const delay = 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
          await sleep(delay);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_RETRIES) break;
      const delay = 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
      await sleep(delay);
    }
  }
  throw lastError || new Error('Unknown fetch error');
}

async function fetchTextWithRetry(url, timeoutMs = FETCH_TIMEOUT_MS, extraHeaders = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs, extraHeaders);
      if (!res.ok) {
        if (shouldRetryStatus(res.status) && attempt < FETCH_RETRIES) {
          const delay = 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
          await sleep(delay);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_RETRIES) break;
      const delay = 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
      await sleep(delay);
    }
  }
  throw lastError || new Error('Unknown fetch error');
}

function cnkiHeaders(referer = 'https://navi.cnki.net/') {
  const headers = {
    Referer: referer,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };
  if (CNKI_COOKIE) headers.Cookie = CNKI_COOKIE;
  return headers;
}

async function fetchJournal(source, language) {
  if (source.special === 'economic_journal_oup') {
    const oupResult = await fetchEconomicJournalFromOup(source, language);
    if (oupResult && oupResult.articles.length >= 3) {
      return oupResult;
    }
  }

  const endpoint = buildCrossrefEndpoint(source);
  const hasIssnQuery = Boolean(source.issn) || (Array.isArray(source.issns) && source.issns.length > 0);
  const fallbackEndpoint = hasIssnQuery ? '' : buildCrossrefFallbackEndpoint(source);
  const sourceNorm = normalize(source.queryTitle || source.name);

  try {
    let items = [];
    let usedEndpoint = endpoint;

    if (Array.isArray(source.issns) && source.issns.length) {
      const rows = Number(source.rows || 100);
      const datasets = await Promise.all(
        source.issns.map(async (issn) => {
          const url = `https://api.crossref.org/journals/${encodeURIComponent(issn)}/works?sort=published&order=desc&rows=${rows}&filter=type:journal-article`;
          const data = await fetchJsonWithRetry(url);
          return { url, items: data?.message?.items || [] };
        })
      );
      const merged = datasets.flatMap((d) => d.items);
      const dedup = new Map();
      for (const it of merged) {
        const key = String(it.DOI || it.URL || safeTitle(it)).toLowerCase();
        if (!dedup.has(key)) dedup.set(key, it);
      }
      items = Array.from(dedup.values());
      usedEndpoint = datasets.map((d) => d.url).join(' ; ');
    } else {
      const data = await fetchJsonWithRetry(endpoint);
      items = data?.message?.items || [];
    }

    if (!hasIssnQuery && !items.length && fallbackEndpoint) {
      const fallbackData = await fetchJsonWithRetry(fallbackEndpoint);
      items = fallbackData?.message?.items || [];
      usedEndpoint = fallbackEndpoint;
    }

    let filtered = hasIssnQuery
      ? items
      : items.filter((it) => {
          const containers = it['container-title'] || [];
          return containers.some((c) => normalize(c).includes(sourceNorm));
        });

    if (source.strictContainerNorm) {
      filtered = filtered.filter((it) => {
        const containers = it['container-title'] || [];
        return containers.some((c) => normalize(c).includes(source.strictContainerNorm));
      });
    }

    const beforeDoiFilter = filtered;
    if (Array.isArray(source.doiPrefixes) && source.doiPrefixes.length) {
      filtered = filtered.filter((it) => {
        const doi = String(it.DOI || '').toLowerCase();
        return source.doiPrefixes.some((prefix) => doi.startsWith(String(prefix).toLowerCase()));
      });

      // Guardrail: if DOI-prefix filtering becomes too aggressive, keep the
      // strict container-matched set to avoid dropping most papers in an issue.
      if (source.id === 'ej' && filtered.length <= 1 && beforeDoiFilter.length > filtered.length) {
        filtered = beforeDoiFilter;
      }
    } else if (source.doiPrefix) {
      filtered = filtered.filter((it) => String(it.DOI || '').toLowerCase().startsWith(source.doiPrefix));
    }

    // If strict container-title filtering drops all records, fall back to raw query
    // results so the UI can still show likely latest records instead of hard failure.
    const finalItems = (source.strictOnly || hasIssnQuery || filtered.length)
      ? filtered
      : items;

    const { issueLabel, selected } = pickLatestIssue(finalItems, {
      minIssueArticles: source.minIssueArticles || 3
    });

    const orderedSelected = sortIssueItemsForDisplay(selected);
    const latestIssueArticles = orderedSelected.map((entry) => toArticle(entry, 'latest_issue'));

    const selectedKeys = new Set(orderedSelected.map((entry) => itemIdentityKey(entry.raw)));
    const forthcomingEntries = finalItems
      .filter((item) => !selectedKeys.has(itemIdentityKey(item)))
      .filter((item) => isLikelyForthcoming(item))
      .map((item) => ({
        raw: item,
        date: parseDateFromCrossref(item),
        onlineDate: parseOnlineDateFromCrossref(item)
      }))
      .sort((a, b) => {
        const ta = (a.onlineDate || a.date)?.getTime() || 0;
        const tb = (b.onlineDate || b.date)?.getTime() || 0;
        return tb - ta;
      })
      .slice(0, Number(source.forthcomingLimit || 12));

    const forthcomingArticles = forthcomingEntries.map((entry) => toArticle(entry, 'forthcoming'));
    const articles = [...latestIssueArticles, ...forthcomingArticles];
    const label = forthcomingArticles.length ? `${issueLabel} + Forthcoming` : issueLabel;

    return {
      id: source.id,
      name: source.name,
      language,
      status: articles.length ? 'ok' : 'empty',
      latestIssue: label,
      sourceUrl: usedEndpoint,
      articles
    };
  } catch (error) {
    return {
      id: source.id,
      name: source.name,
      language,
      status: 'error',
      latestIssue: 'Fetch failed',
      sourceUrl: endpoint,
      error: error.message,
      articles: []
    };
  }
}

function cleanText(s) {
  return decodeHtmlEntities(
    String(s || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function getCnkiYears(html) {
  const years = new Set();
  const regex = /(20\d{2})年/g;
  let m = regex.exec(html);
  while (m) {
    years.add(Number(m[1]));
    m = regex.exec(html);
  }
  return Array.from(years).sort((a, b) => b - a);
}

function buildCnkiIssueUrl(baseUrl, year, issueNum) {
  const u = new URL(baseUrl);
  u.searchParams.set('colType', '4');
  u.searchParams.set('yt', String(year));
  u.searchParams.set('st', String(issueNum).padStart(2, '0'));
  u.searchParams.delete('tp');
  return u.toString();
}

function extractCnkiIssueLabel(html, year, issueNum) {
  const m = html.match(/(20\d{2})年(\d{2})期目次/);
  if (m) return `${m[1]}年${m[2]}期`;
  return `${year}年${String(issueNum).padStart(2, '0')}期`;
}

function isLikelyCnkiArticleTitle(title) {
  if (!title) return false;
  if (title.length < 4 || title.length > 140) return false;
  if (/^\d{4}年\d{2}期目次$/.test(title)) return false;
  if (/^[A-Z][A-Z\s.:,&-]{6,}$/.test(title)) return false;
  const bad = [
    '[查看摘要]', '[在线阅读]', '[下载]',
    '查看摘要', '在线阅读', '下载',
    '首页', '更多', '本刊介绍', '投稿', '联系我们', '过刊浏览', '高级检索',
    '摘要点击排行', '全文下载排行', '在线办公', '编辑系统', '审稿系统', '作者系统',
    '版权', '友情链接', '数字出版', '技术支持', '期刊征订', '下载中心', '被引频次排行',
    '数据库收录', '期刊荣誉', '刊物简介', '办刊宗旨', '英文刊名',
    '在线期刊', '访问量统计', '著作权使用声明', '期刊封面',
    'journal of', 'management world', 'economic research journal', 'social sciences in china'
  ];
  if (bad.some((k) => title.includes(k))) return false;
  return true;
}

function extractCnkiArticlesFromIssueHtml(html, pageUrl) {
  const cleaned = stripScriptsAndStyles(html);
  const issueMarker = cleaned.match(/20\d{2}\s*年\s*\d{2}\s*期目次/i);
  const scoped = issueMarker
    ? cleaned.slice(Math.max(0, (issueMarker.index || 0) - 200), (issueMarker.index || 0) + 260000)
    : cleaned;
  const articles = [];
  const seenTitle = new Set();

  // Strategy A: pull titles from heading blocks (h2/h3/h4), which are often
  // the real article titles on CNKI issue pages.
  const headingRegex = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi;
  let hm = headingRegex.exec(scoped);
  while (hm) {
    const rawTitle = cleanText(hm[1] || '');
    if (isLikelyCnkiArticleTitle(rawTitle) && !seenTitle.has(rawTitle)) {
      const windowText = scoped.slice(hm.index, hm.index + 1200);
      let url = pageUrl;
      const hrefMatch = windowText.match(/href="([^"]+)"/i);
      if (hrefMatch) {
        const h = hrefMatch[1] || '';
        if (h.startsWith('http')) url = h;
        else url = new URL(h, pageUrl).toString();
      }
      seenTitle.add(rawTitle);
      articles.push({ title: rawTitle, url, authors: '', date: '' });
    }
    hm = headingRegex.exec(scoped);
  }

  // Strategy B: fallback anchor extraction, excluding operation links.
  const seen = new Set();
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m = anchorRegex.exec(scoped);
  while (m) {
    const href = m[1] || '';
    const text = cleanText(m[2] || '');
    if (!isLikelyCnkiArticleTitle(text)) {
      m = anchorRegex.exec(scoped);
      continue;
    }

    const tail = scoped.slice(anchorRegex.lastIndex, anchorRegex.lastIndex + 220);
    const isArticleContext = /查看摘要|在线阅读|下载|全文/i.test(tail);
    if (!isArticleContext) {
      m = anchorRegex.exec(scoped);
      continue;
    }

    const fullUrl = href.startsWith('http')
      ? href
      : new URL(href, pageUrl).toString();
    const key = `${text}@@${fullUrl}`;
    if (!seen.has(key) && !seenTitle.has(text)) {
      seen.add(key);
      articles.push({ title: text, url: fullUrl, authors: '', date: '' });
      seenTitle.add(text);
    }
    m = anchorRegex.exec(scoped);
  }
  return articles;
}

function looksLikeOperationOnlyList(articles) {
  if (!articles.length) return false;
  const ops = ['查看摘要', '在线阅读', '下载'];
  const opCount = articles.filter((a) => ops.some((k) => (a.title || '').includes(k))).length;
  return opCount / articles.length >= 0.5;
}

function stripScriptsAndStyles(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

function extractNaviIssueLabel(html) {
  const text = cleanText(stripScriptsAndStyles(html));
  const m = text.match(/(20\d{2}\s*年\s*(?:第)?\s*\d{1,2}\s*期)/);
  if (!m) return '';
  return m[1].replace(/\s+/g, '');
}

function isValidIssueLabel(label) {
  return /20\d{2}年(?:第)?\d{1,2}期/.test(String(label || ''));
}

function looksLikeArticleHref(href = '') {
  const h = String(href).toLowerCase();
  return h.includes('/detail/')
    || h.includes('kcms')
    || h.includes('kns8')
    || h.includes('doi')
    || h.includes('article');
}

function isLikelyNaviArticleTitle(title) {
  if (!isLikelyCnkiArticleTitle(title)) return false;
  const bad = [
    '本刊介绍', '期刊介绍', '编委会', '投稿指南', '下载中心', '联系我们', '版权协议',
    '收录', '数据库', '期刊订阅', '广告', '公告', '征稿', '在线办公', '编辑部',
    '参考文献', '封面', '目录', '目次', '过刊', '高级检索'
  ];
  return !bad.some((k) => title.includes(k));
}

function extractCnkiArticlesFromNaviHtml(html, pageUrl) {
  const sanitized = stripScriptsAndStyles(html);
  const sectionMatch = sanitized.match(/(?:目次|本期)[\s\S]{0,250000}/i);
  const scope = sectionMatch ? sectionMatch[0] : sanitized;

  const articles = [];
  const seenTitle = new Set();
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m = anchorRegex.exec(scope);
  while (m) {
    const href = m[1] || '';
    const title = cleanText(m[2] || '');
    if (!isLikelyNaviArticleTitle(title)) {
      m = anchorRegex.exec(scope);
      continue;
    }
    if (!looksLikeArticleHref(href)) {
      m = anchorRegex.exec(scope);
      continue;
    }

    const url = href.startsWith('http') ? href : new URL(href, pageUrl).toString();
    if (!seenTitle.has(title)) {
      seenTitle.add(title);
      articles.push({ title, url, authors: '', date: '' });
    }
    m = anchorRegex.exec(scope);
  }
  return articles;
}

function looksLikeJournalMetaList(articles = []) {
  if (!articles.length) return false;
  const badTitlePatterns = [
    /数据库收录/,
    /期刊介绍|本刊介绍|刊物简介/,
    /投稿|征稿|编委会|联系我们|版权/,
    /journal of|economic research journal|social sciences in china/i
  ];
  const bad = articles.filter((a) => badTitlePatterns.some((re) => re.test(String(a.title || '')))).length;
  return bad / articles.length >= 0.4;
}

function extractCnkiCandidatesFromNaviHtml(html) {
  const decoded = String(html || '').replace(/\\\//g, '/');
  const candidates = new Set();

  const absRegex = /https?:\/\/[^\s"'<>]*cbpt\.cnki\.net[^\s"'<>]*/gi;
  let m = absRegex.exec(decoded);
  while (m) {
    candidates.add(m[0].replace(/&amp;/g, '&'));
    m = absRegex.exec(decoded);
  }

  const pathRegex = /(\/WKG\/WebPublication\/wkTextContent\.aspx\?[^"'<>\\\s]+)/gi;
  m = pathRegex.exec(decoded);
  while (m) {
    const path = m[1].replace(/&amp;/g, '&');
    candidates.add(`https://www.cnki.net${path}`);
    m = pathRegex.exec(decoded);
  }

  const out = [];
  for (const raw of candidates) {
    try {
      const u = new URL(raw);
      if (!/cbpt\.cnki\.net$/i.test(u.hostname)) continue;
      if (/\{.+\}/.test(u.hostname + u.pathname + u.search)) continue;
      if (u.pathname.toLowerCase().includes('/wktextcontent.aspx')) {
        if (!u.searchParams.get('colType')) u.searchParams.set('colType', '4');
        if (!u.searchParams.get('tp')) u.searchParams.set('tp', 'gklb');
      }
      out.push(u.toString());
    } catch {
      // ignore invalid URL
    }
  }
  return Array.from(new Set(out));
}

function extractCnkiCandidatesFromPortalHtml(html, baseUrl, mid) {
  const decoded = String(html || '').replace(/\\\//g, '/');
  const found = new Set();

  const hrefRegex = /href="([^"]+)"/gi;
  let m = hrefRegex.exec(decoded);
  while (m) {
    const href = m[1] || '';
    if (!/wktextcontent\.aspx/i.test(href)) {
      m = hrefRegex.exec(decoded);
      continue;
    }
    try {
      const u = new URL(href, baseUrl);
      if (!/cbpt\.cnki\.net$/i.test(u.hostname)) {
        m = hrefRegex.exec(decoded);
        continue;
      }
      if (!u.searchParams.get('mid') && mid) u.searchParams.set('mid', mid);
      if (!u.searchParams.get('colType')) u.searchParams.set('colType', '4');
      if (!u.searchParams.get('tp')) u.searchParams.set('tp', 'gklb');
      found.add(u.toString());
    } catch {
      // ignore
    }
    m = hrefRegex.exec(decoded);
  }

  if (mid) {
    found.add(`https://${mid}.cbpt.cnki.net/WKG/WebPublication/wkTextContent.aspx?colType=4&mid=${mid}&tp=gklb`);
    found.add(`https://${mid}.cbpt.cnki.net/WKB2/WebPublication/wkTextContent.aspx?colType=4&mid=${mid}&tp=gklb`);
  }
  return Array.from(found);
}

async function fetchChineseJournalFromBrowserNavi(source) {
  if (!source.useBrowserNavi || !source.cnkiNaviUrl) {
    return { ok: false, error: 'Browser navi fetch not enabled for this source.' };
  }

  const scriptPath = path.join(__dirname, 'scripts', 'cnki-browser-fetcher.mjs');
  try {
    const { stdout } = await execFile(
      process.execPath,
      [scriptPath, '--url', source.cnkiNaviUrl, '--name', source.name, '--id', source.id],
      {
        timeout: CNKI_BROWSER_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          CNKI_COOKIE
        }
      }
    );

    const parsed = JSON.parse(stdout || '{}');
    if (!parsed?.ok) {
      return { ok: false, error: parsed?.error || 'Browser navi fetch failed.' };
    }
    const badTitleRegex = /(作者发文检索|我的CNKI|文献检索代码|出版来源导航|学术辑刊导航|学位授予单位导航|学位授予单位|Facebook|Twitter|原版目录浏览|查看摘要|在线阅读|数据库收录|CAJViewer浏览器|service\.cnki\.net|新浪微博客服)/i;
    const articles = (Array.isArray(parsed.articles) ? parsed.articles : [])
      .filter((a) => a?.title && !badTitleRegex.test(String(a.title)));
    if (articles.length < 3) {
      return { ok: false, error: `Browser navi low article count (${articles.length}).` };
    }

    return {
      ok: true,
      data: {
        id: source.id,
        name: source.name,
        language: 'zh',
        status: 'ok',
        latestIssue: parsed.latestIssue || '最新期',
        sourceUrl: parsed.sourceUrl || source.cnkiNaviUrl,
        articles: articles.slice(0, 40)
      }
    };
  } catch (error) {
    const tip = /Cannot find package 'playwright'|Cannot find module 'playwright'/i.test(error.message)
      ? 'Playwright not installed. Run: npm i playwright && npx playwright install chromium'
      : error.message;
    return { ok: false, error: `Browser navi error: ${tip}` };
  }
}

async function fetchChineseJournalFromCnkiPortal(source) {
  if (!source.mid) return { ok: false, error: 'No CNKI mid configured.' };
  const portalUrl = `https://${source.mid}.cbpt.cnki.net/`;
  try {
    const html = await fetchTextWithRetry(portalUrl, FETCH_TIMEOUT_MS, cnkiHeaders(portalUrl));
    if (/访问过于频繁|验证码|安全验证/i.test(html)) {
      return { ok: false, error: `CNKI portal blocked at ${portalUrl}` };
    }
    const discovered = extractCnkiCandidatesFromPortalHtml(html, portalUrl, source.mid);
    const candidates = Array.from(new Set([...(source.cnkiCandidates || []), ...discovered]));
    if (!candidates.length) {
      return { ok: false, error: `No portal candidates discovered from ${portalUrl}` };
    }
    const parsed = await fetchChineseJournalFromCnki({
      ...source,
      cnkiCandidates: candidates
    });
    if (parsed?.ok) return parsed;
    return { ok: false, error: `Portal-derived parse failed. ${parsed?.error || ''}`.trim() };
  } catch (error) {
    return { ok: false, error: `CNKI portal request failed at ${portalUrl}: ${error.message}` };
  }
}

async function fetchChineseJournalFromCnkiNavi(source) {
  if (!source.cnkiNaviUrl) return null;
  try {
    const html = await fetchTextWithRetry(source.cnkiNaviUrl, FETCH_TIMEOUT_MS, cnkiHeaders(source.cnkiNaviUrl));
    if (/访问过于频繁|验证码|安全验证/i.test(html)) {
      return { ok: false, error: 'CNKI navi blocked by verification or anti-bot.' };
    }

    let articles = extractCnkiArticlesFromNaviHtml(html, source.cnkiNaviUrl);
    if (articles.length < 2) {
      // Fallback: parse entire page if "目次" section marker is absent.
      articles = extractCnkiArticlesFromIssueHtml(html, source.cnkiNaviUrl);
    }
    if (!articles.length) {
      const discovered = extractCnkiCandidatesFromNaviHtml(html);
      if (discovered.length) {
        const candidateResult = await fetchChineseJournalFromCnki({
          ...source,
          cnkiCandidates: Array.from(new Set([...(source.cnkiCandidates || []), ...discovered]))
        });
        if (candidateResult?.ok) return candidateResult;
        return {
          ok: false,
          error: `CNKI navi had no direct TOC. Derived candidates failed. ${candidateResult?.error || ''}`.trim()
        };
      }
      return { ok: false, error: 'CNKI navi page did not expose parsable TOC articles or candidate links.' };
    }

    const issueLabel = extractNaviIssueLabel(html);
    const lowQuality = articles.length < 5 || looksLikeJournalMetaList(articles) || !isValidIssueLabel(issueLabel);
    if (lowQuality) {
      return {
        ok: false,
        error: `CNKI navi parse low quality (issue="${issueLabel || 'none'}", articles=${articles.length}).`
      };
    }

    return {
      ok: true,
      data: {
        id: source.id,
        name: source.name,
        language: 'zh',
        status: 'ok',
        latestIssue: issueLabel,
        sourceUrl: source.cnkiNaviUrl,
        articles: articles.slice(0, 40)
      }
    };
  } catch (error) {
    return { ok: false, error: `CNKI navi request failed: ${error.message}` };
  }
}

async function fetchChineseJournalFromCnki(source) {
  const candidates = Array.isArray(source.cnkiCandidates) ? source.cnkiCandidates : [];
  if (!candidates.length) return { ok: false, error: 'No CNKI candidate URLs configured.' };
  const errors = [];

  for (const gklbUrl of candidates) {
    try {
      const gklbHtml = await fetchTextWithRetry(gklbUrl, FETCH_TIMEOUT_MS, cnkiHeaders(gklbUrl));
      if (/验证码|访问过于频繁|安全验证/i.test(gklbHtml)) {
        errors.push(`Blocked at ${gklbUrl}`);
        continue;
      }

      const years = getCnkiYears(gklbHtml);
      const targetYears = years.length ? years.slice(0, 3) : [new Date().getFullYear(), new Date().getFullYear() - 1];

      for (const year of targetYears) {
        for (let issueNum = 12; issueNum >= 1; issueNum -= 1) {
          const issueUrl = buildCnkiIssueUrl(gklbUrl, year, issueNum);
          let issueHtml = '';
          try {
            issueHtml = await fetchTextWithRetry(issueUrl, FETCH_TIMEOUT_MS, cnkiHeaders(gklbUrl));
          } catch {
            continue;
          }

          if (/暂无|没有该期|未找到|404|验证码|访问过于频繁/i.test(issueHtml)) continue;
          const articles = extractCnkiArticlesFromIssueHtml(issueHtml, issueUrl);
          if (articles.length < 2) continue;
          if (looksLikeOperationOnlyList(articles)) continue;

          return {
            ok: true,
            data: {
              id: source.id,
              name: source.name,
              language: 'zh',
              status: 'ok',
              latestIssue: extractCnkiIssueLabel(issueHtml, year, issueNum),
              sourceUrl: issueUrl,
              articles: articles.slice(0, 40)
            }
          };
        }
      }
    } catch (error) {
      errors.push(`Request failed at ${gklbUrl}: ${error.message}`);
      // Try next candidate URL.
    }
  }
  return {
    ok: false,
    error: errors.length
      ? `CNKI candidate parsing failed. ${errors.slice(0, 3).join(' | ')}`
      : 'CNKI candidate parsing failed: no parsable latest issue TOC.'
  };
}

function parseRssItems(xml) {
  const items = [];
  const chunks = xml.split('<item>').slice(1);

  const parseRssDateString = (value) => {
    const v = String(value || '').trim();
    if (!v) return '';
    const ts = new Date(v).getTime();
    if (Number.isFinite(ts)) return formatDate(new Date(ts));
    const iso = v.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
    const ym = v.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])\b/);
    if (ym) return `${ym[1]}-${String(ym[2]).padStart(2, '0')}`;

    const monthMap = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };
    const enMonth = v.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b[\s,.-]*(20\d{2})/i)
      || v.match(/\b(20\d{2})[\s,.-]*(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
    if (enMonth) {
      const m = (enMonth[1] && monthMap[String(enMonth[1]).toLowerCase()])
        ? monthMap[String(enMonth[1]).toLowerCase()]
        : monthMap[String(enMonth[2]).toLowerCase()];
      const y = /\d{4}/.test(String(enMonth[1])) ? String(enMonth[1]) : String(enMonth[2]);
      return `${y}-${m}`;
    }
    return '';
  };

  for (const raw of chunks) {
    const block = raw.split('</item>')[0] || '';
    const get = (tag) => {
      const match = block.match(new RegExp(`<${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!match) return '';
      return match[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const first = (tags) => {
      for (const tag of tags) {
        const value = get(tag);
        if (value) return value;
      }
      return '';
    };
    const rawDate = first(['pubDate', 'dc:date', 'date', 'updated', 'atom:updated']);
    const rawDescription = first(['description', 'content:encoded']);

    items.push({
      title: first(['title']),
      url: first(['link', 'guid']),
      date: parseRssDateString(rawDate) || parseRssDateString(rawDescription),
      description: rawDescription
    });
  }

  return items;
}

function normalizeLooseDateText(value = '') {
  const v = String(value || '').trim();
  if (!v) return '';
  const ts = new Date(v).getTime();
  if (Number.isFinite(ts)) return formatDate(new Date(ts));

  const ymd = v.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`;

  const ym = v.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])\b/);
  if (ym) return `${ym[1]}-${String(ym[2]).padStart(2, '0')}`;

  const monthMap = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };
  const m1 = v.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b[\s,.-]*(20\d{2})/i);
  if (m1) return `${m1[2]}-${monthMap[m1[1].toLowerCase()]}`;
  const m2 = v.match(/\b(20\d{2})[\s,.-]*(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
  if (m2) return `${m2[1]}-${monthMap[m2[2].toLowerCase()]}`;
  return '';
}

function parseNberDateFromHtml(html = '') {
  const text = String(html || '');
  if (!text) return '';

  const patterns = [
    /<meta[^>]+name=["']citation_publication_date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /Published\s*[:：]\s*([A-Za-z]+\s+\d{4}|\d{4}[-\/.]\d{1,2}(?:[-\/.]\d{1,2})?)/i
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const normalized = normalizeLooseDateText(m[1]);
    if (normalized) return normalized;
  }
  return '';
}

async function fillMissingNberDates(articles) {
  const targets = articles.filter((a) => !String(a.date || '').trim() && a.url);
  if (!targets.length) return articles;

  await mapWithConcurrency(targets.slice(0, 40), 6, async (article) => {
    try {
      const html = await fetchTextWithRetry(article.url, FETCH_TIMEOUT_MS, {
        Referer: 'https://www.nber.org/',
        Accept: 'text/html,application/xhtml+xml'
      });
      const parsed = parseNberDateFromHtml(html);
      if (parsed) article.date = parsed;
    } catch {
      // Keep empty date if page parsing fails.
    }
  });
  return articles;
}

function splitNberTitleAndAuthors(rawTitle = '', rawDescription = '') {
  const titleText = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  const descText = String(rawDescription || '').replace(/\s+/g, ' ').trim();

  let title = titleText;
  let authors = '';

  // Common NBER feed patterns:
  // "Title -- by A, B"
  // "Title — by A, B"
  // "Title - by A, B"
  // "Title, by A, B"
  const byMatch = titleText.match(/^(.*?)\s*(?:--|—|-|,|;)\s*by\s+(.+)$/i);
  if (byMatch) {
    title = byMatch[1].trim();
    authors = byMatch[2].trim();
  }

  if (!authors) {
    const descAuthorMatch = descText.match(/authors?\s*:\s*(.+?)(?:\s{2,}|$)/i);
    if (descAuthorMatch) {
      authors = descAuthorMatch[1].trim();
    }
  }

  return {
    title: title || titleText,
    authors
  };
}

function decodeHtmlEntities(text) {
  return (text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, ' ');
}

function stripTags(text) {
  return decodeHtmlEntities((text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeOupUrl(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `https://academic.oup.com${href}`;
}

function extractEJArticlesFromHtml(html) {
  const articleMap = new Map();
  const articleHrefRegex = /<a[^>]+href="([^"]*\/ej\/(?:article|advance-article)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m = articleHrefRegex.exec(html);
  while (m) {
    const url = normalizeOupUrl(m[1] || '');
    const title = stripTags(m[2] || '');
    if (url && title && title.length > 3) {
      articleMap.set(url, { title, url, authors: '', date: '' });
    }
    m = articleHrefRegex.exec(html);
  }
  return Array.from(articleMap.values()).filter(
    (a) => !/previous issue|next issue|submit|permissions|view all/i.test(a.title)
  );
}

function extractCurrentIssueUrl(html) {
  const issueRegex = /href="([^"]*\/ej\/issue\/\d+\/\d+[^"]*)"/i;
  const m = html.match(issueRegex);
  if (!m) return '';
  return normalizeOupUrl(m[1] || '');
}

async function fetchEconomicJournalFromOup(source, language) {
  if (!source.tocUrl) return null;

  try {
    const res = await fetchWithTimeout(source.tocUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const issueMatch = html.match(/Volume\s+\d+\s*,\s*Issue\s+\d+/i);
    const latestIssue = issueMatch ? issueMatch[0] : 'Current issue (OUP)';

    const combined = new Map();
    for (const a of extractEJArticlesFromHtml(html)) {
      combined.set(a.url, a);
    }

    const issueUrl = extractCurrentIssueUrl(html);
    if (issueUrl) {
      try {
        const issueRes = await fetchWithTimeout(issueUrl);
        if (issueRes.ok) {
          const issueHtml = await issueRes.text();
          const issueLabelMatch = issueHtml.match(/Volume\s+\d+\s*,\s*Issue\s+\d+/i);
          if (issueLabelMatch) {
            latestIssue = issueLabelMatch[0];
          }
          for (const a of extractEJArticlesFromHtml(issueHtml)) {
            combined.set(a.url, a);
          }
        }
      } catch {
        // Keep entries from current page if issue page fetch fails.
      }
    }

    const articles = Array.from(combined.values()).slice(0, 60);

    if (!articles.length) return null;

    return {
      id: source.id,
      name: source.name,
      language,
      status: 'ok',
      latestIssue,
      sourceUrl: source.tocUrl,
      articles
    };
  } catch {
    return null;
  }
}

async function fetchNber() {
  try {
    let xml = '';
    let lastError = null;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
      try {
        const res = await fetchWithTimeout(NBER_SOURCE.feedUrl);
        if (!res.ok) {
          if (shouldRetryStatus(res.status) && attempt < FETCH_RETRIES) {
            const delay = 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
            await sleep(delay);
            continue;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        xml = await res.text();
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= FETCH_RETRIES) break;
        const delay = 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
        await sleep(delay);
      }
    }
    if (lastError) throw lastError;

    // Keep RSS order as-is to stay aligned with NBER's own list ordering.
    const items = parseRssItems(xml).slice(0, 30);

    const articles = items.map((item) => {
      const split = splitNberTitleAndAuthors(item.title, item.description);
      return {
        title: split.title,
        url: item.url,
        date: item.date,
        authors: split.authors
      };
    });
    await fillMissingNberDates(articles);

    return {
      id: NBER_SOURCE.id,
      name: NBER_SOURCE.name,
      language: 'en',
      status: articles.length ? 'ok' : 'empty',
      latestIssue: 'Latest NBER Working Papers',
      sourceUrl: NBER_SOURCE.feedUrl,
      articles
    };
  } catch (error) {
    return {
      id: NBER_SOURCE.id,
      name: NBER_SOURCE.name,
      language: 'en',
      status: 'error',
      latestIssue: 'Fetch failed',
      sourceUrl: NBER_SOURCE.feedUrl,
      error: error.message,
      articles: []
    };
  }
}

const titleTranslationCache = new Map();

function normalizeTitleKey(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function translateTitleEnToZh(title) {
  const trimmed = String(title || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';

  const key = normalizeTitleKey(trimmed);
  const now = Date.now();
  const cached = titleTranslationCache.get(key);
  if (cached && now - cached.updatedAt < TRANSLATE_CACHE_TTL_MS) {
    return cached.value;
  }

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(trimmed)}`;
  const raw = await fetchTextWithRetry(url, TRANSLATE_TIMEOUT_MS);
  const parsed = JSON.parse(raw);
  const translated = Array.isArray(parsed?.[0])
    ? parsed[0].map((seg) => seg?.[0] || '').join('').trim()
    : '';
  const finalText = translated || trimmed;
  titleTranslationCache.set(key, { value: finalText, updatedAt: now });
  return finalText;
}

async function translateTitlesBatch(titles) {
  const unique = Array.from(
    new Set(
      titles
        .map((t) => String(t || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
  ).slice(0, 600);

  const result = {};
  await mapWithConcurrency(unique, 6, async (title) => {
    try {
      result[title] = await translateTitleEnToZh(title);
    } catch {
      result[title] = '';
    }
  });
  return result;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length || 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export async function fetchAllSources() {
  const taskDefs = [
    ...ENGLISH_JOURNALS.map((j) => ({ type: 'journal', source: j, lang: 'en' })),
    ...CHINESE_JOURNALS.map((j) => ({ type: 'journal_zh', source: j, lang: 'zh' })),
    { type: 'nber' }
  ];

  const data = await mapWithConcurrency(taskDefs, FETCH_CONCURRENCY, async (task) => {
    if (task.type === 'nber') return fetchNber();
    if (task.type === 'journal_zh') {
      const browser = await fetchChineseJournalFromBrowserNavi(task.source);
      if (browser?.ok) return browser.data;
      const portal = await fetchChineseJournalFromCnkiPortal(task.source);
      if (portal?.ok) return portal.data;
      const navi = await fetchChineseJournalFromCnkiNavi(task.source);
      if (navi?.ok) return navi.data;
      const cnki = await fetchChineseJournalFromCnki(task.source);
      if (cnki?.ok) return cnki.data;
      return {
        id: task.source.id,
        name: task.source.name,
        language: 'zh',
        status: 'error',
        latestIssue: 'CNKI fetch failed',
        sourceUrl: task.source.cnkiNaviUrl || (task.source.cnkiCandidates?.[0] || ''),
        error: `Browser: ${browser?.error || 'unknown'} | Portal: ${portal?.error || 'unknown'} | Navi: ${navi?.error || 'unknown'} | Candidate: ${cnki?.error || 'unknown'}`,
        articles: []
      };
    }
    return fetchJournal(task.source, task.lang);
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      all: data.length,
      ok: data.filter((d) => d.status === 'ok').length,
      error: data.filter((d) => d.status === 'error').length
    },
    sources: data
  };
}

let latestCache = {
  updatedAt: 0,
  payload: null
};

async function getLatestPayload(force = false) {
  const now = Date.now();
  if (!force && latestCache.payload && now - latestCache.updatedAt < CACHE_TTL_MS) {
    return latestCache.payload;
  }
  const payload = await fetchAllSources();
  latestCache = { updatedAt: now, payload };
  return payload;
}

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function serveStatic(req, res) {
  const parsedPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  const filePath = parsedPath === '/'
    ? path.join(PUBLIC_DIR, 'index.html')
    : path.join(PUBLIC_DIR, parsedPath);

  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(normalized);
    const ext = path.extname(normalized);
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = urlObj;

  if (method === 'GET' && pathname === '/api/latest') {
    try {
      const force = ['1', 'true', 'yes'].includes(
        (urlObj.searchParams.get('force') || '').toLowerCase()
      );
      const payload = await getLatestPayload(force);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Cache-TTL-Seconds': String(Math.floor(CACHE_TTL_MS / 1000))
      });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/nber-debug') {
    try {
      const nber = await fetchNber();
      const sample = (nber.articles || []).slice(0, 12).map((a) => ({
        title: a.title,
        date: a.date || '',
        hasDate: Boolean(String(a.date || '').trim()),
        url: a.url
      }));
      const withDate = sample.filter((x) => x.hasDate).length;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        count: (nber.articles || []).length,
        sampleCount: sample.length,
        withDate,
        ratio: sample.length ? Number((withDate / sample.length).toFixed(2)) : 0,
        sample
      }, null, 2));
      return;
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
      return;
    }
  }

  if (method === 'POST' && pathname === '/api/translate-batch') {
    try {
      const body = await readJsonBody(req);
      const titles = Array.isArray(body?.titles) ? body.titles : [];
      const translations = await translateTitlesBatch(titles);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify({ translations }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/zh-author-stats') {
    try {
      const force = ['1', 'true', 'yes'].includes(
        (urlObj.searchParams.get('force') || '').toLowerCase()
      );
      const payload = await getLatestPayload(force);
      const stats = (payload.sources || [])
        .filter((s) => s.language === 'zh')
        .map((s) => {
          const total = (s.articles || []).length;
          const withAuthors = (s.articles || []).filter((a) => String(a.authors || '').trim()).length;
          return {
            id: s.id,
            name: s.name,
            total,
            withAuthors,
            ratio: total ? Number((withAuthors / total).toFixed(2)) : 0
          };
        });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ stats }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/zh-debug') {
    try {
      const id = (urlObj.searchParams.get('id') || '').trim();
      const source = CHINESE_JOURNALS.find((s) => s.id === id);
      if (!source) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: `Unknown zh source id: ${id}` }));
        return;
      }

      const scriptPath = path.join(__dirname, 'scripts', 'cnki-browser-fetcher.mjs');
      const { stdout } = await execFile(
        process.execPath,
        [scriptPath, '--url', source.cnkiNaviUrl, '--name', source.name, '--id', source.id, '--debug', '1'],
        {
          timeout: CNKI_BROWSER_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, CNKI_COOKIE }
        }
      );
      const parsed = JSON.parse(stdout || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(parsed));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  await serveStatic(req, res);
});

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) {
  server.listen(PORT, HOST, () => {
    console.log(`Server running: http://${HOST}:${PORT}`);
  });
}
