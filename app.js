/* ════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════ */
const SUPABASE_URL = 'https://wujgoaamahfwxexhsolg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1amdvYWFtYWhmd3hleGhzb2xnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNTg5MDAsImV4cCI6MjA5NDYzNDkwMH0.n4sDVglbfNoSPeyRaQrVN1TPT8TgJcr5DFXPdWTna2k';
const USER_ID      = 'Chaise_Baker';

/* ════════════════════════════════
   INIT
════════════════════════════════ */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const PALETTE = [
  '#7c5cbf','#9d7de8','#ec4899','#f97316',
  '#eab308','#10b981','#06b6d4','#3b82f6',
  '#ef4444','#a855f7'
];

const DEFAULT_CATEGORIES = [
  { name: 'Health',        color: '#10b981' },
  { name: 'Fitness',       color: '#3b82f6' },
  { name: 'Learning',      color: '#9d7de8' },
  { name: 'Mindfulness',   color: '#ec4899' },
  { name: 'Productivity',  color: '#f97316' },
  { name: 'Social',        color: '#06b6d4' },
  { name: 'Creative',      color: '#a855f7' },
  { name: 'Other',         color: '#8b949e' },
];

let habits         = [];
let archivedHabits = [];
let completions    = {}; // { habit_id: Set<date_string> }
let categories     = [];
let todos          = [];
let subtasks       = [];
let selColor       = PALETTE[0];
let selCatColor    = PALETTE[0];
let viewMonth      = new Date(); viewMonth.setDate(1);
let taskCalMonth   = new Date(); taskCalMonth.setDate(1);
let ganttRange     = 30;
let ganttOffset    = -3;
let calYear        = new Date().getFullYear();
let chart          = null;
let chartRange     = 7;
let busy           = false;
let dailyPriority  = 'high';
let todoEditId     = null;
let tdDragId       = null;
let kbDragId       = null;
let reorderTimer   = null;
const openPanels   = new Set(); // tracks which subtask panels are expanded

/* ════════════════════════════════
   LOADING / ERROR
════════════════════════════════ */
function showLoading(on) {
  const el = document.getElementById('loading-overlay');
  if (on) el.classList.remove('hidden');
  else    el.classList.add('hidden');
}

function showError(msg) {
  const banner = document.getElementById('px-error');
  const text   = document.getElementById('px-error-msg');
  text.textContent = msg;
  banner.classList.add('show');
}

/* ════════════════════════════════
   DATA — Supabase
════════════════════════════════ */
function saveTodosToLS() {
  try {
    localStorage.setItem(`px_todos_${USER_ID}`,    JSON.stringify(todos));
    localStorage.setItem(`px_subs_${USER_ID}`,     JSON.stringify(subtasks));
  } catch {}
}
function loadTodosFromLS() {
  try {
    todos    = JSON.parse(localStorage.getItem(`px_todos_${USER_ID}`)    || '[]');
    subtasks = JSON.parse(localStorage.getItem(`px_subs_${USER_ID}`)     || '[]');
  } catch { todos = []; subtasks = []; }
}

async function loadData() {
  loadTodosFromLS(); // instant paint from cache while Supabase loads
  showLoading(true);
  try {
    const [
      { data: hData,   error: hErr   },
      { data: cData,   error: cErr   },
      { data: catData, error: catErr },
      { data: tData,   error: tErr   },
      { data: sData,   error: sErr   }
    ] = await Promise.all([
      sb.from('habits').select('*').eq('user_id', USER_ID).order('created_at'),
      sb.from('completions').select('habit_id, date').eq('user_id', USER_ID),
      sb.from('categories').select('*').eq('user_id', USER_ID).order('name'),
      sb.from('todos').select('*').eq('user_id', USER_ID).order('order_index'),
      sb.from('subtasks').select('*').eq('user_id', USER_ID).order('order_index')
    ]);

    if (hErr)   throw hErr;
    if (cErr)   throw cErr;
    if (catErr) throw catErr;
    // Todos tables may not exist yet — non-fatal
    if (!tErr) { todos    = tData || []; }
    if (!sErr) { subtasks = sData || []; }
    autoEscalatePriority(); // background — updates in-memory + Supabase, no await needed
    saveTodosToLS();

    const allHabits = hData || [];
    archivedHabits  = allHabits.filter(h => h.archived);
    habits          = allHabits.filter(h => !h.archived);
    completions = {};
    (cData || []).forEach(c => {
      if (!completions[c.habit_id]) completions[c.habit_id] = new Set();
      completions[c.habit_id].add(c.date);
    });

    categories = catData || [];

    /* Seed defaults on first run */
    if (categories.length === 0) await seedDefaultCategories();

  } catch (err) {
    console.error(err);
    showError('Could not connect to database. Check your Supabase config.');
  } finally {
    showLoading(false);
    renderPixel();
  }
}

async function seedDefaultCategories() {
  const rows = DEFAULT_CATEGORIES.map(c => ({
    id:         'default-' + c.name.toLowerCase(),
    name:       c.name,
    color:      c.color,
    created_at: new Date().toISOString().slice(0,10),
    user_id:    USER_ID
  }));
  const { data, error } = await sb.from('categories').insert(rows).select();
  if (!error) categories = data || rows;
}

/* ════════════════════════════════
   NAV
════════════════════════════════ */
function nav(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  const idx = ['pixel','calendar','categories','archive','graph','todo','kanban','timeline','taskcal','daily'].indexOf(id);
  document.querySelectorAll('.nav-item')[idx].classList.add('active');
  if (id === 'pixel')      renderPixel();
  if (id === 'categories') renderCategories();
  if (id === 'graph')      renderGraph();
  if (id === 'archive')    renderArchive();
  if (id === 'calendar')   renderCalendar();
  if (id === 'todo')       renderTodo();
  if (id === 'kanban')     renderKanban();
  if (id === 'timeline')   renderTimeline();
  if (id === 'taskcal')    renderTaskCal();
  if (id === 'daily')      renderDaily();
}

/* ════════════════════════════════
   HABIT MODAL
════════════════════════════════ */
function openModal() {
  renderModalContents();
  document.getElementById('modal-backdrop').classList.add('open');
  setTimeout(() => document.getElementById('f-name').focus(), 60);
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
}
function backdropClick(e) {
  if (e.target === document.getElementById('modal-backdrop')) closeModal();
}

function renderModalContents() {
  document.getElementById('f-colors').innerHTML = PALETTE.map(c =>
    `<div class="swatch${c === selColor ? ' sel' : ''}"
          style="background:${c}"
          onclick="pickColor('${c}')"></div>`
  ).join('');

  /* Populate category dropdown from database */
  const sel = document.getElementById('f-cat');
  const prev = sel.value;
  sel.innerHTML = categories.map(c =>
    `<option value="${c.name}">${c.name}</option>`
  ).join('');
  if (prev && categories.find(c => c.name === prev)) sel.value = prev;

  const el = document.getElementById('modal-habits-list');
  if (!habits.length) {
    el.innerHTML = '<div style="color:var(--dim);font-size:13px;padding:4px 0 8px">No habits yet.</div>';
    return;
  }
  el.innerHTML = habits.map(h => `
    <div class="habit-item">
      <div class="habit-dot" style="background:${h.color}"></div>
      <div class="habit-item-name">${h.name}</div>
      <div class="habit-item-meta">${h.category} · ${h.frequency}</div>
      <button class="arch-btn-sm" onclick="archiveHabit('${h.id}')" title="Archive">⊡</button>
      <button class="del-btn" onclick="delHabit('${h.id}')" title="Remove">×</button>
    </div>`).join('');
}

function pickColor(c) {
  selColor = c;
  document.getElementById('f-colors').innerHTML = PALETTE.map(col =>
    `<div class="swatch${col === selColor ? ' sel' : ''}"
          style="background:${col}"
          onclick="pickColor('${col}')"></div>`
  ).join('');
}

/* ════════════════════════════════
   CATEGORY MODAL
════════════════════════════════ */
function openCatModal() {
  selCatColor = PALETTE[0];
  renderCatModalColors();
  document.getElementById('cat-modal-backdrop').classList.add('open');
  setTimeout(() => document.getElementById('fc-name').focus(), 60);
}
function closeCatModal() {
  document.getElementById('cat-modal-backdrop').classList.remove('open');
  document.getElementById('fc-name').value = '';
}
function catBackdropClick(e) {
  if (e.target === document.getElementById('cat-modal-backdrop')) closeCatModal();
}

