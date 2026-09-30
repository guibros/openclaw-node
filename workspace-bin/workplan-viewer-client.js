import { createViewerClient } from '/viewer-session.mjs';
const viewerClient = createViewerClient({ onUnauthorized: () => location.reload() });

const $ = (id) => document.getElementById(id);

const state = {
  planId: null,
  tab: 'plan',
  gtab: 'glive',         // dock sub-tab: 'glive' | 'gprogress'
  glivePin: null,        // { planId, log } when viewing a pinned historical tick log
  evtSource: null,
  progressSource: null,
  userPaused: false,
  selectedStep: null,
  selectedDoc: null,
};

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(ESC + '\\[([0-9;]*)m', 'g');
const ANSI_CLASS = {
  '0': null, '1': 'a-bold', '2': 'a-dim',
  '31': 'a-red', '32': 'a-green', '33': 'a-yellow', '34': 'a-blue',
  '35': 'a-magenta', '36': 'a-cyan',
};

function esc(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function ansiToHtml(text) {
  const escaped = esc(text);
  let out = '';
  let last = 0;
  let depth = 0;
  let m;
  ANSI_RE.lastIndex = 0;
  while ((m = ANSI_RE.exec(escaped)) !== null) {
    out += escaped.slice(last, m.index);
    const codes = m[1].split(';').filter(Boolean);
    if (!codes.length || codes.includes('0')) {
      while (depth > 0) { out += '</span>'; depth--; }
    } else {
      for (const c of codes) {
        const cls = ANSI_CLASS[c];
        if (cls) { out += '<span class="' + cls + '">'; depth++; }
      }
    }
    last = m.index + m[0].length;
  }
  out += escaped.slice(last);
  while (depth > 0) { out += '</span>'; depth--; }
  return out;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
async function refreshPlans() {
  const r = await viewerClient.request('/api/plans');
  const data = await r.json();
  const list = $('plan-list');
  list.innerHTML = '';
  for (const p of data.plans) {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    if (p.id === state.planId) li.classList.add('active');
    // Dot priority: blocked > scheduler-auto-running > manual-tick-running > idle.
    let dotClass, pillClass, pillLabel;
    if (p.blocked) {
      dotClass = 'blocked'; pillClass = 'blocked'; pillLabel = 'BLOCKED';
    } else if (p.scheduler_loaded) {
      dotClass = 'active';  pillClass = 'auto'; pillLabel = p.locked ? 'auto · ticking' : 'auto';
    } else if (p.locked) {
      dotClass = 'running'; pillClass = 'run';  pillLabel = 'manual tick';
    } else {
      dotClass = 'idle';    pillClass = 'idle'; pillLabel = 'idle';
    }
    li.innerHTML = '<div class="name">' +
        '<span class="status-dot ' + dotClass + '" title="' + pillLabel + '"></span>' +
        esc(p.id) + '</div>' +
      '<div class="meta">' +
        '<span class="pill ' + pillClass + '">' + pillLabel + '</span>' +
        '<span>' + p.closed_steps + '/' + p.total_steps + '</span>' +
        '<span>' + esc(p.version) + '</span>' +
      '</div>';
    li.addEventListener('click', () => selectPlan(p.id));
    list.appendChild(li);
  }
  $('discovery-info').textContent =
    data.plans.length + ' plan(s) · roots: ' + data.roots.map(r => r.split('/').pop()).join(', ');
  if (!state.planId && data.plans.length) {
    // Default to the plan that actually needs eyes — not the alphabetically-first
    // (which is the completed legacy plan). A ?plan= deep link (notification
    // click-through) beats the operator's last choice, then a blocked plan, then
    // the first incomplete (active) plan, then anything.
    let pick = null;
    const urlPlan = new URLSearchParams(location.search).get('plan');
    if (urlPlan && data.plans.some(p => p.id === urlPlan)) pick = urlPlan;
    if (!pick) try {
      const saved = localStorage.getItem('workplan.planId');
      if (saved && data.plans.some(p => p.id === saved)) pick = saved;
    } catch { /* no localStorage */ }
    if (!pick) {
      const active = data.plans.find(p => p.blocked)
        || data.plans.find(p => p.closed_steps < p.total_steps)
        || data.plans[0];
      pick = active.id;
    }
    selectPlan(pick);
  }
}

async function selectPlan(id) {
  state.planId = id;
  try { localStorage.setItem('workplan.planId', id); } catch { /* no localStorage */ }
  state.selectedStep = null;
  state.selectedDoc = null;
  state.lastDocsMtime = undefined; // re-baseline the content signal for the new plan
  document.querySelectorAll('aside .plan-list li').forEach(li =>
    li.classList.toggle('active', li.dataset.id === id));
  await refreshState();
  renderPlanTab();
}

// Render whichever per-plan tab is currently selected.
function renderPlanTab() {
  if (state.tab === 'plan') renderPlan();
  else if (state.tab === 'steps') renderSteps();
  else if (state.tab === 'docs') renderDocList();
  else if (state.tab === 'history') renderHistory();
  else if (state.tab === 'block') renderBlock();
  else if (state.tab === 'auto') renderAutomation();
}

// ── Activity dock (always-on bottom panel; independent of plan selection) ───────
function showDock() {
  document.querySelectorAll('.dock-pane').forEach(p =>
    p.classList.toggle('active', p.id === (state.gtab === 'gprogress' ? 'pane-progress' : 'pane-live')));
  $('live-controls').style.display = state.gtab === 'glive' ? '' : 'none';
  if (state.gtab === 'glive') connectActivityLive();
  else connectActivityProgress();
}

// ── Master Plan tab ─────────────────────────────────────────────────────────────
async function renderPlan() {
  if (!state.planId) return;
  const view = $('plan-view');
  const base = '/api/plans/' + state.planId;
  const safe = (p) => viewerClient.request(base + p).then(r => r.json()).catch(() => ({ present: false }));
  const [registry, decisions] = await Promise.all([safe('/registry'), safe('/decisions')]);
  let html = '';

  if (registry.present && registry.families) {
    html += '<section class="plan-card"><h2>Component Registry</h2>';
    for (const fam of registry.families) {
      html += '<div class="reg-family">' + esc(fam.family) + '</div>';
      for (const c of fam.components) {
        const s = (c.status || '').toUpperCase();
        let cls = 'idle';
        if (s.includes('ABSENT') || s.includes('INERT')) cls = 'bad';
        else if (s.includes('STALE') || s.includes('DEGRADED')) cls = 'warn';
        else if (s.includes('LIVE')) cls = 'ok';
        html += '<div class="reg-row"><span class="reg-name">' + esc(c.title) + '</span>' +
          '<span class="badge ' + cls + '">' + esc(c.status || '?') + '</span></div>';
      }
    }
    html += '</section>';
  }

  if (decisions.present && decisions.entries && decisions.entries.length) {
    html += '<section class="plan-card"><h2>Decisions (' + decisions.entries.length + ')</h2>';
    for (const d of decisions.entries) {
      html += '<details class="dec"><summary>' + esc(d.title) + '</summary><pre class="dec-body">' + esc(d.body) + '</pre></details>';
    }
    html += '</section>';
  }

  view.innerHTML = html || '<div class="empty">no master-plan docs found</div>';
}

// ── Header ────────────────────────────────────────────────────────────────────
async function refreshState() {
  if (!state.planId) return;
  const r = await viewerClient.request('/api/plans/' + state.planId + '/state');
  if (!r.ok) return;
  const s = await r.json();
  $('h-title').textContent = s.id;
  $('h-version').textContent = s.version;
  $('h-progress').textContent = s.closed_steps + '/' + s.total_steps;
  $('h-lock').textContent = s.locked ? 'held' : 'free';
  $('h-lock-wrap').className = 'badge ' + (s.locked ? 'warn' : 'ok');
  $('h-block').textContent = s.external_action ? '🙋 needs you' : (s.blocked ? 'BLOCKED' : 'clear');
  $('h-block-wrap').className = 'badge ' + ((s.blocked || s.external_action) ? 'bad' : 'ok');
  $('h-block-wrap').title = s.external_action || (s.blocked ? 'plan blocked — see BLOCKED.md' : 'no block');
  $('h-tree').textContent = s.tree_dirty ? 'dirty' : 'clean';
  $('h-tree-wrap').className = 'badge ' + (s.tree_dirty ? 'warn' : 'ok');
  $('h-step').textContent = s.current_step
    ? (s.current_step.step + '  ' + s.current_step.version + '  ' + s.current_step.desc).slice(0, 90)
    : '';
  // Header pause/resume button mirrors the block state.
  const btn = $('header-pause-btn');
  btn.classList.toggle('paused', !!s.blocked);
  btn.textContent = s.blocked ? '▶ Resume' : '⏸ Pause';
  btn.title = s.blocked
    ? 'Plan is paused — click to delete BLOCKED.md and resume'
    : 'Pause future ticks by writing BLOCKED.md';
  state.lastBlocked = s.blocked;
  state.lastLocked = s.locked;
  // Block/auto reflect tick-lock state (not *.md files) — refresh every poll.
  // Plan/steps/docs/history reflect *.md content — re-render only when a plan
  // file actually changed, so the panel live-updates without 10s flicker and
  // keeps scroll/selection (renderSteps/renderDocList re-apply the selection).
  const prevDocsMtime = state.lastDocsMtime;
  state.lastDocsMtime = s.docs_mtime;
  if (state.tab === 'block') renderBlock();
  else if (state.tab === 'auto') renderAutomation();
  else if (prevDocsMtime !== undefined && s.docs_mtime !== prevDocsMtime) renderPlanTab();
}
setInterval(refreshState, 10000);

// Header pause/resume button.
$('header-pause-btn').addEventListener('click', async () => {
  if (state.lastBlocked) {
    if (!confirm('Resume the plan?\\n\\nDeletes BLOCKED.md so the next tick runs.')) return;
    await doUnblock();
  } else {
    // Quick pause: prompt for trigger, use simple defaults.
    const trigger = prompt('Pause future ticks. Brief reason (one line):', 'operator-requested pause');
    if (trigger == null) return;
    await doBlock({ trigger, detail: '' });
  }
});

// ── Notification toggle ─────────────────────────────────────────────────────
async function refreshNotifyToggle() {
  try {
    const r = await viewerClient.request('/api/notify-config');
    const d = await r.json();
    applyNotifyToggle(d.enabled);
  } catch { /* ignore */ }
}
function applyNotifyToggle(enabled) {
  const btn = $('notify-toggle');
  if (!btn) return;
  btn.textContent = enabled ? '🔔 Notify' : '🔕 Muted';
  btn.classList.toggle('paused', !enabled);
  btn.title = enabled
    ? 'Notifications ON (step=Glass, block=Sosumi). Click to mute.'
    : 'Notifications MUTED. Click to enable.';
  btn.dataset.enabled = enabled ? '1' : '0';
}
$('notify-toggle').addEventListener('click', async () => {
  const cur = $('notify-toggle').dataset.enabled === '1';
  try {
    const r = await viewerClient.request('/api/notify-config?enabled=' + (cur ? '0' : '1'), { method: 'POST' });
    const d = await r.json();
    applyNotifyToggle(d.enabled);
  } catch { /* ignore */ }
});

async function doBlock({ trigger, detail }) {
  if (!state.planId) return;
  const r = await viewerClient.request('/api/plans/' + state.planId + '/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: trigger || 'operator pause', detail: detail || '' }),
  });
  const data = await r.json();
  await refreshState();
  await refreshPlans();
  if (state.tab === 'block') renderBlock();
  return data;
}

async function doUnblock() {
  if (!state.planId) return;
  const r = await viewerClient.request('/api/plans/' + state.planId + '/unblock', { method: 'POST' });
  const data = await r.json();
  await refreshState();
  await refreshPlans();
  if (state.tab === 'block') renderBlock();
  return data;
}

// ── Per-plan tabs ───────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('main .pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + state.tab));
    renderPlanTab();
  });
});

