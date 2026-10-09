const meta = document.getElementById('scholarMeta');
const search = document.getElementById('scholarSearch');
const topicSelect = document.getElementById('scholarTopic');
const updatesList = document.getElementById('scholarUpdatesList');
const weeklyBrief = document.getElementById('weeklyBrief');
const directory = document.getElementById('scholarDirectory');
const directoryCount = document.getElementById('scholarDirectoryCount');
const PAGE_BASE = window.location.pathname.replace(/[^/]*$/, '');

let registry = [];
let updates = null;

function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function searchText(item) {
  return [item.name, item.nameZh, item.institution, item.chinaTopic, item.title, ...(item.tags || [])]
    .join(' ')
    .toLocaleLowerCase();
}

function researchTheme(title = '') {
  const text = title.toLocaleLowerCase();
  if (/industrial polic/.test(text)) return '中国产业政策';
  if (/asset privatization|intergenerational/.test(text)) return '资产私有化与代际分配';
  if (/malpractice|physician|risk perception/.test(text)) return '医疗纠纷与风险感知';
  if (/demographic|baby bust|growth boom/.test(text)) return '人口变化与宏观增长';
  if (/employment|community/.test(text)) return '就业与社区协作';
  if (/artificial intelligence|\bai\b|human cognition|knowledge/.test(text)) return '人工智能与知识积累';
  if (/machine learning|incentive/.test(text)) return '机器学习的激励机制';
  if (/workforce development/.test(text)) return '发展中经济体的人力资本';
  return `《${title}》`;
}

function renderWeeklyBrief() {
  const records = updates?.records || [];
  if (!records.length) {
    weeklyBrief.textContent = '本周尚未从学者主页识别到新的论文或工作论文链接；下次周度巡检会继续重试暂时无法访问的主页。';
    return;
  }

  const scholars = [...new Set(records.map((record) => record.scholar))];
  const workingPapers = records.filter((record) => record.type === '工作论文').length;
  const periodLabel = updates?.initialScan ? '本次首次建档扫描' : '本周';
  const themes = [...new Set(records.map((record) => researchTheme(record.title)))].slice(0, 6);
  const scholarHighlights = scholars.slice(0, 3).map((name) => {
    const ownThemes = [...new Set(records.filter((record) => record.scholar === name).map((record) => researchTheme(record.title)))].slice(0, 3);
    return `${name} 聚焦${ownThemes.join('、')}`;
  });
  const tail = scholars.length > 3 ? `，另有 ${scholars.length - 3} 位学者更新` : '';
  weeklyBrief.textContent = `${periodLabel}从学者个人主页识别到 ${records.length} 项论文及工作论文更新，来自 ${scholars.length} 位学者，其中 ${workingPapers} 项为工作论文。研究主题主要涉及${themes.join('、')}；${scholarHighlights.join('；')}${tail}。`;
}

function populateTopics() {
  const selected = topicSelect.value;
  const tags = [...new Set((updates?.records || []).flatMap((record) => record.tags || []))]
    .sort((a, b) => a.localeCompare(b));
  clear(topicSelect);
  const all = document.createElement('option');
  all.value = '';
  all.textContent = '全部研究领域';
  topicSelect.appendChild(all);
  for (const tag of tags) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    topicSelect.appendChild(option);
  }
  topicSelect.value = tags.includes(selected) ? selected : '';
}

function renderUpdates() {
  const term = search.value.trim().toLocaleLowerCase();
  const topic = topicSelect.value;
  const records = (updates?.records || []).filter((record) => {
    if (term && !searchText(record).includes(term)) return false;
    return !topic || (record.tags || []).includes(topic);
  });
  clear(updatesList);

  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = updates?.records?.length
      ? '没有符合当前筛选条件的主页发现。'
      : '本周尚未从学者主页识别到新的论文链接。';
    updatesList.appendChild(empty);
    return;
  }

  for (const record of records.slice(0, 80)) {
    const card = document.createElement('article');
    card.className = 'scholar-update';
    const person = document.createElement('a');
    person.className = 'scholar-name';
    person.href = record.homepage;
    person.target = '_blank';
    person.rel = 'noopener noreferrer';
    person.textContent = [record.scholar, record.scholarZh].filter(Boolean).join(' / ');
    card.appendChild(person);

    const title = document.createElement('a');
    title.className = 'scholar-paper-title';
    title.href = record.url || record.sourcePage || record.homepage;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = record.title;
    card.appendChild(title);

    const source = document.createElement('p');
    source.className = 'scholar-paper-meta';
    source.textContent = [record.institution, record.type, record.date, '来源：学者主页'].filter(Boolean).join(' | ');
    card.appendChild(source);

    const tags = document.createElement('div');
    tags.className = 'scholar-tags';
    for (const tag of record.tags || []) {
      const label = document.createElement('span');
      label.className = 'scholar-tag';
      label.textContent = tag;
      tags.appendChild(label);
    }
    card.appendChild(tags);
    updatesList.appendChild(card);
  }
}

function renderDirectory() {
  const term = search.value.trim().toLocaleLowerCase();
  const entries = registry
    .filter((scholar) => !term || searchText(scholar).includes(term))
    .sort((a, b) => surname(a).localeCompare(surname(b)) || a.name.localeCompare(b.name));
  clear(directory);
  directoryCount.textContent = `显示 ${entries.length} / ${registry.length} 位学者`;
  const groups = new Map();
  for (const scholar of entries) {
    const initial = surname(scholar).slice(0, 1).toUpperCase();
    const key = /^[A-Z]$/.test(initial) ? initial : '#';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(scholar);
  }
  for (const [initial, scholars] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const group = document.createElement('section');
    group.className = 'scholar-directory-group';
    const heading = document.createElement('h3');
    heading.textContent = initial;
    const grid = document.createElement('div');
    grid.className = 'scholar-directory-grid';
    group.append(heading, grid);
    for (const scholar of scholars) {
      const card = document.createElement('a');
      card.className = 'scholar-directory-card';
      card.href = scholar.homepage;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      const name = document.createElement('strong');
      name.textContent = [scholar.name, scholar.nameZh].filter(Boolean).join(' / ');
      const details = document.createElement('span');
      details.textContent = [scholar.institution, scholar.chinaTopic].filter(Boolean).join(' | ');
      card.append(name, details);
      grid.appendChild(card);
    }
    directory.appendChild(group);
  }
}

function surname(scholar) {
  const words = String(scholar.name || '').trim().split(/\s+/).filter(Boolean);
  return words.at(-1) || scholar.name || '';
}

function render() {
  populateTopics();
  renderWeeklyBrief();
  renderUpdates();
  renderDirectory();
}

async function load() {
  try {
    const [registryResponse, updatesResponse] = await Promise.all([
      fetch(`${PAGE_BASE}data/scholar-registry.json`, { cache: 'no-store' }),
      fetch(`${PAGE_BASE}data/scholar-updates.json`, { cache: 'no-store' })
    ]);
    if (!registryResponse.ok || !updatesResponse.ok) throw new Error('数据文件暂不可用');
    const registryData = await registryResponse.json();
    updates = await updatesResponse.json();
    registry = registryData.scholars || [];
    const timestamp = updates.generatedAt ? new Date(updates.generatedAt).toLocaleString() : '尚未扫描';
    meta.textContent = `追踪 ${registry.length} 位学者 | 最近扫描：${timestamp}`;
    render();
  } catch (error) {
    meta.textContent = `暂时无法读取学者动态：${error.message}`;
  }
}

search.addEventListener('input', () => {
  renderUpdates();
  renderDirectory();
});
topicSelect.addEventListener('change', renderUpdates);
load();
