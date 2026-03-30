const refreshBtn = document.getElementById('refreshBtn');
const meta = document.getElementById('meta');
const enGrid = document.getElementById('enGrid');
const zhGrid = document.getElementById('zhGrid');
const nberGrid = document.getElementById('nberGrid');
const singleGrid = document.getElementById('singleGrid');
const singleSection = document.getElementById('singleSection');
const singleTitle = document.getElementById('singleTitle');
const journalSwitcher = document.getElementById('journalSwitcher');
const backToAllBtn = document.getElementById('backToAllBtn');
const overviewSections = Array.from(document.querySelectorAll('.overview-section'));
const cardTpl = document.getElementById('cardTpl');
let latestPayload = null;
let latestTranslationMap = {};
let openDropdown = null;
const PAGE_BASE = window.location.pathname.replace(/[^/]*$/, '');

const PUBLIC_ECON_PATTERNS_EN = [
  /\bpublic economics?\b/i,
  /\bpublic finance\b/i,
  /\btax(?:ation)?\b/i,
  /\bfiscal\b/i,
  /\bgovernment\b/i,
  /\bpublic spending\b/i,
  /\bmedicaid\b/i,
  /\bmedicare\b/i,
  /\bsocial security\b/i,
  /\bwelfare\b/i,
  /\btransfer(?:s)?\b/i,
  /\bredistribution\b/i,
  /\bpoverty\b/i,
  /\binequalit/i,
  /\bhealth insurance\b/i,
  /\beducation policy\b/i,
  /\bunemployment insurance\b/i,
  /\bminimum wage\b/i,
  /\bsubsid(?:y|ies)\b/i,
  /\bcarbon tax\b/i
];

const PUBLIC_ECON_KEYWORDS_ZH = [
  '财政', '税', '税收', '公共', '政府', '公共服务', '公共政策',
  '社保', '社会保障', '医保', '养老', '教育', '扶贫', '贫困',
  '再分配', '转移支付', '地方债', '补贴', '预算', '财政政策'
];

function clearNodes(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function toLocaleDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function isPublicEconomicsArticle(title = '', translated = '') {
  const t = String(title || '').toLowerCase();
  const z = String(translated || '');
  if (PUBLIC_ECON_PATTERNS_EN.some((re) => re.test(t))) return true;
  return PUBLIC_ECON_KEYWORDS_ZH.some((kw) => z.includes(kw) || String(title).includes(kw));
}

function renderSource(source, translationMap = {}) {
  const frag = cardTpl.content.cloneNode(true);

  const titleEl = frag.querySelector('.journal-name');
  const issueEl = frag.querySelector('.issue');
  const listEl = frag.querySelector('.articles');

  titleEl.textContent = source.name;
  issueEl.textContent = source.latestIssue || 'Latest issue unavailable';

  if (!source.articles.length) {
    const li = document.createElement('li');
    li.textContent = source.status === 'error'
      ? `Failed to fetch now (${source.error || 'unknown error'}). Source: ${source.sourceUrl}`
      : 'No article records found for this source right now.';
    listEl.appendChild(li);
    return frag;
  }

  for (const article of source.articles) {
    const li = document.createElement('li');
    const rawTitle = String(article.title || 'Untitled');
    const cleanTitleForTranslate = rawTitle
      .replace(/\s*(?:--|—|-|,|;)\s*by\s+.+$/i, '')
      .trim();
    const zhTitle = source.language === 'en'
      ? (translationMap[cleanTitleForTranslate] || translationMap[rawTitle] || '')
      : '';

    const a = document.createElement('a');
    a.href = article.url || source.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = rawTitle;

    li.appendChild(a);

    if (isPublicEconomicsArticle(rawTitle, zhTitle)) {
      const tag = document.createElement('span');
      tag.className = 'topic-tag';
      tag.textContent = 'Public Economics';
      li.appendChild(tag);
    }

    if (source.id === 'nber' && article.authors) {
      const authorInline = document.createElement('span');
      authorInline.className = 'mini';
      authorInline.textContent = ` (${article.authors})`;
      li.appendChild(authorInline);
    }

    if (source.language === 'en') {
      if (zhTitle && zhTitle !== article.title) {
        const zhDiv = document.createElement('div');
        zhDiv.className = 'title-zh';
        zhDiv.textContent = zhTitle;
        li.appendChild(zhDiv);
      }
    }

    const bits = [];
    if (article.authors) bits.push(article.authors);
    if (article.date) bits.push(article.date);

    if (source.id !== 'nber' && bits.length) {
      const metaSpan = document.createElement('span');
      metaSpan.className = 'mini';
      metaSpan.textContent = ` (${bits.join(' | ')})`;
      li.appendChild(metaSpan);
    }

    listEl.appendChild(li);
  }

  return frag;
}

function getSelectedSourceId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('source') || '';
}

function setSelectedSourceId(sourceId) {
  const url = new URL(window.location.href);
  if (sourceId) url.searchParams.set('source', sourceId);
  else url.searchParams.delete('source');
  window.history.replaceState({}, '', url);
}

