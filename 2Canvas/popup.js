const $ = id => document.getElementById(id);

const COLORS = ['#e8ff47','#47c8ff','#ff7de8','#47ffb8','#ffac47','#c47dff','#ff6b6b'];
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function colorFor(i) { return COLORS[i % COLORS.length]; }
function formatTime(d) { return new Date(d).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
function isPast(d) { return new Date(d) < new Date(); }
function todayLabel() { return new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'}); }

function formatCacheAge(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

// ── Storage helpers ────────────────────────────────────────────────────────────
async function getAccounts() {
  return new Promise(r => chrome.storage.local.get(['canvasAccounts'], res => r(res.canvasAccounts || [])));
}
async function saveAccounts(a) {
  return new Promise(r => chrome.storage.local.set({ canvasAccounts: a }, r));
}
async function getCache() {
  return new Promise(r => chrome.storage.local.get(['assignmentCache'], res => r(res.assignmentCache || null)));
}
async function setCache(results) {
  const entry = { ts: Date.now(), results };
  return new Promise(r => chrome.storage.local.set({ assignmentCache: entry }, r));
}
async function clearCache() {
  return new Promise(r => chrome.storage.local.remove('assignmentCache', r));
}

async function saveDraft() {
  chrome.storage.local.set({ formDraft: {
    name:  $('input-name').value,
    url:   $('input-url').value,
    token: $('input-token').value,
  }});
}
async function restoreDraft() {
  return new Promise(r => chrome.storage.local.get(['formDraft'], res => {
    const d = res.formDraft || {};
    if (d.name)  $('input-name').value  = d.name;
    if (d.url)   $('input-url').value   = d.url;
    if (d.token) $('input-token').value = d.token;
    r();
  }));
}
function clearDraft() {
  chrome.storage.local.remove('formDraft');
  $('input-name').value = $('input-url').value = $('input-token').value = '';
}

function normalizeCanvasUrl(raw) {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).origin; } catch { return null; }
}

// ── Canvas API ─────────────────────────────────────────────────────────────────
async function fetchAllPages(url, headers) {
  let results = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) results = results.concat(data);
    const link = res.headers.get('Link') || '';
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    next = match ? match[1] : null;
  }
  return results;
}

