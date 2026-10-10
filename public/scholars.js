const meta = document.getElementById('scholarMeta');
const search = document.getElementById('scholarSearch');
const topicSelect = document.getElementById('scholarTopic');
const updatesList = document.getElementById('scholarUpdatesList');
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
      : '本周没有发现首次出现在学者主页上的新论文；已有论文、PDF 换版和页面日期变化均不会计入周报。';
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
    source.textContent = [visibleInstitution(record.institution), record.type, record.firstDetectedAt?.slice(0, 10), '来源：学者主页'].filter(Boolean).join(' | ');
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

    const abstract = document.createElement('p');
    abstract.className = 'scholar-abstract';
    abstract.textContent = `摘要译文：${record.abstractZh || '摘要暂未读取。'}`;
    card.appendChild(abstract);
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
      details.textContent = [visibleInstitution(scholar.institution), scholar.chinaTopic].filter(Boolean).join(' | ');
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

function visibleInstitution(institution = '') {
  return /未逐人复核|现职待核|待核/i.test(institution) ? '' : institution;
}

function render() {
  populateTopics();
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