// ── Activity dock sub-tabs (Live | Progress) ────────────────────────────────────
document.querySelectorAll('.gtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.gtab = btn.dataset.gtab;
    document.querySelectorAll('.gtab-btn').forEach(b => b.classList.toggle('active', b === btn));
    showDock();
  });
});

$('unpin-log').addEventListener('click', () => {
  state.glivePin = null;
  $('unpin-log').style.display = 'none';
  $('follow-new').checked = true;
  connectActivityLive();
});

// Global Live: per-plan pinned historical log when state.glivePin is set,
// otherwise the live cross-plan source (/api/global/stream).
function connectActivityLive() {
  if (state.evtSource) { state.evtSource.close(); state.evtSource = null; }
  logEl.innerHTML = '<div class="empty">connecting…</div>';
  $('unpin-log').style.display = state.glivePin ? '' : 'none';
  const url = state.glivePin
    ? '/api/plans/' + state.glivePin.planId + '/stream?log=' + encodeURIComponent(state.glivePin.log)
    : '/api/global/stream';
  const es = viewerClient.stream(url);
  state.evtSource = es;
  es.addEventListener('append', (e) => { try { appendText(JSON.parse(e.data)); } catch {} });
  es.addEventListener('switch', () => {
    if (!state.glivePin && $('follow-new').checked) logEl.innerHTML = '';
  });
}