function renderCatModalColors() {
  document.getElementById('fc-colors').innerHTML = PALETTE.map(c =>
    `<div class="swatch${c === selCatColor ? ' sel' : ''}"
          style="background:${c}"
          onclick="pickCatColor('${c}')"></div>`
  ).join('');
}
function pickCatColor(c) {
  selCatColor = c;
  renderCatModalColors();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeCatModal(); closeTodoModal(); }
});

/* ════════════════════════════════
   HELPERS
════════════════════════════════ */
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

function dk(y, m, d) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function todayKey() {
  const n = new Date();
  return dk(n.getFullYear(), n.getMonth(), n.getDate());
}
function getSet(hid) {
  return completions[hid] || new Set();
}

function streak(hid) {
  const done = getSet(hid);
  let s = 0, d = new Date(); d.setHours(0,0,0,0);
  if (!done.has(dk(d.getFullYear(), d.getMonth(), d.getDate()))) d.setDate(d.getDate()-1);
  for (let i = 0; i < 999; i++) {
    if (done.has(dk(d.getFullYear(), d.getMonth(), d.getDate()))) {
      s++; d.setDate(d.getDate()-1);
    } else break;
  }
  return s;
}

function rate30(hid) {
  const now = new Date();
  let cnt = 0;
  getSet(hid).forEach(k => {
    const diff = (now - new Date(k+'T00:00:00')) / 86400000;
    if (diff >= 0 && diff < 30) cnt++;
  });
  return Math.round(cnt / 30 * 100);
}

function catColor(catName) {
  const c = categories.find(c => c.name === catName);
  return c ? c.color : '#8b949e';
}

/* ════════════════════════════════
   PIXEL PAGE
════════════════════════════════ */
function shiftMonth(dir) {
  viewMonth.setMonth(viewMonth.getMonth() + dir);
  renderPixel();
}

