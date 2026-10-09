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
  const entries = registry.filter((scholar) => !term || searchText(scholar).includes(term));
  clear(directory);
  directoryCount.textContent = `显示 ${entries.length} / ${registry.length} 位学者`;
  for (const scholar of entries) {
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
    directory.appendChild(card);
  }
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
