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

function paperMetadata(title = '') {
  const text = title.toLocaleLowerCase();
  if (/asset privatization|intergenerational redistribution/.test(text)) return { tags: ['公共经济', '代际分配'], summary: '研究资产私有化如何在不同代际之间重新分配资源与福利。' };
  if (/malpractice|physician|risk perception/.test(text)) return { tags: ['卫生经济', '风险与激励'], summary: '考察医生面对医疗纠纷诉讼时，风险感知和诊疗决策如何随时间调整。' };
  if (/decoding china.*industrial polic/.test(text)) return { tags: ['中国产业政策', '政治经济学'], summary: '分析中国产业政策的识别方式、实施逻辑及其可能的经济影响。' };
  if (/baby bust|demographic change|growth boom/.test(text)) return { tags: ['人口经济学', '宏观增长'], summary: '讨论生育率与人口结构变化如何影响宏观增长和经济波动。' };
  if (/employment.*community|community.*employment/.test(text)) return { tags: ['劳动经济学', '社会资本'], summary: '研究就业状态与社区合作之间的关系，以及这种合作何时会瓦解。' };
  if (/artificial intelligence|\bai\b|human cognition|knowledge collapse/.test(text)) return { tags: ['人工智能', '创新与增长'], summary: '探讨人工智能如何改变人的认知与知识生产，并评估潜在的知识流失风险。' };
  if (/machine learning|incentive failures?/.test(text)) return { tags: ['人工智能', '激励机制'], summary: '分析机器学习系统设计中的激励错配及其造成的效率问题。' };
  if (/workforce development/.test(text)) return { tags: ['发展经济学', '人力资本'], summary: '评估发展中经济体劳动力技能培养与就业能力提升的路径。' };
  if (/trade|tariff|export|import/.test(text)) return { tags: ['国际贸易'], summary: '围绕贸易政策、跨境流动或企业贸易行为展开研究。' };
  if (/china|chinese|中国/.test(text)) return { tags: ['中国经济'], summary: '围绕中国经济中的具体制度、政策或市场现象展开研究。' };
  return { tags: ['经济学研究'], summary: `围绕“${title}”所涉及的经济问题展开研究。` };
}

function withoutTerminalPunctuation(text = '') {
  return String(text).replace(/[。.!?！？]+$/, '');
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
  const scholarHighlights = scholars.slice(0, 5).map((name) => {
    const summaries = [...new Set(records
      .filter((record) => record.scholar === name)
      .map((record) => record.summary || paperMetadata(record.title).summary))]
      .slice(0, 3);
    return `${name} 的更新包括${summaries.map(withoutTerminalPunctuation).join('、')}等研究`;
  });
  const tail = scholars.length > 5 ? `，另有 ${scholars.length - 5} 位学者更新` : '';
  weeklyBrief.textContent = `${periodLabel}从学者个人主页识别到 ${records.length} 项论文及工作论文更新，来自 ${scholars.length} 位学者，其中 ${workingPapers} 项为工作论文。具体来看，${scholarHighlights.join('；')}${tail}。`;
}

function populateTopics() {
  const selected = topicSelect.value;
  const tags = [...new Set((updates?.records || []).flatMap((record) => record.summary ? record.tags : paperMetadata(record.title).tags))]
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
    const tags = record.summary ? record.tags : paperMetadata(record.title).tags;
    return !topic || tags.includes(topic);
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

    const metadata = record.summary ? { tags: record.tags, summary: record.summary } : paperMetadata(record.title);
    const tags = document.createElement('div');
    tags.className = 'scholar-tags';
    for (const tag of metadata.tags || []) {
      const label = document.createElement('span');
      label.className = 'scholar-tag';
      label.textContent = tag;
      tags.appendChild(label);
    }
    card.appendChild(tags);

    if (metadata.summary) {
      const summary = document.createElement('p');
      summary.className = 'scholar-abstract';
      summary.textContent = metadata.summary;
      card.appendChild(summary);
    }
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