function renderPixel() {
  const now  = new Date();
  const yr   = viewMonth.getFullYear();
  const mo   = viewMonth.getMonth();
  const days = new Date(yr, mo+1, 0).getDate();
  const moPrefix = `${yr}-${String(mo+1).padStart(2,'0')}`;

  document.getElementById('px-month').textContent = `${MONTHS[mo]} ${yr}`;

  const totalComp = habits.reduce((acc, h) => {
    let n = 0;
    getSet(h.id).forEach(k => { if (k.startsWith(moPrefix)) n++; });
    return acc + n;
  }, 0);
  const bestStreak = habits.reduce((best, h) => Math.max(best, streak(h.id)), 0);

  document.getElementById('px-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Habits tracked</div>
      <div class="stat-value purple">${habits.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Completions this month</div>
      <div class="stat-value pink">${totalComp}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Best streak</div>
      <div class="stat-value green">${bestStreak} day${bestStreak !== 1 ? 's' : ''}</div>
    </div>`;

  if (!habits.length) {
    document.getElementById('px-empty').style.display    = 'block';
    document.getElementById('px-grid-wrap').style.display = 'none';
    return;
  }
  document.getElementById('px-empty').style.display    = 'none';
  document.getElementById('px-grid-wrap').style.display = 'block';

  let hdr = '<div class="grid-header-row">';
  for (let d = 1; d <= days; d++) hdr += `<div class="day-num">${d}</div>`;
  hdr += '</div>';

  let rows = '';
  habits.forEach(h => {
    const done = getSet(h.id);
    rows += `<div class="grid-day-row">
      <div class="grid-habit-label" title="${h.name}">${h.name}</div>`;
    for (let d = 1; d <= days; d++) {
      const key     = dk(yr, mo, d);
      const isDone  = done.has(key);
      const isToday = d === now.getDate() && mo === now.getMonth() && yr === now.getFullYear();
      const isFut   = new Date(yr, mo, d) > now;
      const cls     = 'pixel' + (isToday ? ' today' : '') + (isFut ? ' future' : '');
      const sty     = isDone ? `background:${h.color}` : '';
      const clk     = isFut  ? '' : `onclick="toggle('${h.id}','${key}')"`;
      rows += `<div class="${cls}" style="${sty}" ${clk} title="${h.name} · ${key}"></div>`;
    }
    rows += '</div>';
  });
  document.getElementById('px-grid').innerHTML = hdr + rows;

  let st = '';
  habits.forEach(h => {
    const s   = streak(h.id);
    let cnt = 0;
    getSet(h.id).forEach(k => { if (k.startsWith(moPrefix)) cnt++; });
    const badgeCls = s >= 7 ? 'badge-pink' : s > 0 ? 'badge-green' : 'badge-purple';
    const badgeTxt = s > 0 ? `🔥 ${s} day streak` : 'No streak';
    st += `<div class="streak-row">
      <div class="habit-dot" style="background:${h.color}"></div>
      <div class="streak-name">${h.name}</div>
      <div class="streak-count">${cnt} / ${days} days</div>
      <span class="badge ${badgeCls}">${badgeTxt}</span>
    </div>`;
  });
  document.getElementById('px-streaks').innerHTML = st;
}

async function toggle(hid, key) {
  if (busy) return;
  busy = true;

  const done    = getSet(hid);
  const wasDone = done.has(key);

  if (wasDone) done.delete(key);
  else         done.add(key);
  if (!completions[hid]) completions[hid] = done;
  renderPixel();

  let error;
  if (wasDone) {
    ({ error } = await sb.from('completions')
      .delete().eq('habit_id', hid).eq('date', key).eq('user_id', USER_ID));
  } else {
    ({ error } = await sb.from('completions')
      .insert({ habit_id: hid, date: key, user_id: USER_ID }));
    if (!error) toast('Marked complete ✓');
  }

  if (error) {
    if (wasDone) done.add(key); else done.delete(key);
    renderPixel();
    toast('Sync error — try again');
    console.error(error);
  }

  busy = false;
}

/* ════════════════════════════════
   CATEGORIES PAGE
════════════════════════════════ */
function renderCategories() {
  /* Stats */
  const today = todayKey();
  let mostActiveName = '—';
  let mostActiveRate = -1;
  categories.forEach(cat => {
    const catHabits = habits.filter(h => h.category === cat.name);
    if (!catHabits.length) return;
    const avg = catHabits.reduce((sum, h) => sum + rate30(h.id), 0) / catHabits.length;
    if (avg > mostActiveRate) { mostActiveRate = avg; mostActiveName = cat.name; }
  });
  const uncategorised = habits.filter(h => !categories.find(c => c.name === h.category)).length;

  document.getElementById('cat-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total categories</div>
      <div class="stat-value purple">${categories.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Most active</div>
      <div class="stat-value pink" style="font-size:18px;padding-top:4px">${mostActiveName}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Uncategorised habits</div>
      <div class="stat-value green">${uncategorised}</div>
    </div>`;

  /* Category cards */
  if (!categories.length) {
    document.getElementById('cat-empty').style.display = 'block';
    document.getElementById('cat-grid').style.display  = 'none';
    return;
  }
  document.getElementById('cat-empty').style.display = 'none';
  document.getElementById('cat-grid').style.display  = 'grid';

  document.getElementById('cat-grid').innerHTML = categories.map(cat => {
    const catHabits = habits.filter(h => h.category === cat.name);
    const doneToday = catHabits.filter(h => getSet(h.id).has(today)).length;
    const totalToday = catHabits.length;

    const habitRows = catHabits.length
      ? catHabits.map(h => {
          const s      = streak(h.id);
          const done   = getSet(h.id).has(today);
          const streakBadge = s > 0
            ? `<span class="badge badge-green" style="font-size:10px;padding:2px 7px">🔥 ${s}</span>`
            : '';
          const todayDot = done
            ? `<span style="color:var(--green);font-size:12px">✓</span>`
            : `<span style="color:var(--dim);font-size:12px">✗</span>`;
          return `<div class="cat-habit-row">
            <div class="habit-dot" style="background:${h.color}"></div>
            <div class="cat-habit-name">${h.name}</div>
            ${streakBadge}
            ${todayDot}
          </div>`;
        }).join('')
      : `<div style="font-size:12px;color:var(--dim);padding:8px 0">No habits in this category.</div>`;

    const canDelete = catHabits.length === 0;
    const deleteBtn = canDelete
      ? `<button class="cat-delete-btn" onclick="delCategory('${cat.id}')" title="Delete category">×</button>`
      : `<button class="cat-delete-btn" style="opacity:0.25;cursor:not-allowed" title="Remove all habits first">×</button>`;

    return `<div class="cat-card">
      <div class="cat-card-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:12px;height:12px;border-radius:50%;background:${cat.color};flex-shrink:0"></div>
          <span class="cat-card-name">${cat.name}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="cat-card-count">${totalToday ? `${doneToday}/${totalToday} today` : `${catHabits.length} habits`}</span>
          ${deleteBtn}
        </div>
      </div>
      <div class="cat-habit-list">${habitRows}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════
   ADD / DELETE CATEGORY
════════════════════════════════ */
async function addCategory() {
  const name = document.getElementById('fc-name').value.trim();
  if (!name) { toast('Please enter a category name'); return; }
  if (categories.find(c => c.name.toLowerCase() === name.toLowerCase())) {
    toast('Category already exists'); return;
  }

  const cat = {
    id:         Date.now().toString(36) + Math.random().toString(36).slice(2,5),
    name,
    color:      selCatColor,
    created_at: new Date().toISOString().slice(0,10),
    user_id:    USER_ID
  };

  const btn = document.getElementById('fc-submit');
  btn.textContent = 'Adding…';
  btn.disabled = true;

  const { error } = await sb.from('categories').insert(cat);

  btn.textContent = 'Add category';
  btn.disabled = false;

  if (error) { toast('Error adding category'); console.error(error); return; }

  categories.push(cat);
  categories.sort((a,b) => a.name.localeCompare(b.name));
  toast(`"${name}" added!`);
  closeCatModal();
  renderCategories();
}

async function delCategory(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  if (habits.find(h => h.category === cat.name) || archivedHabits.find(h => h.category === cat.name)) {
    toast('Move or delete all habits in this category first');
    return;
  }

  const { error } = await sb.from('categories').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) { toast('Error deleting category'); console.error(error); return; }

  categories = categories.filter(c => c.id !== id);
  toast(`"${cat.name}" deleted`);
  renderCategories();
}

/* ════════════════════════════════
   ADD / DELETE HABIT
════════════════════════════════ */
async function addHabit() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { toast('Please enter a habit name'); return; }

  const h = {
    id:         Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    name,
    category:   document.getElementById('f-cat').value,
    frequency:  document.getElementById('f-freq').value,
    color:      selColor,
    created_at: new Date().toISOString().slice(0,10),
    user_id:    USER_ID
  };

  const btn = document.querySelector('.modal-footer .btn');
  btn.textContent = 'Adding…';
  btn.disabled = true;

  const { error } = await sb.from('habits').insert(h);

  btn.textContent = 'Add habit';
  btn.disabled = false;

  if (error) { toast('Error adding habit'); console.error(error); return; }

  habits.push(h);
  completions[h.id] = new Set();
  document.getElementById('f-name').value = '';
  toast(`"${name}" added!`);
  renderModalContents();
  renderPixel();
}

async function delHabit(id) {
  const { error } = await sb.from('habits').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) { toast('Error removing habit'); console.error(error); return; }

  habits = habits.filter(h => h.id !== id);
  delete completions[id];
  toast('Habit removed');
  renderModalContents();
  renderPixel();
  if (document.getElementById('page-graph').classList.contains('active'))      renderGraph();
  if (document.getElementById('page-categories').classList.contains('active')) renderCategories();
}

/* ════════════════════════════════
   GRAPH PAGE
════════════════════════════════ */
function setRange(n, btn) {
  chartRange = n;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderGraph();
}

function rollingAvg(arr, win) {
  return arr.map((_, i) => {
    const sl = arr.slice(Math.max(0, i - Math.floor(win/2)), i + Math.ceil(win/2) + 1);
    return sl.reduce((a, b) => a + b, 0) / sl.length;
  });
}

function renderGraph() {
  if (!habits.length) {
    document.getElementById('gr-empty').style.display   = 'block';
    document.getElementById('gr-content').style.display = 'none';
    if (chart) { chart.destroy(); chart = null; }
    return;
  }
  document.getElementById('gr-empty').style.display   = 'none';
  document.getElementById('gr-content').style.display = 'block';

  /* Populate category dropdown */
  const filterEl  = document.getElementById('gr-cat-filter');
  const selCat    = filterEl.value;
  filterEl.innerHTML = '<option value="">All categories</option>' +
    categories.map(c => `<option value="${c.name}"${c.name === selCat ? ' selected' : ''}>${c.name}</option>`).join('');

  /* Filter habits by selected category */
  const filtered = selCat ? habits.filter(h => h.category === selCat) : habits;

  const now   = new Date(); now.setHours(0,0,0,0);
  const total = filtered.length;
  const dates  = [];
  const labels = [];
  const rawPct = []; // daily (done / total) * 100

  for (let i = chartRange - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const key = dk(d.getFullYear(), d.getMonth(), d.getDate());
    dates.push(key);

    const done = filtered.filter(h => getSet(h.id).has(key)).length;
    rawPct.push(Math.round(done / total * 100));

    const show = chartRange <= 14 ? true
               : chartRange <= 30 ? (i % 5  === 0 || i === 0)
               :                    (i % 15 === 0 || i === 0);
    labels.push(show ? `${d.getDate()}/${d.getMonth()+1}` : '');
  }

  /* Smooth only on longer ranges */
  const win  = chartRange <= 7 ? 1 : chartRange <= 14 ? 3 : 5;
  const data = win > 1 ? rollingAvg(rawPct, win) : rawPct;

  /* Summary stats */
  const validDays  = rawPct.filter((_, i) => {
    const d = new Date(now); d.setDate(now.getDate() - (chartRange - 1 - i));
    return d <= now;
  });
  const avgPct  = validDays.length ? Math.round(validDays.reduce((a,b)=>a+b,0) / validDays.length) : 0;
  const bestPct = validDays.length ? Math.max(...validDays) : 0;
  const todayPct = rawPct[rawPct.length - 1] ?? 0;

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('gr-canvas'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:               'Daily completion',
        data,
        borderColor:         '#9d7de8',
        backgroundColor:     '#9d7de820',
        fill:                true,
        tension:             0.42,
        pointRadius:         chartRange > 30 ? 0 : 4,
        pointHoverRadius:    7,
        pointBackgroundColor: '#9d7de8',
        borderWidth:         2.5
      }]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2230',
          borderColor:     'rgba(255,255,255,0.09)',
          borderWidth:     1,
          titleColor:      '#8b949e',
          bodyColor:       '#e6edf3',
          padding:         12,
          callbacks: {
            label: ctx => {
              const idx  = ctx.dataIndex;
              const done = filtered.filter(h => getSet(h.id).has(dates[idx])).length;
              return ` ${done} / ${total} habits  (${rawPct[idx]}%)`;
            }
          }
        }
      },
      scales: {
        x: {
          grid:   { color: 'rgba(255,255,255,0.04)' },
          ticks:  { color: '#8b949e', font: { size: 10.5 } },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        y: {
          min: 0, max: 100,
          grid:   { color: 'rgba(255,255,255,0.04)' },
          border: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#8b949e', font: { size: 10.5 },
            callback: v => v + '%',
            stepSize: 25
          }
        }
      }
    }
  });

  /* Summary stat chips below chart */
  document.getElementById('gr-legend').innerHTML = `
    <div class="legend-item">
      <div class="legend-dot" style="background:#9d7de8"></div>
      Daily completion (${total} habit${total !== 1 ? 's' : ''}${selCat ? ` · ${selCat}` : ''})
    </div>`;

  /* Per-habit breakdown cards */
  document.getElementById('gr-stats').innerHTML = filtered.map(h => {
    const s   = streak(h.id);
    const r   = rate30(h.id);
    const tot = getSet(h.id).size;
    return `<div class="hstat-card">
      <div class="hstat-name">
        <div class="habit-dot" style="background:${h.color};width:11px;height:11px"></div>
        ${h.name}
        <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:2px">${h.category}</span>
      </div>
      <div class="hstat-nums">
        <div class="hstat-num">
          <div class="hstat-val" style="color:var(--accent-light)">${s}</div>
          <div class="hstat-lbl">streak</div>
        </div>
        <div class="hstat-num">
          <div class="hstat-val" style="color:var(--pink)">${r}%</div>
          <div class="hstat-lbl">30-day rate</div>
        </div>
        <div class="hstat-num">
          <div class="hstat-val" style="color:var(--green)">${tot}</div>
          <div class="hstat-lbl">all time</div>
        </div>
      </div>
      <div class="prog-bar">
        <div class="prog-fill" style="width:${Math.min(r,100)}%;background:${h.color}"></div>
      </div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════
   ARCHIVE PAGE
════════════════════════════════ */
async function archiveHabit(id) {
  const h = habits.find(h => h.id === id);
  if (!h) return;
  const { error } = await sb.from('habits').update({ archived: true }).eq('id', id).eq('user_id', USER_ID);
  if (error) { toast('Error archiving habit'); console.error(error); return; }
  habits = habits.filter(h => h.id !== id);
  h.archived = true;
  archivedHabits.push(h);
  toast(`"${h.name}" archived`);
  renderModalContents();
  renderPixel();
}

async function unarchiveHabit(id) {
  const h = archivedHabits.find(h => h.id === id);
  if (!h) return;
  const { error } = await sb.from('habits').update({ archived: false }).eq('id', id).eq('user_id', USER_ID);
  if (error) { toast('Error restoring habit'); console.error(error); return; }
  archivedHabits = archivedHabits.filter(h => h.id !== id);
  h.archived = false;
  habits.push(h);
  toast(`"${h.name}" restored`);
  renderArchive();
}

async function delArchivedHabit(id) {
  const h = archivedHabits.find(h => h.id === id);
  if (!h) return;
  if (!confirm(`Permanently delete "${h.name}" and all its history?`)) return;
  const { error } = await sb.from('habits').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) { toast('Error deleting habit'); console.error(error); return; }
  archivedHabits = archivedHabits.filter(h => h.id !== id);
  delete completions[id];
  toast(`"${h.name}" deleted permanently`);
  renderArchive();
}

function renderArchive() {
  const totalComp = archivedHabits.reduce((s, h) => s + getSet(h.id).size, 0);
  document.getElementById('arch-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Archived habits</div>
      <div class="stat-value purple">${archivedHabits.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Preserved completions</div>
      <div class="stat-value pink">${totalComp}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Active habits</div>
      <div class="stat-value green">${habits.length}</div>
    </div>`;

  if (!archivedHabits.length) {
    document.getElementById('arch-empty').style.display = 'block';
    document.getElementById('arch-list').style.display  = 'none';
    return;
  }
  document.getElementById('arch-empty').style.display = 'none';
  document.getElementById('arch-list').style.display  = 'grid';

  document.getElementById('arch-list').innerHTML = archivedHabits.map(h => {
    const tot = getSet(h.id).size;
    const s   = streak(h.id);
    const r   = rate30(h.id);
    return `<div class="arch-card">
      <div class="arch-card-header">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <div class="habit-dot" style="background:${h.color};width:11px;height:11px;flex-shrink:0"></div>
          <span class="arch-name">${h.name}</span>
          <span class="arch-meta">${h.category} · ${h.frequency}</span>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn" style="padding:5px 12px;font-size:12px" onclick="unarchiveHabit('${h.id}')">Restore</button>
          <button class="btn arch-del-btn" onclick="delArchivedHabit('${h.id}')">Delete</button>
        </div>
      </div>
      <div class="arch-nums">
        <div class="hstat-num">
          <div class="hstat-val" style="color:var(--green)">${tot}</div>
          <div class="hstat-lbl">all time</div>
        </div>
        <div class="hstat-num">
          <div class="hstat-val" style="color:var(--accent-light)">${s}</div>
          <div class="hstat-lbl">streak</div>
        </div>
        <div class="hstat-num">
          <div class="hstat-val" style="color:var(--pink)">${r}%</div>
          <div class="hstat-lbl">30-day rate</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════
   CALENDAR PAGE
════════════════════════════════ */
function heatColor(pct) {
  if (pct <= 50) {
    const t = pct / 50;
    return `rgb(${Math.round(239+(234-239)*t)},${Math.round(68+(179-68)*t)},${Math.round(68+(8-68)*t)})`;
  }
  const t = (pct - 50) / 50;
  return `rgb(${Math.round(234+(16-234)*t)},${Math.round(179+(185-179)*t)},${Math.round(8+(129-8)*t)})`;
}

function shiftYear(dir) {
  calYear += dir;
  renderCalendar();
}

function renderCalendar() {
  const yr    = calYear;
  const today = new Date(); today.setHours(0,0,0,0);
  const allH  = [...habits, ...archivedHabits];

  document.getElementById('cal-year').textContent = yr;

  /* Build week grid (Sun→Sat columns) */
  const jan1    = new Date(yr, 0, 1);
  const startDay = new Date(jan1); startDay.setDate(startDay.getDate() - startDay.getDay());
  const dec31   = new Date(yr, 11, 31);
  const endDay  = new Date(dec31); endDay.setDate(endDay.getDate() + (6 - endDay.getDay()));

  const weeks = [];
  const cur   = new Date(startDay);
  while (cur <= endDay) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const day     = new Date(cur);
      const inYear  = day.getFullYear() === yr;
      const isFut   = day > today;
      const key     = dk(day.getFullYear(), day.getMonth(), day.getDate());
      let pct = null;
      if (inYear && !isFut && allH.length > 0) {
        const done = allH.filter(h => getSet(h.id).has(key)).length;
        pct = Math.round(done / allH.length * 100);
      }
      week.push({ day, key, inYear, isFut, pct });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  /* Stats */
  let activeDays = 0, totalComp = 0, bestPct = 0;
  weeks.flat().forEach(c => {
    if (!c.inYear || c.isFut || c.pct === null) return;
    totalComp += allH.filter(h => getSet(h.id).has(c.key)).length;
    if (c.pct > 0)    activeDays++;
    if (c.pct > bestPct) bestPct = c.pct;
  });

  document.getElementById('cal-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Active days</div>
      <div class="stat-value purple">${activeDays}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total completions</div>
      <div class="stat-value pink">${totalComp}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Best day</div>
      <div class="stat-value green">${bestPct}%</div>
    </div>`;

  /* Month labels */
  const monthLabels = weeks.map(week => {
    const first = week.find(c => c.inYear && c.day.getDate() === 1);
    return first ? MONTHS[first.day.getMonth()].slice(0, 3) : '';
  });

  const DOW = ['S','M','T','W','T','F','S'];

  let html = `<div class="cal-wrap"><div class="cal-grid">`;

  /* Month header */
  html += `<div class="cal-month-row"><div class="cal-row-lbl"></div>`;
  weeks.forEach((_, wi) => {
    html += `<div class="cal-month-cell">${monthLabels[wi]}</div>`;
  });
  html += `</div>`;

  /* Day rows */
  for (let dow = 0; dow < 7; dow++) {
    html += `<div class="cal-day-row"><div class="cal-row-lbl">${DOW[dow]}</div>`;
    weeks.forEach(week => {
      const c = week[dow];
      let bg;
      if (!c.inYear)              bg = 'transparent';
      else if (c.isFut || c.pct === null) bg = 'rgba(255,255,255,0.04)';
      else                        bg = heatColor(c.pct);
      const tip = c.inYear && !c.isFut && c.pct !== null ? `${c.key} · ${c.pct}%` : c.inYear ? c.key : '';
      html += `<div class="cal-cell" style="background:${bg}" title="${tip}"></div>`;
    });
    html += `</div>`;
  }

  html += `</div>`;

  /* Legend */
  html += `<div class="cal-legend">
    <span>Less</span>
    ${[0,25,50,75,100].map(p =>
      `<div class="cal-lgnd-cell" style="background:${p===0?'rgba(255,255,255,0.04)':heatColor(p)}"></div>`
    ).join('')}
    <span>More</span>
  </div></div>`;

  document.getElementById('cal-content').innerHTML = html;
}

/* ════════════════════════════════
   AUTO-PRIORITY ESCALATION
════════════════════════════════ */
const PRIO_RANK = { low: 0, medium: 1, high: 2 };

async function autoEscalatePriority() {
  const today = new Date(); today.setHours(0,0,0,0);
  const toUpdate = [];

  todos.forEach(t => {
    if (t.completed)                          return; // skip done
    if (!t.due_date)                          return; // no deadline, nothing to escalate
    if ((t.tags || []).includes('daily'))     return; // exclude daily tasks

    const daysUntil = Math.round((new Date(t.due_date + 'T00:00:00') - today) / 86400000);

    const needed = daysUntil <= 7 ? 'high' : daysUntil <= 14 ? 'medium' : null;
    if (!needed) return;                             // more than 2 weeks away

    if ((PRIO_RANK[needed] ?? 1) > (PRIO_RANK[t.priority] ?? 1)) {
      toUpdate.push({ id: t.id, priority: needed });
      t.priority = needed;                           // optimistic in-memory update
    }
  });

  if (!toUpdate.length) return;

  saveTodosToLS();
  await Promise.all(
    toUpdate.map(u =>
      sb.from('todos').update({ priority: u.priority })
        .eq('id', u.id).eq('user_id', USER_ID)
    )
  );
}

/* ════════════════════════════════
   TODO — MODAL
════════════════════════════════ */
function openTodoModal(id = null) {
  todoEditId = id;
  const isEdit = !!id;
  document.getElementById('todo-modal-title').textContent = isEdit ? 'Edit task' : 'Add task';
  document.getElementById('ft-submit').textContent        = isEdit ? 'Save changes' : 'Add task';

  if (isEdit) {
    const t = todos.find(t => t.id === id);
    document.getElementById('ft-text').value     = t.text;
    document.getElementById('ft-priority').value = t.priority;
    document.getElementById('ft-due').value      = t.due_date || '';
    document.getElementById('ft-tags').value     = (t.tags || []).join(', ');
  } else {
    document.getElementById('ft-text').value     = '';
    document.getElementById('ft-priority').value = 'medium';
    document.getElementById('ft-due').value      = '';
    document.getElementById('ft-tags').value     = '';
  }

  document.getElementById('todo-modal-backdrop').classList.add('open');
  setTimeout(() => document.getElementById('ft-text').focus(), 60);
}

function closeTodoModal() {
  document.getElementById('todo-modal-backdrop').classList.remove('open');
  todoEditId = null;
}
function todoBackdropClick(e) {
  if (e.target === document.getElementById('todo-modal-backdrop')) closeTodoModal();
}

async function saveTodo() {
  const text = document.getElementById('ft-text').value.trim();
  if (!text) { toast('Please enter a task'); return; }

  const priority = document.getElementById('ft-priority').value;
  const due_date = document.getElementById('ft-due').value || null;
  const tagsRaw  = document.getElementById('ft-tags').value;
  const tags     = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const btn = document.getElementById('ft-submit');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  if (todoEditId) {
    /* ── Edit ── */
    const { error } = await sb.from('todos')
      .update({ text, priority, due_date, tags })
      .eq('id', todoEditId).eq('user_id', USER_ID);

    if (error) { toast('Error saving task'); console.error(error); }
    else {
      Object.assign(todos.find(t => t.id === todoEditId), { text, priority, due_date, tags });
      saveTodosToLS();
      toast('Task updated');
      closeTodoModal();
      renderTodo();
    }
  } else {
    /* ── Add ── */
    const t = {
      id:          Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      user_id:     USER_ID,
      text, priority, due_date, tags,
      completed:   false,
      order_index: todos.length,
      created_at:  new Date().toISOString().slice(0,10)
    };
    const { error } = await sb.from('todos').insert(t);
    if (error) { toast('Error adding task'); console.error(error); }
    else {
      todos.push(t);
      saveTodosToLS();
      toast(`Task added!`);
      closeTodoModal();
      renderTodo();
    }
  }

  btn.textContent = todoEditId ? 'Save changes' : 'Add task';
  btn.disabled = false;
}

/* ════════════════════════════════
   TODO — CRUD
════════════════════════════════ */
async function toggleTodo(id) {
  const t = todos.find(t => t.id === id);
  if (!t) return;
  /* Daily tasks delete on completion wherever they're toggled */
  if (!t.completed && (t.tags || []).includes('daily')) {
    await completeDailyTodo(id);
    return;
  }
  const was       = t.completed;
  const wasStatus = t.status || (was ? 'done' : 'todo');
  t.completed     = !was;
  t.status        = t.completed ? 'done' : 'todo';
  saveTodosToLS();
  renderTodo();
  if (document.getElementById('page-kanban').classList.contains('active')) renderKanban();

  const { error } = await sb.from('todos')
    .update({ completed: t.completed, status: t.status })
    .eq('id', id).eq('user_id', USER_ID);

  if (error) {
    t.completed = was;
    t.status    = wasStatus;
    saveTodosToLS();
    renderTodo();
    toast('Sync error — try again');
  }
}

async function deleteTodo(id) {
  const prevTodos = [...todos];
  const prevSubs  = [...subtasks];
  todos    = todos.filter(t => t.id !== id);
  subtasks = subtasks.filter(s => s.todo_id !== id);
  openPanels.delete(id);
  saveTodosToLS();
  renderTodo();

  const { error } = await sb.from('todos').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) {
    todos    = prevTodos;
    subtasks = prevSubs;
    saveTodosToLS();
    renderTodo();
    toast('Error deleting task');
  } else {
    toast('Task deleted');
  }
}

/* ── Inline edit ── */
function startEditTodo(id, el) {
  if (el.querySelector('input')) return;
  const t = todos.find(t => t.id === id);
  if (!t) return;

  const inp = document.createElement('input');
  inp.className = 'todo-inline-input';
  inp.value     = t.text;
  inp.onclick   = e => e.stopPropagation();
  inp.onblur    = () => finishInlineEdit(id, inp.value, el, t.text);
  inp.onkeydown = e => {
    if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { inp.onblur = null; el.textContent = t.text; }
  };
  el.textContent = '';
  el.appendChild(inp);
  inp.focus();
  inp.select();
}

async function finishInlineEdit(id, newText, el, original) {
  newText = newText.trim();
  if (!newText || newText === original) { el.textContent = original; return; }
  el.textContent = newText;
  const t = todos.find(t => t.id === id);
  if (t) t.text = newText;
  saveTodosToLS();

  const { error } = await sb.from('todos')
    .update({ text: newText }).eq('id', id).eq('user_id', USER_ID);
  if (error) { toast('Error saving'); if (t) t.text = original; saveTodosToLS(); }
}

/* ════════════════════════════════
   SUBTASKS
════════════════════════════════ */
function getTodoSubtasks(todoId) {
  return subtasks.filter(s => s.todo_id === todoId)
                 .sort((a, b) => a.order_index - b.order_index);
}

function toggleSubtaskPanel(todoId) {
  const el = document.getElementById(`subtasks-${todoId}`);
  if (!el) return;
  if (openPanels.has(todoId)) {
    openPanels.delete(todoId);
    el.style.display = 'none';
  } else {
    openPanels.add(todoId);
    el.style.display = 'block';
  }
}

async function addSubtask(todoId, inp) {
  const text = inp.value.trim();
  if (!text) return;
  const s = {
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    user_id:     USER_ID,
    todo_id:     todoId,
    text,
    completed:   false,
    order_index: subtasks.filter(s => s.todo_id === todoId).length,
    created_at:  new Date().toISOString().slice(0,10)
  };
  subtasks.push(s);
  openPanels.add(todoId);
  inp.value = '';
  saveTodosToLS();
  renderTodo();

  const { error } = await sb.from('subtasks').insert(s);
  if (error) {
    subtasks = subtasks.filter(s2 => s2.id !== s.id);
    saveTodosToLS();
    renderTodo();
    toast('Error adding subtask');
  }
}

async function toggleSubtask(id) {
  const s = subtasks.find(s => s.id === id);
  if (!s) return;
  const was = s.completed;
  s.completed = !was;
  openPanels.add(s.todo_id);
  saveTodosToLS();
  renderTodo();

  const { error } = await sb.from('subtasks')
    .update({ completed: s.completed }).eq('id', id).eq('user_id', USER_ID);
  if (error) {
    s.completed = was;
    saveTodosToLS();
    renderTodo();
    toast('Sync error');
  }
}

async function deleteSubtask(id, todoId) {
  const prev = [...subtasks];
  subtasks = subtasks.filter(s => s.id !== id);
  openPanels.add(todoId);
  saveTodosToLS();
  renderTodo();

  const { error } = await sb.from('subtasks').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) {
    subtasks = prev;
    saveTodosToLS();
    renderTodo();
    toast('Error deleting subtask');
  }
}

/* ════════════════════════════════
   DRAG & DROP
════════════════════════════════ */
function tdDragStart(e, id) {
  tdDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => {
    const el = document.getElementById('todo-' + id);
    if (el) el.classList.add('td-dragging');
  }, 0);
}
function tdDragOver(e, id) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (id === tdDragId) return;
  document.querySelectorAll('.todo-card').forEach(c => c.classList.remove('td-drag-over'));
  const el = document.getElementById('todo-' + id);
  if (el) el.classList.add('td-drag-over');
}
function tdDragLeave(e, id) {
  const el = document.getElementById('todo-' + id);
  if (el) el.classList.remove('td-drag-over');
}
function tdDragEnd() {
  document.querySelectorAll('.todo-card').forEach(c => {
    c.classList.remove('td-dragging');
    c.classList.remove('td-drag-over');
  });
  tdDragId = null;
}
function tdDrop(e, targetId) {
  e.preventDefault();
  if (!tdDragId || tdDragId === targetId) return;

  const fromIdx = todos.findIndex(t => t.id === tdDragId);
  const toIdx   = todos.findIndex(t => t.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  const [item] = todos.splice(fromIdx, 1);
  todos.splice(toIdx, 0, item);
  todos.forEach((t, i) => t.order_index = i);

  saveTodosToLS();
  renderTodo();

  clearTimeout(reorderTimer);
  reorderTimer = setTimeout(() => {
    Promise.all(todos.map(t =>
      sb.from('todos').update({ order_index: t.order_index })
        .eq('id', t.id).eq('user_id', USER_ID)
    ));
  }, 600);
}

/* ════════════════════════════════
   TODO — RENDER
════════════════════════════════ */
function fmtDate(str) {
  if (!str) return '';
  const [, m, d] = str.split('-');
  return `${parseInt(d)}/${parseInt(m)}`;
}

function renderTodo() {
  if (!document.getElementById('todo-stats')) return;

  /* Stats */
  const total     = todos.length;
  const completed = todos.filter(t => t.completed).length;
  const overdue   = todos.filter(t => !t.completed && t.due_date && t.due_date < todayKey()).length;
  document.getElementById('todo-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total tasks</div>
      <div class="stat-value purple">${total}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Completed</div>
      <div class="stat-value green">${completed}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Overdue</div>
      <div class="stat-value pink">${overdue}</div>
    </div>`;

  /* Gather filter values */
  const search  = (document.getElementById('todo-search')?.value || '').toLowerCase();
  const fStatus = document.getElementById('todo-filter-status')?.value  || '';
  const fPrio   = document.getElementById('todo-filter-priority')?.value || '';
  const fTag    = document.getElementById('todo-filter-tag')?.value     || '';

  /* Rebuild tag dropdown */
  const allTags = [...new Set(todos.flatMap(t => t.tags || []))].sort();
  const tagEl   = document.getElementById('todo-filter-tag');
  if (tagEl) tagEl.innerHTML =
    '<option value="">Any tag</option>' +
    allTags.map(tag => `<option value="${tag}"${tag === fTag ? ' selected' : ''}>${tag}</option>`).join('');

  /* Filter */
  const filtered = todos.filter(t => {
    if (search && !t.text.toLowerCase().includes(search)) return false;
    if (fStatus === 'active'    &&  t.completed)          return false;
    if (fStatus === 'completed' && !t.completed)           return false;
    if (fPrio && t.priority !== fPrio)                     return false;
    if (fTag && !(t.tags || []).includes(fTag))            return false;
    return true;
  });

  if (!filtered.length) {
    document.getElementById('todo-empty').style.display = 'block';
    document.getElementById('todo-list').style.display  = 'none';
    return;
  }
  document.getElementById('todo-empty').style.display = 'none';
  document.getElementById('todo-list').style.display  = 'block';

  const today = todayKey();

  document.getElementById('todo-list').innerHTML = filtered.map(t => {
    const subs     = getTodoSubtasks(t.id);
    const subsDone = subs.filter(s => s.completed).length;
    const prioKey  = t.priority || 'medium';

    /* Due date badge */
    let dueBadge = '';
    if (t.due_date) {
      if (!t.completed && t.due_date < today)
        dueBadge = `<span class="todo-due-badge overdue">⚠ ${fmtDate(t.due_date)}</span>`;
      else if (!t.completed && t.due_date === today)
        dueBadge = `<span class="todo-due-badge due-today">Today</span>`;
      else
        dueBadge = `<span class="todo-due-badge">${fmtDate(t.due_date)}</span>`;
    }

    /* Tags */
    const tagChips = (t.tags || []).map(tag =>
      `<span class="todo-tag">${tag}</span>`).join('');

    /* Subtask badge */
    const subsBadge = subs.length
      ? `<span class="todo-subs-badge${subsDone === subs.length ? ' all-done' : ''}"
              onclick="toggleSubtaskPanel('${t.id}')">☑ ${subsDone}/${subs.length}</span>`
      : '';

    /* Subtask panel HTML */
    const subsHtml = [
      ...subs.map(s => `
        <div class="subtask-item${s.completed ? ' done' : ''}">
          <button class="subtask-check${s.completed ? ' checked' : ''}"
                  onclick="toggleSubtask('${s.id}')"></button>
          <span class="subtask-text">${s.text}</span>
          <button class="subtask-del" onclick="deleteSubtask('${s.id}','${t.id}')">×</button>
        </div>`),
      `<div class="subtask-add-row">
         <input class="subtask-add-input" placeholder="Add subtask…"
                onkeydown="if(event.key==='Enter') addSubtask('${t.id}',this)">
       </div>`
    ].join('');

    return `
    <div class="todo-card ${prioKey !== 'medium' ? 'prio-' + prioKey : 'prio-medium'}${t.completed ? ' td-done' : ''}"
         id="todo-${t.id}"
         draggable="true"
         ondragstart="tdDragStart(event,'${t.id}')"
         ondragover="tdDragOver(event,'${t.id}')"
         ondragleave="tdDragLeave(event,'${t.id}')"
         ondragend="tdDragEnd()"
         ondrop="tdDrop(event,'${t.id}')">
      <div class="todo-main">
        <button class="todo-check${t.completed ? ' checked' : ''}"
                onclick="toggleTodo('${t.id}')"></button>
        <div class="todo-content">
          <div class="todo-text${t.completed ? ' td-strikethrough' : ''}"
               ondblclick="startEditTodo('${t.id}',this)"
               title="Double-click to edit">${t.text}</div>
          <div class="todo-meta">
            <span class="todo-prio-badge prio-${prioKey}">${prioKey}</span>
            ${tagChips}${dueBadge}${subsBadge}
          </div>
        </div>
        <div class="todo-actions">
          <button class="todo-action-btn" onclick="toggleSubtaskPanel('${t.id}')" title="Subtasks">☰</button>
          <button class="todo-action-btn" onclick="openTodoModal('${t.id}')" title="Edit">✎</button>
          <button class="todo-action-btn del" onclick="deleteTodo('${t.id}')" title="Delete">×</button>
        </div>
      </div>
      <div class="subtask-panel" id="subtasks-${t.id}" style="display:none">
        ${subsHtml}
      </div>
    </div>`;
  }).join('');

  /* Restore expanded subtask panels */
  openPanels.forEach(id => {
    const el = document.getElementById(`subtasks-${id}`);
    if (el) el.style.display = 'block';
  });
}

/* ════════════════════════════════
   GANTT CHART
════════════════════════════════ */
function setGanttRange(n, btn) {
  ganttRange = n;
  document.getElementById('timeline-content')
    .querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTimeline();
}
function shiftGantt(dir) {
  ganttOffset += dir * Math.max(1, Math.floor(ganttRange / 3));
  renderTimeline();
}
function fmtDateLong(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${parseInt(d)} ${MONTHS[parseInt(m)-1].slice(0,3)} ${y}`;
}

function renderTimeline() {
  if (!document.getElementById('timeline-content')) return;

  const CELL_W  = 32;
  const LABEL_W = 164;
  const PRIO_COLOR = { high: '#ef4444', medium: '#eab308', low: '#10b981' };

  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  const rangeStart = new Date(todayDate);
  rangeStart.setDate(todayDate.getDate() + ganttOffset);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeStart.getDate() + ganttRange - 1);

  const todayStr = todayKey();
  const rsKey = dk(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const reKey = dk(rangeEnd.getFullYear(),   rangeEnd.getMonth(),   rangeEnd.getDate());

  /* Build dates array */
  const dates = [];
  for (const d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1))
    dates.push(new Date(d));
  const numDays = dates.length;
  const totalW  = numDays * CELL_W;
  const todayCol = Math.round((todayDate - rangeStart) / 86400000);

  function dayOff(str) {
    return Math.round((new Date(str + 'T00:00:00') - rangeStart) / 86400000);
  }

  /* Tasks with due dates, sorted by start */
  const scheduled = todos
    .filter(t => t.due_date)
    .sort((a, b) => (a.created_at || a.due_date).localeCompare(b.created_at || b.due_date));
  const unscheduled = todos.filter(t => !t.due_date);

  /* Month label row data */
  let lastMo = -1;
  const moLabels = dates.map(d => {
    if (d.getMonth() !== lastMo) { lastMo = d.getMonth(); return MONTHS[d.getMonth()].slice(0,3); }
    return '';
  });

  let html = `
  <div class="gantt-controls">
    <div class="range-row" style="margin-bottom:0">
      <button class="range-btn${ganttRange===14?' active':''}" onclick="setGanttRange(14,this)">14d</button>
      <button class="range-btn${ganttRange===30?' active':''}" onclick="setGanttRange(30,this)">30d</button>
      <button class="range-btn${ganttRange===60?' active':''}" onclick="setGanttRange(60,this)">60d</button>
      <button class="range-btn${ganttRange===90?' active':''}" onclick="setGanttRange(90,this)">90d</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <button class="month-btn" onclick="shiftGantt(-1)">‹</button>
      <span style="font-size:11px;color:var(--muted);min-width:170px;text-align:center">
        ${fmtDateLong(rsKey)} – ${fmtDateLong(reKey)}
      </span>
      <button class="month-btn" onclick="shiftGantt(1)">›</button>
    </div>
  </div>
  <div class="gantt-scroll">
    <div style="min-width:${LABEL_W + totalW}px">`;

  /* Month row */
  html += `<div class="gantt-hdr-row" style="padding-left:${LABEL_W}px">`;
  moLabels.forEach(lbl => {
    html += `<div class="gantt-date-cell" style="width:${CELL_W}px;font-size:9px;color:var(--accent-light);font-weight:700;line-height:1.6">${lbl}</div>`;
  });
  html += `</div>`;

  /* Day number row */
  html += `<div class="gantt-hdr-row" style="padding-left:${LABEL_W}px;margin-bottom:6px">`;
  dates.forEach(d => {
    const key = dk(d.getFullYear(), d.getMonth(), d.getDate());
    const isT  = key === todayStr;
    const isWe = d.getDay() === 0 || d.getDay() === 6;
    html += `<div class="gantt-date-cell${isT?' gantt-today-hdr':''}${isWe?' gantt-weekend':''}" style="width:${CELL_W}px">${d.getDate()}</div>`;
  });
  html += `</div>`;

  /* Task rows */
  const todayLine = todayCol >= 0 && todayCol < numDays
    ? `<div class="gantt-today-line" style="left:${todayCol * CELL_W + CELL_W/2}px"></div>` : '';

  if (!scheduled.length) {
    html += `<div style="padding:32px 0;text-align:center;color:var(--muted);font-size:13px">
      No tasks with due dates in this range.
      <button class="btn" style="margin-left:10px;font-size:12px;padding:4px 12px" onclick="shiftGantt(-1)">← Earlier</button>
    </div>`;
  } else {
    scheduled.forEach(t => {
      const color     = PRIO_COLOR[t.priority] || PRIO_COLOR.medium;
      const isDone    = t.completed || todoStatus(t) === 'done';
      const startStr  = t.created_at || todayStr;
      const endStr    = t.due_date;
      const rawStart  = dayOff(startStr);
      const rawEnd    = dayOff(endStr);

      /* Skip if entirely outside view */
      if (rawEnd < 0 || rawStart >= numDays) return;

      const cs = Math.max(0,          rawStart);
      const ce = Math.min(numDays - 1, rawEnd);
      const barLeft  = cs * CELL_W;
      const barWidth = Math.max(CELL_W, (ce - cs + 1) * CELL_W);
      const clipL = rawStart < 0;
      const clipR = rawEnd >= numDays;
      const rTL = clipL ? 0 : 5, rTR = clipR ? 0 : 5;

      html += `
      <div class="gantt-row">
        <div class="gantt-label-col" style="width:${LABEL_W}px">
          <div class="habit-dot" style="background:${color};width:8px;height:8px;flex-shrink:0"></div>
          <span class="gantt-task-name${isDone?' td-strikethrough':''}" title="${t.text}">${t.text}</span>
        </div>
        <div class="gantt-track" style="width:${totalW}px;background-size:${CELL_W}px 100%">
          ${todayLine}
          <div class="gantt-bar${isDone?' gantt-bar-done':''}"
               style="left:${barLeft}px;width:${barWidth}px;background:${color};
                      border-radius:${rTL}px ${rTR}px ${rTR}px ${rTL}px"
               onclick="openTodoModal('${t.id}')"
               title="${t.text}&#10;${fmtDateLong(startStr)} → ${fmtDateLong(endStr)}">
            <span class="gantt-bar-label">${clipL?'◄ ':''}${t.text}${clipR?' ►':''}</span>
          </div>
        </div>
      </div>`;
    });
  }

  html += `</div></div>`;

  /* Unscheduled tasks */
  if (unscheduled.length) {
    html += `<div class="section-label" style="margin-top:26px">Unscheduled</div>
    <div style="display:flex;flex-direction:column;gap:7px">
    ${unscheduled.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:13px">
        <div class="habit-dot" style="background:${PRIO_COLOR[t.priority]||PRIO_COLOR.medium};width:8px;height:8px;flex-shrink:0"></div>
        <span style="flex:1;color:var(--muted)">${t.text}</span>
        <button class="todo-action-btn" onclick="openTodoModal('${t.id}')" title="Add due date">✎</button>
      </div>`).join('')}
    </div>`;
  }

  document.getElementById('timeline-content').innerHTML = html;
}

/* ════════════════════════════════
   TASK CALENDAR
════════════════════════════════ */
function shiftTaskCal(dir) {
  taskCalMonth.setMonth(taskCalMonth.getMonth() + dir);
  renderTaskCal();
}

function renderTaskCal() {
  if (!document.getElementById('taskcal-content')) return;

  const yr      = taskCalMonth.getFullYear();
  const mo      = taskCalMonth.getMonth();
  const days    = new Date(yr, mo + 1, 0).getDate();
  const firstDow = new Date(yr, mo, 1).getDay(); // 0 = Sun
  const today   = todayKey();
  const moPrefix = `${yr}-${String(mo + 1).padStart(2, '0')}`;

  document.getElementById('taskcal-month').textContent = `${MONTHS[mo]} ${yr}`;

  /* Build date → tasks map for this month */
  const taskMap = {};
  todos.forEach(t => {
    if (!t.due_date || !t.due_date.startsWith(moPrefix)) return;
    if (!taskMap[t.due_date]) taskMap[t.due_date] = [];
    taskMap[t.due_date].push(t);
  });

  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = `<div class="taskcal-wrap"><div class="taskcal-grid">`;

  /* Day-of-week headers */
  DOW.forEach(d => { html += `<div class="taskcal-dow">${d}</div>`; });

  /* Blank cells before the 1st */
  for (let i = 0; i < firstDow; i++) {
    html += `<div class="taskcal-cell tc-other"></div>`;
  }

  /* Day cells */
  for (let d = 1; d <= days; d++) {
    const key    = dk(yr, mo, d);
    const isToday = key === today;
    const tasks  = taskMap[key] || [];
    const shown  = tasks.slice(0, 3);
    const extra  = tasks.length - 3;

    html += `<div class="taskcal-cell${isToday ? ' tc-today' : ''}">
      <div class="tc-day-num${isToday ? ' tc-today-num' : ''}">${d}</div>
      ${shown.map(t => `
        <div class="tc-chip prio-${t.priority || 'medium'}${t.completed ? ' done' : ''}"
             onclick="openTodoModal('${t.id}')"
             title="${t.text}">${t.text}</div>`).join('')}
      ${extra > 0 ? `<div class="tc-more">+${extra} more</div>` : ''}
    </div>`;
  }

  html += `</div></div>`;
  document.getElementById('taskcal-content').innerHTML = html;
}

/* ════════════════════════════════
   KANBAN BOARD
════════════════════════════════ */
function todoStatus(t) {
  if (t.status) return t.status;
  return t.completed ? 'done' : 'todo';
}

async function moveCard(id, newStatus) {
  const t = todos.find(t => t.id === id);
  if (!t) return;
  const prevStatus    = t.status || todoStatus(t);
  const prevCompleted = t.completed;
  t.status    = newStatus;
  t.completed = newStatus === 'done';
  saveTodosToLS();
  renderKanban();
  if (document.getElementById('page-todo').classList.contains('active')) renderTodo();

  const { error } = await sb.from('todos')
    .update({ status: newStatus, completed: t.completed })
    .eq('id', id).eq('user_id', USER_ID);

  if (error) {
    t.status    = prevStatus;
    t.completed = prevCompleted;
    saveTodosToLS();
    renderKanban();
    toast('Sync error — try again');
  }
}

/* ── Kanban drag & drop ── */
function kbDragStart(e, id) {
  kbDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => {
    const el = document.getElementById('kb-' + id);
    if (el) el.classList.add('kb-dragging');
  }, 0);
}
function kbDragOver(e, status) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('kb-col-over'));
  const col = document.getElementById('kb-col-' + status);
  if (col) col.classList.add('kb-col-over');
}
function kbDragLeave(e) {
  /* Only clear if leaving the board entirely */
  if (!e.currentTarget.contains(e.relatedTarget)) {
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('kb-col-over'));
  }
}
function kbDragEnd() {
  document.querySelectorAll('.kb-card').forEach(c => c.classList.remove('kb-dragging'));
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('kb-col-over'));
  kbDragId = null;
}
function kbDrop(e, status) {
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('kb-col-over'));
  if (!kbDragId) return;
  const t = todos.find(t => t.id === kbDragId);
  if (!t || todoStatus(t) === status) return;
  moveCard(kbDragId, status);
}

/* ── Kanban render ── */
function renderKanban() {
  if (!document.getElementById('kb-cards-todo')) return;
  const today = todayKey();

  const cols = { todo: [], in_progress: [], done: [] };
  todos.forEach(t => {
    const s = todoStatus(t);
    if (cols[s]) cols[s].push(t);
  });

  const colMeta = {
    todo:        { prev: null,          next: 'in_progress' },
    in_progress: { prev: 'todo',        next: 'done'        },
    done:        { prev: 'in_progress', next: null          }
  };
  const colLabel = { todo: 'To Do', in_progress: 'In Prog', done: 'Done' };

  Object.entries(cols).forEach(([status, items]) => {
    document.getElementById(`kb-count-${status}`).textContent = items.length;
    const { prev, next } = colMeta[status];

    document.getElementById(`kb-cards-${status}`).innerHTML = items.length
      ? items.map(t => {
          const prioKey = t.priority || 'medium';
          const isOverdue  = !t.completed && t.due_date && t.due_date < today;
          const isDueToday = !t.completed && t.due_date === today;

          let dueBadge = '';
          if (t.due_date) {
            if (isOverdue)   dueBadge = `<span class="todo-due-badge overdue">⚠ ${fmtDate(t.due_date)}</span>`;
            else if (isDueToday) dueBadge = `<span class="todo-due-badge due-today">Today</span>`;
            else             dueBadge = `<span class="todo-due-badge">${fmtDate(t.due_date)}</span>`;
          }
          const tagChips = (t.tags || []).map(tag => `<span class="todo-tag">${tag}</span>`).join('');

          return `
          <div class="kb-card prio-${prioKey}" id="kb-${t.id}"
               draggable="true"
               ondragstart="kbDragStart(event,'${t.id}')"
               ondragend="kbDragEnd()">
            <div class="kb-card-text"
                 ondblclick="startEditTodo('${t.id}',this)"
                 title="Double-click to edit">${t.text}</div>
            <div class="kb-card-meta">
              <span class="todo-prio-badge prio-${prioKey}">${prioKey}</span>
              ${tagChips}${dueBadge}
            </div>
            <div class="kb-card-actions">
              ${prev ? `<button class="kb-move-btn" onclick="moveCard('${t.id}','${prev}')" title="Move to ${colLabel[prev]}">← ${colLabel[prev]}</button>` : ''}
              ${next ? `<button class="kb-move-btn fwd" onclick="moveCard('${t.id}','${next}')" title="Move to ${colLabel[next]}">${colLabel[next]} →</button>` : ''}
              <button class="kb-icon-btn" onclick="openTodoModal('${t.id}')" title="Edit">✎</button>
              <button class="kb-icon-btn del" onclick="deleteTodo('${t.id}')" title="Delete">×</button>
            </div>
          </div>`;
        }).join('')
      : `<div class="kb-empty-col">Drop tasks here</div>`;
  });
}

/* ════════════════════════════════
   DAILY PAGE
════════════════════════════════ */
function setDailyPrio(p, btn) {
  dailyPriority = p;
  document.querySelectorAll('.daily-prio-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  /* Refresh stats card colour */
  renderDaily();
}

async function addDailyTodo() {
  const inp  = document.getElementById('daily-input');
  const text = inp.value.trim();
  if (!text) { toast('Enter a task'); return; }

  const t = {
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    user_id:     USER_ID,
    text,
    completed:   false,
    priority:    dailyPriority,
    tags:        ['daily'],
    due_date:    todayKey(),
    order_index: todos.length,
    created_at:  new Date().toISOString().slice(0,10)
  };

  inp.value = '';
  todos.push(t);
  saveTodosToLS();
  renderDaily();

  const { error } = await sb.from('todos').insert(t);
  if (error) {
    todos = todos.filter(t2 => t2.id !== t.id);
    saveTodosToLS();
    renderDaily();
    toast('Error adding task');
    console.error(error);
  }
}

async function completeDailyTodo(id) {
  /* Animate out, then delete */
  const card = document.getElementById('daily-card-' + id);
  if (card) {
    card.classList.add('completing');
    await new Promise(r => setTimeout(r, 240));
  }

  const prev = [...todos];
  todos = todos.filter(t => t.id !== id);
  openPanels.delete(id);
  saveTodosToLS();
  renderDaily();
  if (document.getElementById('page-todo').classList.contains('active')) renderTodo();

  const { error } = await sb.from('todos').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) {
    todos = prev;
    saveTodosToLS();
    renderDaily();
    toast('Sync error — try again');
  }
}

function renderDaily() {
  if (!document.getElementById('daily-list')) return;

  /* Date chip */
  const now = new Date();
  const chip = document.getElementById('daily-date-chip');
  if (chip) chip.textContent =
    now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const today      = todayKey();
  const dailyTodos = todos.filter(t => (t.tags || []).includes('daily'));
  const overdue    = dailyTodos.filter(t => t.due_date && t.due_date < today).length;

  const prioMeta = { high: { color: '#ef4444', label: 'High' }, medium: { color: '#eab308', label: 'Medium' }, low: { color: '#10b981', label: 'Low' } };
  const pm = prioMeta[dailyPriority] || prioMeta.high;
  document.getElementById('daily-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Remaining</div>
      <div class="stat-value purple">${dailyTodos.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Overdue</div>
      <div class="stat-value pink">${overdue}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">New task priority</div>
      <div class="stat-value" style="color:${pm.color};font-size:18px;padding-top:6px">${pm.label}</div>
    </div>`;

  if (!dailyTodos.length) {
    document.getElementById('daily-empty').style.display = 'block';
    document.getElementById('daily-list').style.display  = 'none';
    return;
  }
  document.getElementById('daily-empty').style.display = 'none';
  document.getElementById('daily-list').style.display  = 'block';

  document.getElementById('daily-list').innerHTML = dailyTodos.map(t => {
    const isOverdue = t.due_date && t.due_date < today;
    return `
    <div class="daily-card prio-${t.priority || 'high'}${isOverdue ? ' overdue' : ''}" id="daily-card-${t.id}">
      <button class="todo-check" onclick="completeDailyTodo('${t.id}')" title="Done — removes task"></button>
      <span class="daily-text">${t.text}</span>
      ${isOverdue ? `<span class="todo-due-badge overdue">⚠ ${fmtDate(t.due_date)}</span>` : ''}
      <button class="todo-action-btn del" onclick="completeDailyTodo('${t.id}')" title="Remove">×</button>
    </div>`;
  }).join('');
}

/* ════════════════════════════════
   TOAST
════════════════════════════════ */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ════════════════════════════════
   BOOT
════════════════════════════════ */
loadData();