function connectActivityProgress() {
  if (state.progressSource) { state.progressSource.close(); state.progressSource = null; }
  progressEl.innerHTML = '<div class="empty" style="padding:20px;color:var(--dim);">connecting…</div>';
  state.progressSource = openProgressStream('/api/global/activity-stream');
}

// ── Live transcript ───────────────────────────────────────────────────────────
const logEl = $('log');

function appendText(text) {
  if (!text) return;
  if (logEl.firstElementChild && logEl.firstElementChild.classList.contains('empty')) {
    logEl.innerHTML = '';
  }
  const html = ansiToHtml(text);
  const tmp = document.createElement('span');
  tmp.innerHTML = html;
  while (tmp.firstChild) logEl.appendChild(tmp.firstChild);
  if ($('autoscroll').checked && !state.userPaused) {
    logEl.scrollTop = logEl.scrollHeight;
  }
}

logEl.addEventListener('scroll', () => {
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 20;
  if (!atBottom && $('autoscroll').checked) {
    state.userPaused = true;
    $('pause-banner').classList.add('visible');
  } else if (atBottom) {
    state.userPaused = false;
    $('pause-banner').classList.remove('visible');
  }
});
$('pause-banner').addEventListener('click', () => {
  state.userPaused = false;
  $('pause-banner').classList.remove('visible');
  logEl.scrollTop = logEl.scrollHeight;
});

// ── Progress stream (brief activity lines) ────────────────────────────────────
const progressEl = $('progress-list');

// Sticky autoscroll: pinned to the bottom until the user scrolls up, then it
// re-pins once they scroll back down. (A plain "are we at bottom?" check fails on
// the initial burst — once content overflows while scrollTop is still 0 it reads
// "not at bottom" and never scrolls again.)
let progressPinned = true;
progressEl.addEventListener('scroll', () => {
  progressPinned = progressEl.scrollHeight - progressEl.scrollTop - progressEl.clientHeight < 40;
});

function appendProgress(act) {
  if (progressEl.firstElementChild && progressEl.firstElementChild.classList.contains('empty')) {
    progressEl.innerHTML = '';
  }
  const row = document.createElement('div');
  // Global feed: every plan shown at full strength; the last-opened plan's lines
  // get an accent chip so they're easy to pick out of the cross-plan stream.
  const planCls = act.plan && act.plan === state.planId ? ' me' : '';
  row.className = 'pl-row r-' + (act.kind || 'info') + planCls;
  const planChip = act.plan ? '<span class="pl-plan">' + esc(act.plan) + '</span>' : '';
  row.innerHTML =
    '<span class="pl-time">' + esc(act.time || '') + '</span>' +
    '<span class="pl-icon">' + (act.icon || '·') + '</span>' +
    planChip +
    '<span class="pl-body">' +
      (act.verb ? '<span class="pl-verb">' + esc(act.verb) + '</span>' : '') +
      '<span class="pl-obj">' + esc(act.body || '') + '</span>' +
    '</span>';
  progressEl.appendChild(row);
  if (progressPinned) progressEl.scrollTop = progressEl.scrollHeight;
}

