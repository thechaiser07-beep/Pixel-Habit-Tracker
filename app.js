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

let habits      = [];
let completions = {}; // { habit_id: Set<date_string> }
let categories  = [];
let selColor    = PALETTE[0];
let selCatColor = PALETTE[0];
let viewMonth   = new Date(); viewMonth.setDate(1);
let chart       = null;
let chartRange  = 7;
let busy        = false;

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
async function loadData() {
  showLoading(true);
  try {
    const [
      { data: hData,   error: hErr   },
      { data: cData,   error: cErr   },
      { data: catData, error: catErr }
    ] = await Promise.all([
      sb.from('habits').select('*').eq('user_id', USER_ID).order('created_at'),
      sb.from('completions').select('habit_id, date').eq('user_id', USER_ID),
      sb.from('categories').select('*').eq('user_id', USER_ID).order('name')
    ]);

    if (hErr)   throw hErr;
    if (cErr)   throw cErr;
    if (catErr) throw catErr;

    habits = hData || [];
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
  const idx = ['pixel','categories','graph'].indexOf(id);
  document.querySelectorAll('.nav-item')[idx].classList.add('active');
  if (id === 'pixel')      renderPixel();
  if (id === 'categories') renderCategories();
  if (id === 'graph')      renderGraph();
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
  if (e.key === 'Escape') { closeModal(); closeCatModal(); }
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
  if (habits.find(h => h.category === cat.name)) {
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
