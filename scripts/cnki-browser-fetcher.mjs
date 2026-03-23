import { chromium } from 'playwright';

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}

const targetUrl = arg('--url');
const sourceName = arg('--name', 'CNKI Journal');
const sourceId = arg('--id', '');
const debugMode = ['1', 'true', 'yes'].includes(String(arg('--debug', '')).toLowerCase());

const BAD_WORDS = [
  '查看摘要', '在线阅读', '下载', '数据库收录', '期刊介绍', '本刊介绍', '投稿',
  '编委会', '联系我们', '版权', '在线期刊', '访问量统计', '著作权使用声明',
  '期刊封面', '该刊被以下数据库收录', 'journal of', 'social sciences in china',
  'economic research journal', 'management world',
  '作者发文检索', '我的cnki', '文献检索代码', '出版来源导航', '学术辑刊导航',
  '学位授予单位导航', 'facebook', 'twitter', '原版目录浏览', '分享',
  '总目', '征稿启事',
  '学位授予单位', 'cajviewer浏览器', 'service.cnki.net', '新浪微博客服'
];

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitleKey(s) {
  return cleanText(s)
    .replace(/[“”"']/g, '')
    .replace(/[—–-]/g, '-')
    .replace(/[（）()]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function isLikelyTitle(title) {
  const t = cleanText(title);
  if (!t) return false;
  if (t.length < 6 || t.length > 150) return false;
  if (/^\[.*\]$/.test(t)) return false;
  if (/^\d{4}年\d{2}期目次$/.test(t)) return false;
  if (/cnki\.net|cajviewer|微博客服|学位授予单位/i.test(t)) return false;
  if (BAD_WORDS.some((w) => t.toLowerCase().includes(String(w).toLowerCase()))) return false;
  return true;
}

function extractIssueLabel(text) {
  const m = cleanText(text).match(/(20\d{2}\s*年\s*(?:第)?\s*\d{1,2}\s*期)/);
  return m ? m[1].replace(/\s+/g, '') : '';
}

function extractAuthorsFromContext(contextText, title) {
  let ctx = cleanText(contextText || '');
  if (!ctx) return '';
  if (title) {
    const escaped = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ctx = ctx.replace(new RegExp(escaped, 'g'), ' ');
    ctx = cleanText(ctx);
  }

  // Prefer explicit "作者: ..." style.
  const byMatch = ctx.match(/作者[:：]?\s*(.+?)(?:摘要|关键词|基金项目|收稿日期|DOI|全文|下载|$)/i);
  if (byMatch) {
    return cleanText(byMatch[1]);
  }

  // Fallback: if context has typical separator list and not UI labels.
  const maybe = ctx.match(/([\u4e00-\u9fa5A-Za-z·.\-\s]{2,}(?:[、,，;；]\s*[\u4e00-\u9fa5A-Za-z·.\-\s]{2,}){1,})/);
  if (maybe) {
    const v = cleanText(maybe[1]);
    if (!/查看摘要|在线阅读|下载|目录|导航|数据库|期刊/i.test(v)) return v;
  }
  return '';
}

function extractAuthorsFromBlockText(blockText, title) {
  let text = cleanText(blockText || '');
  if (!text) return '';

  const titleEscaped = String(title || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (titleEscaped) {
    text = text.replace(new RegExp(titleEscaped, 'g'), ' ');
    text = cleanText(text);
  }

  // Explicit marker forms.
  const explicit = text.match(/(?:作者|Author(?:s)?)\s*[:：]?\s*([^\n\r]{2,120}?)(?:摘要|关键词|查看摘要|在线阅读|全文|下载|$)/i);
  if (explicit && explicit[1]) {
    const v = cleanText(explicit[1]);
    if (v && !/目录|导航|数据库|期刊|分享/i.test(v)) return v;
  }

  // CNKI often renders each author with a nearby "作者发文检索" control.
  // Example text chunk: "魏江 作者发文检索 应英 作者发文检索 查看摘要"
  if (/作者发文检索/.test(text)) {
    const names = [];
    const re = /([\u4e00-\u9fa5A-Za-z·.\-\s]{2,24})\s*作者发文检索/g;
    let m = re.exec(text);
    while (m) {
      const name = cleanText(m[1] || '');
      if (
        name &&
        !/查看摘要|在线阅读|下载|目录|导航|数据库|期刊|分享|facebook|twitter/i.test(name) &&
        !names.includes(name)
      ) {
        names.push(name);
      }
      m = re.exec(text);
    }
    if (names.length) return names.join('；');
  }

  // Parentheses right after title often contain author list.
  const paren = text.match(/[（(]\s*([^（）()]{2,80})\s*[）)]/);
  if (paren && paren[1]) {
    const v = cleanText(paren[1]);
    if (/[·\u4e00-\u9fa5A-Za-z]/.test(v) && !/目录|导航|数据库|期刊|分享|摘要|关键词/i.test(v)) {
      return v;
    }
  }

  // CNKI toc often puts author list between title and operation words.
  const between = text.match(/([\u4e00-\u9fa5A-Za-z·.\-\s]{2,120}?)(?:查看摘要|在线阅读|关键词|摘要|全文|下载)/i);
  if (between && between[1]) {
    const v = cleanText(between[1]).replace(/^[，,;；\s]+|[，,;；\s]+$/g, '');
    if (v && /[·\u4e00-\u9fa5A-Za-z]/.test(v) && !/目录|导航|数据库|期刊|分享|二维码/i.test(v)) {
      return v;
    }
  }

  // Generic person-list pattern (Chinese + English names).
  const generic = text.match(/([\u4e00-\u9fa5A-Za-z·.\-]{2,30}(?:\s*[、，,;；]\s*[\u4e00-\u9fa5A-Za-z·.\-]{2,30}){1,12})/);
  if (generic && generic[1]) {
    const v = cleanText(generic[1]);
    if (!/目录|导航|数据库|期刊|分享|facebook|twitter/i.test(v)) return v;
  }

  // If title is removed and a short residual token remains, treat it as single author.
  const residual = cleanText(
    text
      .replace(/查看摘要|在线阅读|下载|摘要|关键词|全文|DOI/gi, ' ')
      .replace(/[（(][^（）()]{1,80}[）)]/g, ' ')
      .replace(/\s+/g, ' ')
  );
  if (/^[\u4e00-\u9fa5·A-Za-z.\-\s]{2,24}$/.test(residual) && !/目录|导航|数据库|期刊|分享/.test(residual)) {
    return residual;
  }
  return '';
}

if (!targetUrl) {
  console.log(JSON.stringify({ ok: false, error: 'Missing --url argument.' }));
  process.exit(0);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'zh-CN'
  });

  const cookieRaw = process.env.CNKI_COOKIE || '';
  if (cookieRaw) {
    const pairs = cookieRaw.split(';').map((x) => x.trim()).filter(Boolean);
    const cookies = pairs
      .map((pair) => {
        const idx = pair.indexOf('=');
        if (idx <= 0) return null;
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (!name) return null;
        return {
          name,
          value,
          domain: '.cnki.net',
          path: '/'
        };
      })
      .filter(Boolean);
    if (cookies.length) {
      await context.addCookies(cookies);
    }
  }

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  try {
    await page.waitForLoadState('networkidle', { timeout: 12000 });
  } catch {
    // ignore
  }

  const data = await page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const tableRows = Array.from(document.querySelectorAll('tr'));
    const ddRows = Array.from(document.querySelectorAll('dd.row, dd.row.clearfix, dd.row.clearfix.bgcGray'));
    const liRows = Array.from(document.querySelectorAll('li'));

    const rowCandidates = tableRows
      .map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (cells.length < 2) return null;
        const titleCell = clean(cells[0].textContent || '');
        const authorCell = clean(cells[1].textContent || '');
        const hrefEl = tr.querySelector('a[href]');
        const href = hrefEl ? hrefEl.href : '';
        return { titleCell, authorCell, href };
      })
      .filter(Boolean);

    const ddCandidates = ddRows
      .map((dd) => {
        const link = dd.querySelector('span.name a[href], a[href]');
        const title = clean(link ? link.textContent : '');
        const href = link ? link.href : '';
        const authorEl = dd.querySelector('span.author');
        const author = clean(authorEl ? (authorEl.getAttribute('title') || authorEl.textContent) : '');
        return { title, href, author };
      })
      .filter((x) => x && x.title);

    const liCandidates = liRows
      .map((li) => {
        const link = li.querySelector('a[href]');
        if (!link) return null;
        const title = clean(link.textContent || '');
        const href = clean(link.href || '');
        const rowText = clean(li.textContent || '');
        let author = '';
        const authorEl = li.querySelector('.author, [class*=author]');
        if (authorEl) {
          author = clean(authorEl.getAttribute('title') || authorEl.textContent || '');
        }
        return { title, href, author, rowText };
      })
      .filter(Boolean);

    const rows = anchors.map((a) => {
      let container = a;
      for (let i = 0; i < 6; i += 1) {
        if (!container || !container.parentElement) break;
        const p = container.parentElement;
        const tag = (p.tagName || '').toLowerCase();
        if (tag === 'li' || tag === 'tr' || tag === 'dd' || tag === 'dt' || tag === 'p' || tag === 'div') {
          container = p;
          if ((container.textContent || '').length > 30) break;
        } else {
          container = p;
        }
      }
      return {
      text: clean(a.textContent),
      href: a.href,
      outer: a.outerHTML,
      parentText: clean((a.parentElement && a.parentElement.textContent) || ''),
      blockText: clean((container && container.textContent) || '')
      };
    });

    const bodyText = clean(document.body ? document.body.innerText : '');

    return {
      bodyText,
      rows,
      rowCandidates,
      ddCandidates,
      liCandidates
    };
  });

  const issueLabel = extractIssueLabel(data.bodyText);

  const seen = new Set();
  const articles = [];
  const rowAuthorMap = new Map();
  const ddAuthorMapByTitle = new Map();
  const ddAuthorMapByHref = new Map();
  const liAuthorMapByTitle = new Map();
  const liAuthorMapByHref = new Map();

  for (const d of data.ddCandidates || []) {
    const t = cleanText(d.title || '');
    const href = cleanText(d.href || '');
    const a = cleanText(String(d.author || '').replace(/[;；]\s*$/, ''));
    if (!isLikelyTitle(t)) continue;
    if (!a || /查看摘要|在线阅读|下载|关键词|摘要|数据库|导航|目录|总目/i.test(a)) continue;
    ddAuthorMapByTitle.set(normalizeTitleKey(t), a);
    if (href) ddAuthorMapByHref.set(href, a);
  }

  for (const l of data.liCandidates || []) {
    const t = cleanText(l.title || '');
    const href = cleanText(l.href || '');
    if (!isLikelyTitle(t)) continue;
    let a = cleanText(l.author || '');
    if (!a) {
      a = extractAuthorsFromBlockText(l.rowText || '', t);
    }
    if (!a || /查看摘要|在线阅读|下载|关键词|摘要|数据库|导航|目录|总目/i.test(a)) continue;
    liAuthorMapByTitle.set(normalizeTitleKey(t), a.replace(/[;；]\s*$/, ''));
    if (href) liAuthorMapByHref.set(href, a.replace(/[;；]\s*$/, ''));
  }

  for (const r of data.rowCandidates || []) {
    const t = cleanText(r.titleCell || '');
    const a = cleanText(r.authorCell || '');
    if (!isLikelyTitle(t)) continue;
    if (!a || /页|目次|栏目|专题|总目|^\d/.test(a)) continue;
    if (/查看摘要|在线阅读|下载|关键词|摘要|数据库|导航|目录/i.test(a)) continue;
    rowAuthorMap.set(normalizeTitleKey(t), a.replace(/[;；]\s*$/, ''));
  }

  // Structured rows first (works better on CNKI TOC pages).
  for (const d of data.ddCandidates || []) {
    const title = cleanText(d.title || '');
    const href = cleanText(d.href || '');
    const authors = cleanText(d.author || '').replace(/[;；]\s*$/, '');
    if (!isLikelyTitle(title)) continue;
    if (/总目|征稿启事/.test(title)) continue;
    const key = `${title}@@${href || 'nohref'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push({ title, url: href || targetUrl, authors, date: '' });
  }

  for (const l of data.liCandidates || []) {
    const title = cleanText(l.title || '');
    const href = cleanText(l.href || '');
    const authors = (liAuthorMapByHref.get(href) || liAuthorMapByTitle.get(normalizeTitleKey(title)) || '').trim();
    if (!isLikelyTitle(title)) continue;
    if (/总目|征稿启事/.test(title)) continue;
    const key = `${title}@@${href || 'nohref'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push({ title, url: href || targetUrl, authors, date: '' });
  }

  for (const row of data.rows) {
    const title = cleanText(row.text);
    const href = cleanText(row.href);
    if (!isLikelyTitle(title)) continue;
    if (!href || !/^https?:\/\//i.test(href)) continue;

    const contextText = cleanText(row.parentText);
    if (/\/knavi\//i.test(href) || /facebook|twitter/i.test(href)) continue;

    const likelyArticleLink = /detail|kcms|kns|article|doi|download/i.test(href)
      || /作者|摘要|关键词|目次|全文/i.test(contextText);
    if (!likelyArticleLink) continue;

    const authors = ddAuthorMapByHref.get(href)
      || ddAuthorMapByTitle.get(normalizeTitleKey(title))
      || liAuthorMapByHref.get(href)
      || liAuthorMapByTitle.get(normalizeTitleKey(title))
      || rowAuthorMap.get(normalizeTitleKey(title))
      || extractAuthorsFromBlockText(row.blockText, title)
      || extractAuthorsFromContext(contextText, title);

    const key = `${title}@@${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push({ title, url: href, authors, date: '' });
  }

  // Keep extraction strictly on TOC page per product requirement.

  const result = {
    ok: articles.length >= 3 && !!issueLabel,
    latestIssue: issueLabel || '最新期',
    sourceUrl: page.url(),
    articles: articles.slice(0, 60),
    error: ''
  };

  if (debugMode) {
    const missing = result.articles.filter((a) => !cleanText(a.authors)).slice(0, 20);
    result.debug = {
      sourceName,
      sourceId,
      issueLabel: result.latestIssue,
      rowCandidates: (data.rowCandidates || []).slice(0, 30),
      tocRows: (data.rows || []).slice(0, 60),
      missingAuthors: missing.map((m) => ({ title: m.title, url: m.url })),
      authorCoverage: {
        total: result.articles.length,
        withAuthors: result.articles.filter((a) => cleanText(a.authors)).length
      }
    };
  }

  if (!result.ok) {
    result.error = `Browser parse low quality (issue="${issueLabel || 'none'}", articles=${articles.length})`;
  }

  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message || String(error) }));
} finally {
  if (browser) {
    await browser.close();
  }
}