function openProgressStream(url) {
  const es = viewerClient.stream(url);
  es.addEventListener('reset', (e) => {
    progressEl.innerHTML = '';
    progressPinned = true;
    try {
      const d = JSON.parse(e.data);
      const note = document.createElement('div');
      note.className = 'pl-source ' + (d.kind || '');
      note.textContent = d.kind === 'session'
        ? '▶ interactive session · ' + (d.source || '') + ' — no autonomous tick has run; each line is tagged with the plan it touches'
        : d.kind === 'tick'
          ? '▶ autonomous tick · ' + (d.source || '')
          : (d.source || '');
      progressEl.appendChild(note);
    } catch {}
  });
  es.addEventListener('activity', (e) => {
    try { appendProgress(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('info', (e) => {
    try {
      const d = JSON.parse(e.data);
      progressEl.innerHTML = '<div class="empty" style="padding:20px;color:var(--dim);">' + esc(d.msg || '') + '</div>';
    } catch {}
  });
  return es;
}

// ── Steps ─────────────────────────────────────────────────────────────────────
async function renderSteps() {
  if (!state.planId) return;
  const r = await viewerClient.request('/api/plans/' + state.planId + '/inventory');
  if (!r.ok) return;
  const rows = await r.json();
  const list = $('step-list');
  list.innerHTML = '';
  let lastBlock = null;
  rows.forEach((row, idx) => {
    if (row.block !== lastBlock) {
      const hdr = document.createElement('div');
      hdr.className = 'block-hdr';
      hdr.textContent = 'Phase ' + row.block;
      list.appendChild(hdr);
      lastBlock = row.block;
    }
    const div = document.createElement('div');
    div.className = 'step' + (state.selectedStep === idx ? ' active' : '');
    const mClass = row.state === 'x' ? 'x' : row.state === 'A' ? 'A' : 'empty';
    const mText  = row.state === 'x' ? '✓' : row.state === 'A' ? '●' : row.state === 'D' ? '◇' : '○';
    div.innerHTML =
      '<div class="marker ' + mClass + '">' + mText + '</div>' +
      '<div class="info">' +
        '<div class="id-row"><span class="id">' + row.step + '</span><span class="ver">' + row.version + '</span></div>' +
        '<div class="desc">' + esc(row.desc) + '</div>' +
      '</div>';
    div.addEventListener('click', () => { state.selectedStep = idx; renderStepDetail(idx); document.querySelectorAll('.step-list .step').forEach((el, i) => el.classList.toggle('active', i === idx)); });
    list.appendChild(div);
  });
  if (state.selectedStep != null) renderStepDetail(state.selectedStep);
}

async function renderStepDetail(idx) {
  const detail = $('step-detail');
  detail.innerHTML = '<div class="empty">loading…</div>';
  const r = await viewerClient.request('/api/plans/' + state.planId + '/audits/' + idx);
  if (!r.ok) { detail.innerHTML = '<div class="empty">failed to load</div>'; return; }
  const data = await r.json();
  if (!data.dirName) {
    detail.innerHTML = '<div class="empty">no audit folder yet — step is queued or not started</div>';
    return;
  }
  let html = '';
  html += '<div class="doc-section">' +
    '<h3>AUDIT_PRE.md <span class="meta">audits/' + esc(data.dirName) + '/AUDIT_PRE.md</span></h3>' +
    '<div class="doc-body' + (data.pre ? '' : ' missing') + '">' +
      (data.pre ? esc(data.pre) : '(not written yet)') +
    '</div></div>';
  html += '<div class="doc-section">' +
    '<h3>AUDIT_POST.md <span class="meta">audits/' + esc(data.dirName) + '/AUDIT_POST.md</span></h3>' +
    '<div class="doc-body' + (data.post ? '' : ' missing') + '">' +
      (data.post ? esc(data.post) : '(not written yet)') +
    '</div></div>';
  detail.innerHTML = html;
}

// ── Documents ─────────────────────────────────────────────────────────────────
async function renderDocList() {
  if (!state.planId) return;
  const r = await viewerClient.request('/api/plans/' + state.planId + '/docs');
  if (!r.ok) return;
  const docs = await r.json();
  const list = $('doc-list');
  list.innerHTML = '';
  for (const d of docs) {
    const div = document.createElement('div');
    div.className = 'doc-item' + (state.selectedDoc === d.name ? ' active' : '');
    const kb = (d.size / 1024).toFixed(1);
    div.innerHTML = '<div class="name">' + esc(d.name) + '</div>' +
      '<div class="meta">' + kb + ' KB</div>';
    div.addEventListener('click', () => { state.selectedDoc = d.name; renderDoc(d.name); document.querySelectorAll('.doc-list .doc-item').forEach(el => el.classList.toggle('active', el.querySelector('.name').textContent === d.name)); });
    list.appendChild(div);
  }
  if (state.selectedDoc) renderDoc(state.selectedDoc);
  else $('doc-view').innerHTML = '<div class="empty">select a document</div>';
}

async function renderDoc(name) {
  const r = await viewerClient.request('/api/plans/' + state.planId + '/doc?path=' + encodeURIComponent(name));
  if (!r.ok) { $('doc-view').textContent = '(failed to load)'; return; }
  const text = await r.text();
  $('doc-view').textContent = text;
}

// ── Block / Pause control ─────────────────────────────────────────────────────
async function renderBlock() {
  if (!state.planId) return;
  const view = $('block-view');

  // Preserve UI state across 5s auto-refreshes.
  const prevScroll = view.scrollTop;
  const prevTriggerVal = $('block-trigger')?.value;
  const prevDetailVal  = $('block-detail')?.value;
  const prevEditVal    = $('block-edit')?.value;
  const isFirstRender = !view.firstChild ||
    (view.firstElementChild && view.firstElementChild.classList.contains('empty'));
  if (isFirstRender) {
    view.innerHTML = '<div class="empty">loading…</div>';
  }

  const r = await viewerClient.request('/api/plans/' + state.planId + '/blocked');
  if (!r.ok) { view.innerHTML = '<div class="empty">failed to load</div>'; return; }
  const data = await r.json();

  // Skip when only the mtime changed; only re-render when block status flips
  // OR the content changes meaningfully.
  const stateHash = JSON.stringify({
    planId: state.planId,
    blocked: data.blocked,
    contentLen: data.content ? data.content.length : 0,
    locked: state.lastLocked,
  });
  if (!isFirstRender && state.lastBlockStateHash === stateHash) {
    return;
  }
  state.lastBlockStateHash = stateHash;

  view.classList.toggle('is-blocked', !!data.blocked);

  if (data.blocked) {
    // Parse the trigger out of the body if present (matches BLOCK_TEMPLATE).
    const trigMatch = (data.content || '').match(/^\*\*Trigger\*\*:\s*(.+)$/m);
    const trigger = trigMatch ? trigMatch[1].trim() : '(no trigger line)';
    view.innerHTML =
      '<h2><span class="status-pill blocked">PAUSED</span> Plan is blocked</h2>' +
      '<p class="lede">No further ticks will run until <code>BLOCKED.md</code> is removed.</p>' +
      (state.lastLocked
        ? '<div class="note"><strong>Note:</strong> a tick is currently still running. Pausing only prevents future ticks — the in-flight tick will finish on its own (it does not check the block file mid-run).</div>'
        : '') +
      '<div class="meta-row">file: memory-plan/BLOCKED.md · trigger: ' + esc(trigger) + '</div>' +
      '<div class="actions">' +
        '<button class="primary" id="btn-resume">▶ Resume (delete BLOCKED.md)</button>' +
        '<button class="danger" id="btn-edit-block">Edit reason</button>' +
      '</div>' +
      '<div id="block-toast"></div>' +
      '<div class="doc-render">' + esc(data.content || '(empty)') + '</div>';
    $('btn-resume').addEventListener('click', async () => {
      if (!confirm('Resume the plan?\\n\\nDeletes BLOCKED.md so the next tick runs. If the scheduler was auto-unloaded by a previous fast-exit, it will also be reloaded.')) return;
      const res = await doUnblock();
      if (res.error) showToast('block-toast', 'Error: ' + res.error, true);
      else {
        let msg = 'Resumed — block file deleted.';
        if (res.scheduler_reloaded) msg += ' Scheduler reloaded.';
        else if (res.scheduler_error) msg += ' (Scheduler reload failed: ' + res.scheduler_error + ')';
        showToast('block-toast', msg, false);
      }
    });
    $('btn-edit-block').addEventListener('click', () => renderBlockEditor(data.content || ''));
  } else {
    view.innerHTML =
      '<h2><span class="status-pill clear">CLEAR</span> Plan is running</h2>' +
      '<p class="lede">Write a <code>BLOCKED.md</code> file to pause future ticks. The framework checks for this file at the start of every tick.</p>' +
      (state.lastLocked
        ? '<div class="note"><strong>Heads up:</strong> a tick is running right now. Pausing now will prevent the <em>next</em> tick — the in-flight one runs to completion regardless.</div>'
        : '') +
      '<div class="form-row"><label for="block-trigger">Trigger (one line)</label>' +
        '<input type="text" id="block-trigger" placeholder="e.g. operator pause — investigating Step 0.5"></div>' +
      '<div class="form-row"><label for="block-detail">Detail (optional — multi-line)</label>' +
        '<textarea id="block-detail" placeholder="What\'s wrong, what you need to look into, anything the next operator should know."></textarea></div>' +
      '<div class="actions">' +
        '<button class="primary" id="btn-pause">⏸ Pause future ticks</button>' +
      '</div>' +
      '<div id="block-toast"></div>';
    $('btn-pause').addEventListener('click', async () => {
      const trigger = $('block-trigger').value.trim() || 'operator pause';
      const detail  = $('block-detail').value;
      if (!confirm('Pause future ticks?\n\nWrites memory-plan/BLOCKED.md. The current tick (if any) continues.')) return;
      const res = await doBlock({ trigger, detail });
      showToast('block-toast', res.error ? 'Error: ' + res.error : 'Paused — BLOCKED.md written.', !!res.error);
    });
  }

  // Restore preserved UI state.
  view.scrollTop = prevScroll;
  if (prevTriggerVal !== undefined && $('block-trigger')) $('block-trigger').value = prevTriggerVal;
  if (prevDetailVal  !== undefined && $('block-detail'))  $('block-detail').value  = prevDetailVal;
  if (prevEditVal    !== undefined && $('block-edit'))    $('block-edit').value    = prevEditVal;
}

function renderBlockEditor(currentContent) {
  const view = $('block-view');
  view.innerHTML =
    '<h2><span class="status-pill blocked">PAUSED</span> Edit block reason</h2>' +
    '<p class="lede">Replace the full content of <code>BLOCKED.md</code>. The plan stays paused until you click Resume on the previous screen.</p>' +
    '<div class="form-row"><label for="block-edit">BLOCKED.md content</label>' +
      '<textarea id="block-edit" style="min-height:280px;">' + esc(currentContent) + '</textarea></div>' +
    '<div class="actions">' +
      '<button class="primary" id="btn-save">Save</button>' +
      '<button class="danger" id="btn-cancel">Cancel</button>' +
    '</div>' +
    '<div id="block-toast"></div>';
  $('btn-cancel').addEventListener('click', () => renderBlock());
  $('btn-save').addEventListener('click', async () => {
    const content = $('block-edit').value;
    const r = await viewerClient.request('/api/plans/' + state.planId + '/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, force: true }),
    });
    const res = await r.json();
    if (res.error) showToast('block-toast', 'Error: ' + res.error, true);
    else renderBlock();
  });
}

function showToast(id, msg, isErr) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = '<div class="toast' + (isErr ? ' err' : '') + '">' + esc(msg) + '</div>';
  if (!isErr) setTimeout(() => { el.innerHTML = ''; }, 4000);
}

// ── Automation ────────────────────────────────────────────────────────────────
function humanInterval(sec) {
  sec = Number(sec);
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return (sec / 60).toFixed(sec % 60 === 0 ? 0 : 1) + ' min';
  if (sec < 86400) return (sec / 3600).toFixed(sec % 3600 === 0 ? 0 : 1) + ' h';
  return (sec / 86400).toFixed(sec % 86400 === 0 ? 0 : 1) + ' d';
}

function relativeTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 0) return 'in the future';
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.floor(h / 24) + ' d ago';
}

