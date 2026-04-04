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
const topicResultsSection = document.getElementById('topicResultsSection');
const topicTitle = document.getElementById('topicTitle');
const topicList = document.getElementById('topicList');
const overviewSections = Array.from(document.querySelectorAll('.overview-section'));
const cardTpl = document.getElementById('cardTpl');
let latestPayload = null;
let archivePayload = null;
let latestTranslationMap = {};
let openDropdown = null;
let selectedTopic = 'journal';
let selectedScope = 'latest';
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

const INDUSTRY_PATTERNS_EN = [
  /\bindustrial policy\b/i,
  /\bindustr(?:y|ies)\b/i,
  /\bmanufactur(?:e|ing)\b/i,
  /\bfirm\b/i,
  /\binnovation\b/i,
  /\bsubsid(?:y|ies)\b/i
];

const TRADE_PATTERNS_EN = [
  /\btrade\b/i,
  /\btariff\b/i,
  /\bimport\b/i,
  /\bexport\b/i,
  /\bglobal value chain\b/i,
  /\bWTO\b/i
];

const ENV_PATTERNS_EN = [
  /\benvironment(?:al)?\b/i,
  /\bclimate\b/i,
  /\bcarbon\b/i,
  /\benergy transition\b/i,
  /\bemission(?:s)?\b/i,
  /\bpollution\b/i
];

const INDUSTRY_KEYWORDS_ZH = ['产业', '工业', '制造业', '企业', '创新', '补贴', '机器人', '技术进口'];
const TRADE_KEYWORDS_ZH = ['贸易', '关税', '进出口', '出口', '进口', '全球价值链', '供应链'];
const ENV_KEYWORDS_ZH = ['环境', '气候', '碳', '排放', '污染', '绿色', '生态'];

const TOPIC_LABELS = {
  journal: 'By Journal',
  public: 'Public Economics',
  industry: 'Industrial Policy',
  trade: 'Trade',
  environment: 'Environment',
  other: 'Other'
};

const TOPIC_OPTIONS = [
  { id: 'journal', label: 'By Journal' },
  { id: 'public', label: 'Public Economics' },
  { id: 'industry', label: 'Industrial Policy' },
  { id: 'trade', label: 'Trade' },
  { id: 'environment', label: 'Environment' },
  { id: 'other', label: 'Other' }
];

const SCOPE_LABELS = {
  latest: 'Latest + Forthcoming',
  archive: 'Historical Archive'
};