function buildSwitcher(payload) {
  clearNodes(journalSwitcher);
  const groups = [
    {
      label: 'National Bureau of Economic Research',
      items: payload.sources.filter((s) => s.id === 'nber')
    },
    {
      label: 'International Journals',
      items: payload.sources.filter((s) => s.language === 'en' && s.id !== 'nber')
    },
    {
      label: '中文期刊',
      items: payload.sources.filter((s) => s.language === 'zh')
    }
  ];

  for (const group of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'dropdown';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dropdown-btn';
    trigger.textContent = group.label;
    trigger.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu';

    for (const item of group.items) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'dropdown-item';
      opt.textContent = item.name;
      opt.addEventListener('click', () => {
        setSelectedSourceId(item.id);
        wrap.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        openDropdown = null;
        renderLayout(latestPayload, latestTranslationMap);
      });
      menu.appendChild(opt);
    }

    trigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const willOpen = !wrap.classList.contains('open');
      if (openDropdown && openDropdown !== wrap) {
        const prevBtn = openDropdown.querySelector('.dropdown-btn');
        openDropdown.classList.remove('open');
        if (prevBtn) prevBtn.setAttribute('aria-expanded', 'false');
      }
      wrap.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      openDropdown = willOpen ? wrap : null;
    });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    journalSwitcher.appendChild(wrap);
  }
}

function renderOverview(payload, translationMap = {}) {
  clearNodes(enGrid);
  clearNodes(zhGrid);
  clearNodes(nberGrid);

  const english = payload.sources.filter((s) => s.language === 'en' && s.id !== 'nber');
  const chinese = payload.sources.filter((s) => s.language === 'zh');
  const nber = payload.sources.find((s) => s.id === 'nber');

  english.forEach((s) => enGrid.appendChild(renderSource(s, translationMap)));
  chinese.forEach((s) => zhGrid.appendChild(renderSource(s, translationMap)));
  if (nber) nberGrid.appendChild(renderSource(nber, translationMap));
}

function renderSingle(payload, translationMap = {}) {
  clearNodes(singleGrid);
  const selectedId = getSelectedSourceId();
  const source = payload.sources.find((s) => s.id === selectedId);
  if (!source) {
    if (selectedId) setSelectedSourceId('');
    return false;
  }
  singleGrid.appendChild(renderSource(source, translationMap));
  singleTitle.textContent = source.name;
  return true;
}

function renderLayout(payload, translationMap = {}) {
  if (!payload) return;
  buildSwitcher(payload);
  renderOverview(payload, translationMap);

  const hasSingle = renderSingle(payload, translationMap);
  singleSection.classList.toggle('hidden', !hasSingle);
  for (const section of overviewSections) {
    section.classList.toggle('hidden', hasSingle);
  }

  const ts = toLocaleDate(payload.generatedAt);
  meta.textContent = `Updated: ${ts}`;
}

function collectEnglishTitles(payload) {
  const titles = [];
  for (const source of payload.sources || []) {
    if (source.language !== 'en') continue;
    for (const article of source.articles || []) {
      if (article?.title) {
        const clean = String(article.title).replace(/\s*(?:--|—|-|,|;)\s*by\s+.+$/i, '').trim();
        if (clean) titles.push(clean);
      }
    }
  }
  return titles;
}

async function fetchTranslations(titles) {
  if (!titles.length) return {};
  try {
    const res = await fetch(`${window.location.origin}/api/translate-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titles })
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data?.translations || {};
  } catch {
    return {};
  }
}

async function fetchStaticSiteData(force = false) {
  try {
    const query = force ? `?t=${Date.now()}` : '';
    const staticUrl = `${PAGE_BASE}data/site-data.json${query}`;
    const res = await fetch(staticUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const payload = data?.payload || null;
    if (!payload?.sources?.length) return null;
    return {
      payload,
      translations: data?.translations || {}
    };
  } catch {
    return null;
  }
}

async function loadData(force = false) {
  if (refreshBtn) refreshBtn.disabled = true;
  meta.textContent = 'Loading latest issue data...';

  try {
    const staticData = await fetchStaticSiteData(force);
    if (staticData) {
      latestPayload = staticData.payload;
      latestTranslationMap = staticData.translations;
      renderLayout(latestPayload, latestTranslationMap);
      return;
    }

    const query = force ? '?force=1' : '';
    const res = await fetch(`${window.location.origin}/api/latest${query}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    latestPayload = payload;
    renderLayout(payload, {});

    const titles = collectEnglishTitles(payload);
    const translationMap = await fetchTranslations(titles);
    latestTranslationMap = translationMap;
    renderLayout(payload, translationMap);
  } catch (error) {
    meta.textContent = `Load failed: ${error.message}`;
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => loadData(true));
}
backToAllBtn.addEventListener('click', () => {
  setSelectedSourceId('');
  renderLayout(latestPayload, latestTranslationMap);
});
window.addEventListener('popstate', () => {
  renderLayout(latestPayload, latestTranslationMap);
});
document.addEventListener('click', (ev) => {
  if (!openDropdown) return;
  if (openDropdown.contains(ev.target)) return;
  const btn = openDropdown.querySelector('.dropdown-btn');
  openDropdown.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  openDropdown = null;
});
loadData();