const INTERVAL_PRESETS = [
  { label: '5 min',  s: 300   },
  { label: '15 min', s: 900   },
  { label: '30 min', s: 1800  },
  { label: '1 h',    s: 3600  },
  { label: '2 h',    s: 7200  },
  { label: '6 h',    s: 21600 },
];

async function renderAutomation() {
  if (!state.planId) return;
  const view = $('auto-view');

  // Preserve UI state we don't want to wipe on the 5s state-refresh re-render.
  const prevScroll = view.scrollTop;
  const prevIntervalVal  = $('interval-val')?.value;
  const prevIntervalUnit = $('interval-unit')?.value;
  const prevThrottleVal  = $('throttle-val')?.value;
  const isFirstRender = !view.firstChild ||
    (view.firstElementChild && view.firstElementChild.classList.contains('empty'));
  if (isFirstRender) {
    view.innerHTML = '<div class="empty" style="padding:30px;color:var(--dim);">loading…</div>';
  }

  const r = await viewerClient.request('/api/plans/' + state.planId + '/automation');
  if (!r.ok) { view.innerHTML = '<div class="empty">failed to load</div>'; return; }
  const s = await r.json();
  const cfg = s.config;

  // Skip re-render if nothing STRUCTURAL changed — prevents the 5s scroll-jump
  // and form-input wipe. Deliberately excludes last_tick / last_tick_mtime /
  // pid so a tick firing doesn't redraw the whole panel (the user is in the
  // middle of clicking stuff).
  const stateHash = JSON.stringify({
    planId: state.planId,
    loaded: s.launchd.loaded,
    mode: s.plist_mode || cfg.mode,
    interval: s.plist_interval_seconds || cfg.interval_seconds,
    throttle: s.plist_throttle_seconds || cfg.throttle_seconds,
    plist_exists: s.plist_exists,
    blocked: state.lastBlocked,
  });
  if (!isFirstRender && state.lastAutoStateHash === stateHash) {
    return;
  }
  state.lastAutoStateHash = stateHash;

  const loaded = s.launchd.loaded;
  const plistExists = s.plist_exists;
  const persisted = cfg._persisted;
  // Effective mode/interval/throttle: prefer installed plist values, else config.
  const effMode     = s.plist_mode || cfg.mode || 'interval';
  const currentInterval = s.plist_interval_seconds || cfg.interval_seconds;
  const currentThrottle = s.plist_throttle_seconds || cfg.throttle_seconds || 30;

  const statusPill = loaded
    ? '<span class="status-pill on">RUNNING</span>'
    : (plistExists ? '<span class="status-pill warn">plist on disk, not loaded</span>' : '<span class="status-pill off">not installed</span>');

  let html = '';
  html += '<h2>' + statusPill + ' Automated tick scheduler</h2>';
  html += '<p class="lede" style="color:var(--dim);margin:0 0 24px;font-size:13px;">' +
    'Runs <code>' + esc(cfg.tick_command.split('/').pop()) + '</code> via macOS launchd. ' +
    'Independent from manual <code>./...-tick.sh</code> invocations.</p>';

  // ── Section: Current status ──
  html += '<div class="section"><h3>Current status</h3><div class="kv-grid">';
  const stateLine = loaded
    ? (effMode === 'chain'
        ? 'loaded — <strong>chain mode</strong> (restarts ≥' + humanInterval(currentThrottle) + ' after each tick exits)'
        : 'loaded — <strong>interval mode</strong> (fires every ' + humanInterval(currentInterval) + ')')
    : 'not loaded';
  html += '<div class="k">State</div><div class="v">' + stateLine + '</div>';
  if (loaded) {
    html += '<div class="k">launchd PID</div><div class="v ' + (s.launchd.pid ? '' : 'muted') + '">' +
      (s.launchd.pid != null ? s.launchd.pid : '(not currently executing)') + '</div>';
    html += '<div class="k">Last exit status</div><div class="v ' + (s.launchd.last_exit_status === 0 ? '' : 'muted') + '">' +
      (s.launchd.last_exit_status != null ? s.launchd.last_exit_status : '—') + '</div>';
  }
  html += '<div class="k">Last tick log</div><div class="v">' +
    (s.last_tick_name ? esc(s.last_tick_name) + '  <span class="muted">(' + relativeTime(s.last_tick_mtime) + ')</span>' : '—') +
    '</div>';
  html += '<div class="k">Config persisted</div><div class="v ' + (persisted ? '' : 'muted') + '">' +
    (persisted ? 'automation.json present' : 'using derived defaults (not saved yet)') + '</div>';
  html += '</div></div>';

  // ── Section: Schedule ──
  html += '<div class="section"><h3>Schedule</h3>';
  html += '<div style="font-size:12px;color:var(--dim);margin-bottom:14px;">' +
    'Choose how the autonomous tick is triggered.' +
    '</div>';

  // Mode toggle.
  html += '<div class="mode-toggle">' +
    '<button type="button" data-mode="interval" class="' + (effMode === 'interval' ? 'active' : '') + '">' +
      '<span class="mode-name">⏱ Interval</span>' +
      '<span class="mode-desc">Fires every N minutes regardless of work</span>' +
    '</button>' +
    '<button type="button" data-mode="chain" class="' + (effMode === 'chain' ? 'active' : '') + '">' +
      '<span class="mode-name">⛓ Chain</span>' +
      '<span class="mode-desc">Fires the next tick as soon as the previous one exits</span>' +
    '</button>' +
  '</div>';

  // Interval mode block.
  html += '<div class="mode-block' + (effMode === 'interval' ? ' active' : '') + '" id="mode-block-interval">';
  html += '<div style="font-size:12px;color:var(--dim);margin-bottom:10px;">' +
    'Each tick may close one step (typically 5–15 min of headless Claude work). Pick an interval longer than a typical tick to avoid overlap (the lock dir prevents real overlap, but skips waste a slot).' +
    '</div>';
  html += '<div class="presets" id="interval-presets">';
  for (const p of INTERVAL_PRESETS) {
    html += '<button type="button" class="preset' + (p.s === currentInterval ? ' active' : '') + '" data-seconds="' + p.s + '">' + esc(p.label) + '</button>';
  }
  html += '</div>';
  html += '<div class="interval-input">' +
    '<label style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px;">Custom:</label>' +
    '<input type="number" id="interval-val" value="' + (currentInterval / 60).toFixed(currentInterval % 60 === 0 ? 0 : 1) + '" min="1" step="1">' +
    '<select id="interval-unit">' +
      '<option value="60">minutes</option>' +
      '<option value="1">seconds</option>' +
      '<option value="3600">hours</option>' +
    '</select>' +
    '<button type="button" class="primary" id="interval-save">Apply interval</button>' +
    '</div>';
  html += '</div>'; // /mode-block-interval

  // Chain mode block.
  html += '<div class="mode-block' + (effMode === 'chain' ? ' active' : '') + '" id="mode-block-chain">';
  html += '<div style="font-size:12px;color:var(--dim);margin-bottom:10px;">' +
    'launchd <code>KeepAlive</code>: every time the tick wrapper exits, it is restarted after the throttle gap. This means ticks run back-to-back — the next one fires as soon as the previous one closes a step (or exits early because the lock is held / tree dirty / blocked).' +
    '</div>';
  html += '<div class="note" style="margin:8px 0 12px;">' +
    '<strong>Heads up:</strong> chain mode keeps polling whenever there\'s nothing to do (BLOCKED.md, dirty tree, lock held, plan complete). It exits fast and waits the throttle gap. Set a sane floor.' +
    '</div>';
  html += '<div class="interval-input">' +
    '<label style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px;">Throttle (min gap):</label>' +
    '<input type="number" id="throttle-val" value="' + esc(currentThrottle) + '" min="10" step="5">' +
    '<span style="color:var(--dim);font-size:12px;">seconds (launchd minimum: 10)</span>' +
    '<button type="button" class="primary" id="throttle-save" style="margin-left:8px;">Apply throttle</button>' +
    '</div>';
  html += '<div class="presets" style="margin-top:8px;">';
  for (const t of [10, 30, 60, 120, 300]) {
    html += '<button type="button" class="preset throttle-preset' + (t === currentThrottle ? ' active' : '') + '" data-throttle="' + t + '">' + t + 's</button>';
  }
  html += '</div>';
  html += '</div>'; // /mode-block-chain

  html += '<div id="interval-toast"></div>';
  html += '</div>'; // /section schedule

  // ── Section: Actions ──
  html += '<div class="section"><h3>Actions</h3>';
  if (state.lastLocked) {
    html += '<div class="note">A tick is currently running. Watch the Live tab. Most actions will refuse while the lock is held.</div>';
  }
  html += '<div class="actions">';
  if (loaded) {
    html += '<button type="button" class="primary" id="btn-kickstart" title="launchctl kickstart -k">▶ Fire scheduled tick now</button>';
    html += '<button type="button" class="secondary" id="btn-run-once" title="Spawn one tick directly (independent of launchd)">▶ Run one tick (manual)</button>';
    html += '<button type="button" class="danger" id="btn-unload" title="launchctl bootout">⏹ Stop scheduler (unload)</button>';
  } else {
    html += '<button type="button" class="primary" id="btn-load"' + (s.tick_command_exists ? '' : ' disabled title="tick command not found"') +
      ' title="Writes plist + launchctl bootstrap. In chain mode RunAtLoad=true, so the first tick fires immediately.">' +
      '▶ Start scheduler (cold-start)</button>';
    html += '<button type="button" class="secondary" id="btn-run-once" title="Spawn one tick directly without involving launchd. Useful for one-off testing.">▶ Run one tick (manual)</button>';
  }
  html += '</div>';
  if (!loaded) {
    html += '<div style="margin-top:14px;font-size:11px;color:var(--dim);">' +
      '<strong>What "Start scheduler" does:</strong> writes <code>' + esc(cfg.plist_path) + '</code>, ' +
      'then runs <code>launchctl bootstrap</code>. In ' + (cfg.mode === 'chain' ? 'chain' : 'interval') + ' mode, ' +
      (cfg.mode === 'chain'
        ? 'the first tick fires <strong>immediately</strong> (RunAtLoad=true), then each subsequent tick fires ~' + esc(currentThrottle) + 's after the previous one exits.'
        : 'the first tick fires after one full <strong>' + humanInterval(currentInterval) + '</strong> interval (RunAtLoad=false). Use "Fire scheduled tick now" after loading to start sooner, or "Run one tick" right away.') +
      '</div>';
  }
  html += '<div id="action-toast"></div>';
  html += '</div>';

  // ── Section: Configuration (read-only display) ──
  html += '<div class="section"><h3>Configuration</h3><div class="kv-grid">';
  html += '<div class="k">launchd label</div><div class="v">' + esc(cfg.plist_label) + '</div>';
  html += '<div class="k">plist file</div><div class="v">' + esc(cfg.plist_path) + '</div>';
  html += '<div class="k">tick command</div><div class="v">' + esc(cfg.tick_command) +
    (s.tick_command_exists ? '' : '  <span style="color:var(--red);">(missing!)</span>') + '</div>';
  html += '<div class="k">working dir</div><div class="v">' + esc(cfg.working_dir) + '</div>';
  html += '<div class="k">stdout log</div><div class="v">' + esc(cfg.stdout_path) + '</div>';
  html += '<div class="k">stderr log</div><div class="v">' + esc(cfg.stderr_path) + '</div>';
  html += '<div class="k">env</div><div class="v">' + esc(Object.entries(cfg.env || {}).map(([k,v]) => k + '=' + v).join('  ')) + '</div>';
  html += '</div>';
  html += '<div style="margin-top:14px;font-size:11px;color:var(--dim);">Stored at <code>' + esc(state.planId) + '/automation.json</code>. Hand-edit then re-save from the UI to apply.</div>';
  html += '</div>';

  view.innerHTML = html;

  // Wire interactions.
  for (const btn of view.querySelectorAll('.preset[data-seconds]')) {
    btn.addEventListener('click', () => {
      const sec = Number(btn.dataset.seconds);
      $('interval-val').value = (sec / 60).toFixed(sec % 60 === 0 ? 0 : 1);
      $('interval-unit').value = '60';
      view.querySelectorAll('.preset[data-seconds]').forEach(b => b.classList.toggle('active', b === btn));
    });
  }
  for (const btn of view.querySelectorAll('.throttle-preset')) {
    btn.addEventListener('click', () => {
      $('throttle-val').value = btn.dataset.throttle;
      view.querySelectorAll('.throttle-preset').forEach(b => b.classList.toggle('active', b === btn));
    });
  }
  // Mode toggle.
  for (const btn of view.querySelectorAll('.mode-toggle button')) {
    btn.addEventListener('click', async () => {
      const newMode = btn.dataset.mode;
      if (newMode === effMode) return;
      const msg = newMode === 'chain'
        ? 'Switch to CHAIN mode? Next tick fires as soon as the previous one exits (min ' + esc(currentThrottle) + 's gap).\\n\\nThe scheduler will reload now.'
        : 'Switch to INTERVAL mode? Next tick fires every ' + Math.round(currentInterval / 60) + ' min on a fixed cadence.\\n\\nThe scheduler will reload now.';
      if (!confirm(msg)) return;
      const r2 = await viewerClient.request('/api/plans/' + state.planId + '/automation/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      const res = await r2.json();
      if (res.error) showToast('interval-toast', 'Error: ' + res.error, true);
      else {
        showToast('interval-toast', 'Switched to ' + newMode + ' mode' +
          (res.reloaded ? ' (scheduler reloaded)' : (res.applied_to_plist ? ' (plist updated)' : ' (saved — load to apply)')), false);
        setTimeout(renderAutomation, 600);
      }
    });
  }
  const throttleSaveBtn = $('throttle-save');
  if (throttleSaveBtn) {
    throttleSaveBtn.addEventListener('click', async () => {
      const sec = Number($('throttle-val').value);
      if (!Number.isFinite(sec) || sec < 10) {
        showToast('interval-toast', 'Throttle must be at least 10 seconds (launchd minimum).', true);
        return;
      }
      const r2 = await viewerClient.request('/api/plans/' + state.planId + '/automation/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ throttle_seconds: sec, mode: 'chain' }),
      });
      const res = await r2.json();
      if (res.error) showToast('interval-toast', 'Error: ' + res.error, true);
      else {
        showToast('interval-toast', 'Throttle set to ' + sec + 's' +
          (res.reloaded ? ' (scheduler reloaded)' : (res.applied_to_plist ? ' (plist updated)' : ' (saved — load to apply)')), false);
        setTimeout(renderAutomation, 600);
      }
    });
  }
  const intervalSaveBtn = $('interval-save');
  if (intervalSaveBtn) {
    intervalSaveBtn.addEventListener('click', async () => {
      const val = Number($('interval-val').value);
      const unit = Number($('interval-unit').value);
      const sec = Math.round(val * unit);
      if (!Number.isFinite(sec) || sec < 60) {
        showToast('interval-toast', 'Interval must be at least 60 seconds.', true);
        return;
      }
      const r2 = await viewerClient.request('/api/plans/' + state.planId + '/automation/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval_seconds: sec, mode: 'interval' }),
      });
      const res = await r2.json();
      if (res.error) showToast('interval-toast', 'Error: ' + res.error, true);
      else {
        showToast('interval-toast', 'Interval set to ' + humanInterval(sec) +
          (res.reloaded ? ' (scheduler reloaded)' : (res.applied_to_plist ? ' (plist updated)' : ' (config saved — load to apply)')), false);
        setTimeout(renderAutomation, 600);
      }
    });
  }
  const loadBtn = $('btn-load');
  if (loadBtn) loadBtn.addEventListener('click', async () => {
    const r2 = await viewerClient.request('/api/plans/' + state.planId + '/automation/load', { method: 'POST' });
    const res = await r2.json();
    if (res.error) showToast('action-toast', 'Error: ' + res.error, true);
    else {
      showToast('action-toast', res.msg || 'loaded', false);
      // Invalidate state-hash so the next renderAutomation actually redraws.
      state.lastAutoStateHash = null;
      setTimeout(renderAutomation, 600);
      setTimeout(refreshPlans, 600);  // update sidebar dot
    }
  });
  const unloadBtn = $('btn-unload');
  if (unloadBtn) unloadBtn.addEventListener('click', async () => {
    if (!confirm('Unload the scheduler? No more automated ticks will fire until you load it again.')) return;
    const r2 = await viewerClient.request('/api/plans/' + state.planId + '/automation/unload', { method: 'POST' });
    const res = await r2.json();
    if (res.error) showToast('action-toast', 'Error: ' + res.error, true);
    else {
      showToast('action-toast', res.msg || 'unloaded', false);
      state.lastAutoStateHash = null;
      setTimeout(renderAutomation, 600);
      setTimeout(refreshPlans, 600);
    }
  });
  const kickBtn = $('btn-kickstart');
  if (kickBtn) kickBtn.addEventListener('click', async () => {
    const r2 = await viewerClient.request('/api/plans/' + state.planId + '/automation/kickstart', { method: 'POST' });
    const res = await r2.json();
    if (res.error) showToast('action-toast', 'Error: ' + res.error, true);
    else { showToast('action-toast', res.msg || 'kickstart fired', false); setTimeout(refreshPlans, 800); }
  });
  const runOnceBtn = $('btn-run-once');
  if (runOnceBtn) runOnceBtn.addEventListener('click', async () => {
    if (!confirm('Run one tick now?\\n\\nSpawns the wrapper directly (no launchd involvement). Use this to cold-start without committing to a schedule.')) return;
    const r2 = await viewerClient.request('/api/plans/' + state.planId + '/automation/run-once', { method: 'POST' });
    const res = await r2.json();
    if (res.error) showToast('action-toast', 'Error: ' + res.error, true);
    else { showToast('action-toast', res.msg || 'tick spawned', false); setTimeout(refreshState, 1500); setTimeout(refreshPlans, 1500); }
  });

  // Restore preserved UI state (scroll + form inputs).
  view.scrollTop = prevScroll;
  if (prevIntervalVal  !== undefined && $('interval-val'))  $('interval-val').value  = prevIntervalVal;
  if (prevIntervalUnit !== undefined && $('interval-unit')) $('interval-unit').value = prevIntervalUnit;
  if (prevThrottleVal  !== undefined && $('throttle-val'))  $('throttle-val').value  = prevThrottleVal;
}