async function fetchDueToday(account) {
  const base = account.url.replace(/\/+$/, '');
  const headers = { 'Authorization': `Bearer ${account.token}` };

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startISO = startOfDay.toISOString();
  const endISO   = endOfDay.toISOString();

  const due = new Map();

  try {
    const events = await fetchAllPages(
      `${base}/api/v1/calendar_events?type=assignment&start_date=${encodeURIComponent(startISO)}&end_date=${encodeURIComponent(endISO)}&per_page=50&undated=false&all_events=false`,
      headers
    );
    for (const ev of events) {
      const dueAt = ev.assignment?.due_at || ev.end_at;
      if (!dueAt) continue;
      const t = new Date(dueAt);
      if (t < startOfDay || t >= endOfDay) continue;
      const id = ev.assignment?.id || ev.id;
      due.set(String(id), {
        id, dueAt, htmlUrl: ev.html_url || ev.assignment?.html_url,
        title:      ev.title || ev.assignment?.name || '(Untitled)',
        courseName: ev.context_name || ev.course_name || 'Unknown Course',
      });
    }
  } catch(e) { console.warn('Calendar API error:', e.message); }

  try {
    const courses = await fetchAllPages(
      `${base}/api/v1/courses?enrollment_state=active&per_page=50`, headers
    );
    const courseNames = {};
    for (const c of courses) courseNames[c.id] = c.name;

    await Promise.all(courses.map(async c => {
      try {
        const assignments = await fetchAllPages(
          `${base}/api/v1/courses/${c.id}/assignments?order_by=due_at&per_page=50`, headers
        );
        for (const a of assignments) {
          if (!a.due_at) continue;
          const t = new Date(a.due_at);
          if (t < startOfDay || t >= endOfDay) continue;
          if (due.has(String(a.id))) continue;
          due.set(String(a.id), {
            id: a.id, title: a.name, dueAt: a.due_at, htmlUrl: a.html_url,
            courseName: courseNames[c.id] || c.name,
          });
        }
      } catch(_) {}
    }));
  } catch(e) {
    if (due.size === 0) return { account, error: e.message, assignments: [] };
  }

  return {
    account,
    error: null,
    assignments: [...due.values()].sort((a,b) => new Date(a.dueAt) - new Date(b.dueAt))
  };
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderAssignments(results) {
  const list = $('assignments-list');
  list.innerHTML = '';
  results.forEach((result, i) => {
    const color = colorFor(i);
    const group = document.createElement('div');

    const label = document.createElement('div');
    label.className = 'college-label';
    const dot = document.createElement('span');
    dot.className = 'college-dot';
    dot.style.background = color;
    label.appendChild(dot);
    label.appendChild(document.createTextNode(result.account.name));
    group.appendChild(label);

    if (result.error) {
      const e = document.createElement('div');
      e.className = 'error-card';
      e.textContent = `⚠ ${result.error}`;
      group.appendChild(e);
    } else if (!result.assignments.length) {
      const e = document.createElement('div');
      e.className = 'error-card';
      e.style.cssText = 'color:var(--muted);background:transparent;border-color:var(--border);border-left-color:var(--border)';
      e.textContent = 'No assignments due today.';
      group.appendChild(e);
    } else {
      result.assignments.forEach(a => {
        const card = document.createElement('div');
        card.className = 'assignment-card';
        card.style.borderLeftColor = color;
        if (a.htmlUrl) { card.style.cursor = 'pointer'; card.onclick = () => chrome.tabs.create({ url: a.htmlUrl }); }

        const title = document.createElement('div');
        title.className = 'assignment-title';
        title.textContent = a.title;

        const meta = document.createElement('div');
        meta.className = 'assignment-meta';
        const chip = document.createElement('span');
        chip.className = 'course-chip';
        chip.textContent = a.courseName;
        const time = document.createElement('span');
        time.className = 'due-time' + (isPast(a.dueAt) ? ' overdue' : '');
        time.textContent = formatTime(a.dueAt) + (isPast(a.dueAt) ? ' ✗' : '');
        meta.appendChild(chip);
        meta.appendChild(time);
        card.appendChild(title);
        card.appendChild(meta);
        group.appendChild(card);
      });
    }
    list.appendChild(group);
  });

  const allEmpty = results.every(r => !r.assignments.length && !r.error);
  $('empty-state').classList.toggle('hidden', !allEmpty);
}

function setCacheLabel(ts) {
  $('cache-label').textContent = `Updated ${formatCacheAge(ts)}`;
  $('cache-label').classList.remove('hidden');
}

// ── Load — uses cache if fresh, otherwise fetches ─────────────────────────────
async function loadAssignments(forceRefresh = false) {
  const accounts = await getAccounts();
  $('no-accounts').classList.toggle('hidden', accounts.length > 0);
  $('assignments-list').classList.toggle('hidden', accounts.length === 0);
  $('refresh-btn').classList.toggle('hidden', accounts.length === 0);
  $('cache-label').classList.add('hidden');
  $('empty-state').classList.add('hidden');
  if (!accounts.length) return;

  // Check cache validity
  if (!forceRefresh) {
    const cache = await getCache();
    if (cache && (Date.now() - cache.ts) < CACHE_TTL_MS) {
      // Also make sure cache isn't from a previous day
      const cacheDate = new Date(cache.ts).toDateString();
      const today = new Date().toDateString();
      if (cacheDate === today) {
        renderAssignments(cache.results);
        setCacheLabel(cache.ts);
        return;
      }
    }
  }

  $('status-bar').textContent = `Fetching from ${accounts.length} college${accounts.length > 1 ? 's' : ''}…`;
  $('status-bar').classList.remove('hidden');
  $('assignments-list').innerHTML = '';
  $('cache-label').classList.add('hidden');

  const results = await Promise.all(accounts.map(fetchDueToday));
  await setCache(results);

  $('status-bar').classList.add('hidden');
  renderAssignments(results);
  setCacheLabel(Date.now());
}

// ── Settings ───────────────────────────────────────────────────────────────────
async function renderAccountsList() {
  const accounts = await getAccounts();
  const list = $('accounts-list');
  list.innerHTML = '';
  if (!accounts.length) {
    const msg = document.createElement('div');
    msg.className = 'no-accounts-msg';
    msg.textContent = 'No colleges saved yet.';
    list.appendChild(msg);
    return;
  }
  accounts.forEach((acc, i) => {
    const row = document.createElement('div');
    row.className = 'account-row';
    const info = document.createElement('div');
    info.className = 'account-info';
    const name = document.createElement('div');
    name.className = 'account-name';
    name.textContent = acc.name;
    const url = document.createElement('div');
    url.className = 'account-url';
    url.textContent = acc.url;
    info.appendChild(name);
    info.appendChild(url);
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = 'Remove';
    del.onclick = async () => {
      const all = await getAccounts();
      all.splice(i, 1);
      await saveAccounts(all);
      await clearCache();
      renderAccountsList();
    };
    row.appendChild(info);
    row.appendChild(del);
    list.appendChild(row);
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  $('date-label').textContent = todayLabel();
  await loadAssignments();

  $('settings-btn').onclick = async () => {
    $('main-view').classList.add('hidden');
    $('settings-view').classList.remove('hidden');
    await renderAccountsList();
    await restoreDraft();
  };
  $('back-btn').onclick = async () => {
    $('settings-view').classList.add('hidden');
    $('main-view').classList.remove('hidden');
    await loadAssignments();
  };

  // Force refresh on manual button — bypasses cache
  $('refresh-btn').onclick = () => loadAssignments(true);

  ['input-name', 'input-url', 'input-token'].forEach(id => {
    $(id).addEventListener('input', saveDraft);
  });

  $('add-btn').onclick = async () => {
    const errEl = $('form-error');
    errEl.classList.add('hidden');
    const name   = $('input-name').value.trim();
    const rawUrl = $('input-url').value.trim();
    const token  = $('input-token').value.trim();

    if (!name)   { errEl.textContent = 'College name is required.'; return errEl.classList.remove('hidden'); }
    if (!rawUrl) { errEl.textContent = 'Canvas URL is required.'; return errEl.classList.remove('hidden'); }
    if (!token)  { errEl.textContent = 'Access token is required.'; return errEl.classList.remove('hidden'); }

    const cleanUrl = normalizeCanvasUrl(rawUrl);
    if (!cleanUrl) { errEl.textContent = 'Could not parse that URL.'; return errEl.classList.remove('hidden'); }

    const accounts = await getAccounts();
    if (accounts.find(a => a.url === cleanUrl)) { errEl.textContent = 'URL already saved.'; return errEl.classList.remove('hidden'); }

    accounts.push({ name, url: cleanUrl, token });
    await saveAccounts(accounts);
    await clearCache(); // force fresh fetch with new account
    clearDraft();
    await renderAccountsList();
  };
});