const SCOPE_OPTIONS = [
  { id: 'latest', label: 'Latest + Forthcoming' },
  { id: 'archive', label: 'Historical Archive' }
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

function isByPatterns(title = '', translated = '', patterns = [], zhKeywords = []) {
  const t = String(title || '').toLowerCase();
  const z = String(translated || '');
  if (patterns.some((re) => re.test(t))) return true;
  return zhKeywords.some((kw) => z.includes(kw) || String(title).includes(kw));
}

function classifyTopic(title = '', translated = '') {
  if (isPublicEconomicsArticle(title, translated)) return 'public';
  if (isByPatterns(title, translated, INDUSTRY_PATTERNS_EN, INDUSTRY_KEYWORDS_ZH)) return 'industry';
  if (isByPatterns(title, translated, TRADE_PATTERNS_EN, TRADE_KEYWORDS_ZH)) return 'trade';
  if (isByPatterns(title, translated, ENV_PATTERNS_EN, ENV_KEYWORDS_ZH)) return 'environment';
  return 'other';
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
    const topic = classifyTopic(rawTitle, zhTitle);

    const a = document.createElement('a');
    a.href = article.url || source.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = rawTitle;

    li.appendChild(a);

    if (article.articleType === 'forthcoming') {
      const fcTag = document.createElement('span');
      fcTag.className = 'article-type-tag article-type-forthcoming';
      fcTag.textContent = 'Forthcoming';
      li.appendChild(fcTag);
    }

    const tag = document.createElement('span');
    tag.className = `topic-tag topic-${topic}`;
    tag.textContent = TOPIC_LABELS[topic];
    li.appendChild(tag);

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

function collectTopicEntries(payload, translationMap = {}, selected = 'all') {
  const items = [];
  for (const source of payload.sources || []) {
    for (const article of source.articles || []) {
      const rawTitle = String(article.title || 'Untitled');
      const cleanTitleForTranslate = rawTitle
        .replace(/\s*(?:--|—|-|,|;)\s*by\s+.+$/i, '')
        .trim();
      const zhTitle = source.language === 'en'
        ? (translationMap[cleanTitleForTranslate] || translationMap[rawTitle] || '')
        : '';
      const topic = classifyTopic(rawTitle, zhTitle);
      if (selected !== 'all' && topic !== selected) continue;

      items.push({
        topic,
        sourceName: source.name,
        sourceIssue: source.latestIssue || '',
        title: rawTitle,
        zhTitle,
        url: article.url || source.sourceUrl || '',
        authors: article.authors || '',
        date: article.date || ''
      });
    }
  }
  return items;
}

function renderTopicList(payload, translationMap = {}) {
  clearNodes(topicList);
  const selected = selectedTopic;
  if (selected === 'journal') return;
  const items = collectTopicEntries(payload, translationMap, selected);

  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'topic-item';
    li.textContent = 'No records under this topic in the current snapshot.';
    topicList.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'topic-item';

    const a = document.createElement('a');
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.title;
    li.appendChild(a);

    const tag = document.createElement('span');
    tag.className = `topic-tag topic-${item.topic}`;
    tag.textContent = TOPIC_LABELS[item.topic];
    li.appendChild(tag);

    if (item.zhTitle && item.zhTitle !== item.title) {
      const zh = document.createElement('div');
      zh.className = 'title-zh';
      zh.textContent = item.zhTitle;
      li.appendChild(zh);
    }

    const src = document.createElement('div');
    src.className = 'topic-source';
    const bits = [item.sourceName];
    if (item.sourceIssue) bits.push(item.sourceIssue);
    if (item.authors) bits.push(item.authors);
    if (item.date) bits.push(item.date);
    src.textContent = bits.join(' | ');
    li.appendChild(src);

    topicList.appendChild(li);
  }
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

  const scopeWrap = document.createElement('div');
  scopeWrap.className = 'dropdown';

  const scopeTrigger = document.createElement('button');
  scopeTrigger.type = 'button';
  scopeTrigger.className = 'dropdown-btn';
  scopeTrigger.textContent = `Scope: ${SCOPE_LABELS[selectedScope]}`;
  scopeTrigger.setAttribute('aria-expanded', 'false');

  const scopeMenu = document.createElement('div');
  scopeMenu.className = 'dropdown-menu';

  for (const opt of SCOPE_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dropdown-item';
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      selectedScope = opt.id;
      setSelectedSourceId('');
      scopeWrap.classList.remove('open');
      scopeTrigger.setAttribute('aria-expanded', 'false');
      openDropdown = null;
      renderLayout(latestPayload, latestTranslationMap);
    });
    scopeMenu.appendChild(btn);
  }

  scopeTrigger.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const willOpen = !scopeWrap.classList.contains('open');
    if (openDropdown && openDropdown !== scopeWrap) {
      const prevBtn = openDropdown.querySelector('.dropdown-btn');
      openDropdown.classList.remove('open');
      if (prevBtn) prevBtn.setAttribute('aria-expanded', 'false');
    }
    scopeWrap.classList.toggle('open', willOpen);
    scopeTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    openDropdown = willOpen ? scopeWrap : null;
  });

  scopeWrap.appendChild(scopeTrigger);
  scopeWrap.appendChild(scopeMenu);
  journalSwitcher.appendChild(scopeWrap);

  const topicWrap = document.createElement('div');
  topicWrap.className = 'dropdown';

  const topicTrigger = document.createElement('button');
  topicTrigger.type = 'button';
  topicTrigger.className = 'dropdown-btn';
  topicTrigger.textContent = `Topic: ${TOPIC_LABELS[selectedTopic]}`;
  topicTrigger.setAttribute('aria-expanded', 'false');

  const topicMenu = document.createElement('div');
  topicMenu.className = 'dropdown-menu';

  for (const opt of TOPIC_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dropdown-item';
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      selectedTopic = opt.id;
      setSelectedSourceId('');
      topicWrap.classList.remove('open');
      topicTrigger.setAttribute('aria-expanded', 'false');
      openDropdown = null;
      renderLayout(latestPayload, latestTranslationMap);
    });
    topicMenu.appendChild(btn);
  }

  topicTrigger.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const willOpen = !topicWrap.classList.contains('open');
    if (openDropdown && openDropdown !== topicWrap) {
      const prevBtn = openDropdown.querySelector('.dropdown-btn');
      openDropdown.classList.remove('open');
      if (prevBtn) prevBtn.setAttribute('aria-expanded', 'false');
    }
    topicWrap.classList.toggle('open', willOpen);
    topicTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    openDropdown = willOpen ? topicWrap : null;
  });

  topicWrap.appendChild(topicTrigger);
  topicWrap.appendChild(topicMenu);
  journalSwitcher.appendChild(topicWrap);

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
  const activePayload = selectedScope === 'archive' && archivePayload ? archivePayload : payload;
  const topicMode = selectedTopic !== 'journal';

  renderTopicList(activePayload, translationMap);
  topicTitle.textContent = topicMode ? `Topic: ${TOPIC_LABELS[selectedTopic]}` : 'Topic View';
  buildSwitcher(activePayload);
  if (!topicMode) {
    renderOverview(activePayload, translationMap);
  } else {
    clearNodes(enGrid);
    clearNodes(zhGrid);
    clearNodes(nberGrid);
  }

  const hasSingle = topicMode ? false : renderSingle(activePayload, translationMap);
  singleSection.classList.toggle('hidden', !hasSingle || topicMode);
  for (const section of overviewSections) {
    section.classList.toggle('hidden', hasSingle || topicMode);
  }
  topicResultsSection.classList.toggle('hidden', !topicMode);
  topicList.classList.toggle('hidden', !topicMode);

  const ts = toLocaleDate(activePayload.generatedAt || payload.generatedAt);
  meta.textContent = `Updated: ${ts} | ${SCOPE_LABELS[selectedScope]}`;
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
      archivePayload: data?.archivePayload || null,
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
      archivePayload = staticData.archivePayload || null;
      latestTranslationMap = staticData.translations;
      renderLayout(latestPayload, latestTranslationMap);
      return;
    }

    const query = force ? '?force=1' : '';
    const res = await fetch(`${window.location.origin}/api/latest${query}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    latestPayload = payload;
    archivePayload = null;
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