// ── History ───────────────────────────────────────────────────────────────────
async function renderHistory() {
  if (!state.planId) return;
  const r = await viewerClient.request('/api/plans/' + state.planId + '/logs');
  if (!r.ok) return;
  const logs = await r.json();
  const list = $('history-list');
  list.innerHTML = '';
  for (const l of logs) {
    const div = document.createElement('div');
    const when = new Date(l.mtime).toLocaleString();
    if (l.kind === 'step') {
      // Step closure (interactive or tick) — informational, not a live log.
      div.className = 'h-item step';
      div.innerHTML =
        '<div class="name">✓ ' + esc(l.name) + '</div>' +
        '<div class="size">step closed</div>' +
        '<div class="time">' + esc(when) + '</div>';
    } else {
      div.className = 'h-item';
      const kb = (l.size / 1024).toFixed(1);
      div.innerHTML =
        '<div class="name">' + esc(l.name) + '</div>' +
        '<div class="size">' + kb + ' KB</div>' +
        '<div class="time">' + esc(when) + '</div>';
      div.addEventListener('click', () => {
        // Pin this historical tick log into the dock's Live feed.
        state.glivePin = { planId: state.planId, log: l.name };
        state.gtab = 'glive';
        $('follow-new').checked = false;
        document.querySelectorAll('.gtab-btn').forEach(b => b.classList.toggle('active', b.dataset.gtab === 'glive'));
        showDock();
      });
    }
    list.appendChild(div);
  }
  if (!logs.length) list.innerHTML = '<div class="empty">No tick logs — this plan is run interactively (no scheduler ticks recorded). Load the scheduler in the Automation tab to record runs here.</div>';
}

// ── Dock resize (drag the top edge to expand / shrink the panel) ────────────────
(function () {
  const handle = $('dock-resize');
  const apply = (px) => { document.body.style.gridTemplateRows = '1fr ' + px + 'px'; };
  const clamp = (px) => Math.max(70, Math.min(window.innerHeight - 140, px));
  try { const s = parseInt(localStorage.getItem('workplan.dockH'), 10); if (s) apply(clamp(s)); } catch {}
  let dragging = false;
  const onMove = (e) => { if (dragging) apply(clamp(window.innerHeight - e.clientY)); };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    try {
      const h = parseInt(document.body.style.gridTemplateRows.split(' ')[1], 10);
      if (h) localStorage.setItem('workplan.dockH', String(h));
    } catch {}
  };
  handle.addEventListener('mousedown', (e) => {
    dragging = true; handle.classList.add('dragging');
    document.body.style.userSelect = 'none'; e.preventDefault();
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
})();

// ── Boot ──────────────────────────────────────────────────────────────────────
const loginForm = $('viewer-login-form');
const loginError = $('viewer-login-error');
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('viewer-key');
  const credential = input.value.trim();
  input.value = '';
  loginError.textContent = '';
  try {
    await viewerClient.login(credential);
    location.reload();
  } catch {
    loginError.textContent = 'Sign-in failed. Check your access key and try again.';
  }
});
$('viewer-sign-out').addEventListener('click', async () => {
  await viewerClient.logout();
  location.reload();
});
window.addEventListener('pagehide', () => viewerClient.stop());
if (viewerClient.hasSession()) {
  refreshPlans().then(() => {
    $('viewer-login').hidden = true;
    document.body.classList.remove('signed-out');
    refreshNotifyToggle();
    showDock();
    setInterval(refreshPlans, 10000);
    setInterval(refreshNotifyToggle, 15000);
  }).catch(() => { loginError.textContent = 'Could not load the viewer. Sign in again or retry later.'; });
}
