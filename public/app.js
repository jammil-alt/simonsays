/* Homework Desk front end. Ported from the claude.ai prototype: same UI, but data lives
   behind the Worker's REST API (see api.js). Sections marked "unchanged" are copied
   from the prototype as-is. */
(() => {
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const SIZES = { s: .02, m: .026, l: .034 };
const SUBJECTS = ['Math', 'Writing', 'Reading', 'Other'];
const ICON = {
  grip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  width: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 8l4 4-4 4M6 8l-4 4 4 4M2 12h20"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  wand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21h13M5.5 14.5l7-7a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8l-2.5-2.5a2 2 0 0 1 0-2.8zM9 11l5 5"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/></svg>',
};

let cleanMap = new Map();        // pageId -> {data, at}
let typedMap = new Map();        // pageId -> {fieldId: value}
const viewMode = new Map();      // pageId -> 'clean' | 'photo'
const genState = new Map();      // pageId -> {ctl} | {error}
const typedTimers = new Map();
const WFS = { s: '18px', m: '21px', l: '25px' };
let assignments = [];            // sidebar list: [{id, title, subject, due, done, size, createdAt, pageCount, thumbKey}]
let currentId = null;
let detail = null;               // current assignment: list fields + pages [{id, key, w, h}]
let answers = new Map();         // id -> {p, x, y, w, t}, for current assignment
let pendingDelete = null;        // 'assignment' | null
const saveTimers = new Map();
const localBoxes = new Set();    // ids created locally but not yet saved
let loadSeq = 0;
let uploadTarget = null;         // Promise<assignmentId> while "New" is creating one

const ERR_TEXT = {
  signed_out: 'You were signed out. Reload the page to sign in again.',
  offline: "Can't reach the server. Check the Wi-Fi and try again.",
  not_configured: 'Clean copies are not set up yet: the server has no working Anthropic API key.',
  rate_limited: 'Too many requests at once. Wait a minute, then try again.',
  overloaded: 'Claude is busy right now. Wait a minute, then try again.',
  timeout: 'That took too long. Try again.',
  invalid_json: 'The worksheet came back in a shape the page could not read. Try again.',
  empty: 'No questions were found on this page. A sharper, straighter photo usually helps.',
  bad_photo: 'Claude could not read that photo. A sharper, straighter photo usually helps.',
  refused: 'Claude would not make a clean copy of this page. Try a different photo.',
  not_found: 'That was already deleted.',
  access_not_configured: 'The site is not finished setting up: Cloudflare Access is not configured yet.',
};
const errText = (e, what) => ERR_TEXT[e?.code] || `${what} (${e?.code || 'error'})`;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200);
}
const cur = () => (detail && detail.id === currentId ? detail : null);
function fmtDate(ms) { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function fmtDue(s) { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }

/* ---------- boot + refresh ---------- */
async function boot() {
  await refreshList(true);
  let last = null; try { last = localStorage.getItem('hw:last'); } catch {}
  if (!currentId && last && assignments.some(a => a.id === last) && window.innerWidth > 760) open(last);
}

async function refreshList(first) {
  try {
    assignments = await API.listAssignments();
    if (detail) syncListItem();
    renderList();
  } catch (e) {
    if (first) $('#list').innerHTML = `<div class="list-empty">${esc(errText(e, 'Could not load assignments'))}</div>`;
    else if (e.code === 'signed_out') toast(errText(e));
  }
}

// No live sync: pick up changes from another device when this tab comes back into view.
let lastRefresh = 0;
function refreshAll() {
  if (Date.now() - lastRefresh < 3000) return;
  lastRefresh = Date.now();
  refreshList();
  if (currentId) loadDetail(currentId);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });
window.addEventListener('focus', refreshAll);

/** Fetch the open assignment. `first` renders from scratch; otherwise merge into what's on screen. */
async function loadDetail(id, first) {
  const seq = ++loadSeq;
  let d;
  try { d = await API.getAssignment(id); }
  catch (e) {
    if (seq !== loadSeq || id !== currentId) return;
    if (e.status === 404) {
      currentId = null; detail = null; renderWelcome();
      assignments = assignments.filter(a => a.id !== id); renderList();
      return toast('That assignment was deleted.');
    }
    if (first) $('#view').innerHTML = `<div class="offline">${esc(errText(e, 'Could not open the assignment'))}</div>`;
    else toast(errText(e, 'Could not refresh'));
    return;
  }
  if (seq !== loadSeq || id !== currentId) return;
  const { answers: ans, clean, typed, ...rest } = d;
  detail = rest;
  // Keep boxes typed here that are not saved yet; take everything else from the server.
  const next = new Map(ans.map(a => [a.id, { p: a.pageId, x: a.x, y: a.y, w: a.w, t: a.t }]));
  for (const [aid, v] of answers) if (localBoxes.has(aid) || saveTimers.has(aid)) next.set(aid, v);
  answers = next;
  cleanMap = new Map(Object.entries(clean));
  for (const [pid, vals] of Object.entries(typed)) if (!typedTimers.has(pid)) typedMap.set(pid, { ...vals });
  for (const pid of [...typedMap.keys()]) if (!(pid in typed) && !typedTimers.has(pid)) typedMap.delete(pid);
  syncListItem(); renderList();
  if (first) renderDetail();
  else {
    const sig = detail.pages.map(p => p.id).join(',');
    renderHeaderOnly();
    if ($('#pages') && sig === $('#pages').dataset.sig) {
      document.querySelectorAll('.page').forEach(sec => { refreshPage(sec); fillTyped(sec); });
      syncBoxes();
    }
  }
}

/** Copy the open assignment's fields into its sidebar row. */
function syncListItem() {
  const a = cur(); if (!a) return;
  const row = assignments.find(x => x.id === a.id); if (!row) return;
  Object.assign(row, { title: a.title, subject: a.subject, due: a.due, done: a.done, size: a.size,
    pageCount: a.pages.length, thumbKey: a.pages[0]?.key || null });
}

/* ---------- list ---------- */
function renderList() {
  const el = $('#list');
  if (!assignments.length) { el.innerHTML = '<div class="list-empty">No assignments yet. Press New to add the first worksheet.</div>'; return; }
  el.innerHTML = assignments.map(a => {
    const n = a.pageCount || 0;
    const thumb = a.thumbKey ? `style="background-image:url('${esc(API.imgUrl(a.thumbKey))}')"` : '';
    const meta = [a.subject, a.due ? 'Due ' + fmtDue(a.due) : fmtDate(a.createdAt), n + (n === 1 ? ' page' : ' pages')].filter(Boolean).join(' · ');
    return `<button class="row" type="button" data-id="${esc(a.id)}" aria-current="${a.id === currentId}">
      <span class="thumb" ${thumb}></span>
      <span style="min-width:0"><div class="row-title">${esc(a.title || 'Untitled')}</div><div class="row-meta">${esc(meta)}</div></span>
      <span class="pill ${a.done ? 'done' : 'todo'}">${a.done ? 'Done' : 'To do'}</span></button>`;
  }).join('');
}
$('#list').addEventListener('click', e => { const r = e.target.closest('.row'); if (r) open(r.dataset.id); });

function renderWelcome() {
  $('#app').classList.remove('detail');
  $('#view').innerHTML = `<div class="welcome"><span class="eyebrow">Homework</span><h2>Pick an assignment</h2><p>Choose one on the left, or press New to add a worksheet.</p></div>`;
}

/* ---------- new ---------- */
$('#newBtn').addEventListener('click', () => {
  // Open the picker inside the tap itself (iPad Safari blocks it after an await),
  // and create the assignment while the picker is up.
  $('#fileIn').click();
  const title = 'Homework ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const p = API.createAssignment({ title, subject: 'Math' }).then(a => {
    assignments.unshift(a);
    open(a.id);
    return a.id;
  });
  uploadTarget = p;
  p.catch(e => { if (uploadTarget === p) uploadTarget = null; toast(errText(e, 'Could not create the assignment')); });
});

/* ---------- open / detail ---------- */
function open(id) {
  $('#app').classList.add('detail');
  if (currentId !== id) {
    currentId = id; pendingDelete = null; detail = null;
    try { localStorage.setItem('hw:last', id); } catch {}
    answers = new Map(); localBoxes.clear(); cleanMap = new Map(); typedMap = new Map(); viewMode.clear();
    renderList();
    $('#view').innerHTML = '<div class="busy">Loading…</div>';
    loadDetail(id, true);
    return;
  }
  renderList();
  renderDetail();
}

function headerHTML(a) {
  return `
  <button class="btn ghost back" type="button" id="backBtn">${ICON.back}All assignments</button>
  <div class="head">
    <div class="title-wrap">
      <label class="eyebrow" for="titleIn">Assignment</label>
      <input class="title-input" id="titleIn" value="${esc(a.title)}" autocomplete="off">
      <div class="fields">
        <div class="seg" role="group" aria-label="Subject">${SUBJECTS.map(s => `<button type="button" data-subj="${s}" aria-pressed="${a.subject === s}">${s}</button>`).join('')}</div>
        <label class="field" for="dueIn">Due <input type="date" id="dueIn" value="${esc(a.due || '')}"></label>
      </div>
    </div>
    <div class="actions">
      <div class="seg" role="group" aria-label="Answer text size">${['s','m','l'].map(k => `<button type="button" data-size="${k}" aria-pressed="${(a.size||'m') === k}" aria-label="Text size ${k}">${{s:'A',m:'A+',l:'A++'}[k]}</button>`).join('')}</div>
      <button class="btn" type="button" id="cleanAllBtn">${ICON.wand}Clean copies</button>
      <button class="btn" type="button" id="addPagesBtn">${ICON.cam}Add pages</button>
      <button class="btn ${a.done ? '' : 'primary'}" type="button" id="doneBtn">${ICON.check}${a.done ? 'Mark not done' : 'Mark done'}</button>
      <button class="btn icon ghost" type="button" id="delBtn" aria-label="Delete assignment">${ICON.trash}</button>
    </div>
  </div>
  <div id="confirmSlot"></div>`;
}

function renderHeaderOnly() {
  const a = cur(); if (!a) return;
  const slot = $('#headSlot'); if (!slot) return;
  const t = $('#titleIn'); if (document.activeElement !== t) t.value = a.title || '';
  if (document.activeElement !== $('#dueIn')) $('#dueIn').value = a.due || '';
  document.querySelectorAll('[data-subj]').forEach(b => b.setAttribute('aria-pressed', a.subject === b.dataset.subj));
  document.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', (a.size||'m') === b.dataset.size));
  const d = $('#doneBtn'); d.className = 'btn ' + (a.done ? '' : 'primary'); d.innerHTML = ICON.check + (a.done ? 'Mark not done' : 'Mark done');
  document.querySelectorAll('.sheet').forEach(s => s.style.setProperty('--fs', SIZES[a.size || 'm']));
  document.querySelectorAll('.clean').forEach(s => s.style.setProperty('--wfs', WFS[a.size || 'm']));
  const sig = a.pages.map(p => p.id).join(',');
  if (sig !== $('#pages').dataset.sig) renderPages();
}

function renderDetail() {
  const a = cur(); if (!a) return renderWelcome();
  $('#view').innerHTML = `<div id="headSlot">${headerHTML(a)}</div><div id="busySlot"></div><div class="pages" id="pages"></div>`;
  wireHeader();
  renderPages();
  $('#main').scrollTop = 0;
}

/** Optimistic update of the open assignment's own fields. */
function update(fields) {
  const a = cur(); if (!a) return;
  Object.assign(a, fields);
  syncListItem(); renderList(); renderHeaderOnly();
  return API.updateAssignment(a.id, fields).catch(e => toast(errText(e, 'Not saved')));
}

function wireHeader() {
  $('#backBtn').onclick = () => { $('#app').classList.remove('detail'); };
  let tt;
  $('#titleIn').oninput = e => { clearTimeout(tt); const v = e.target.value; tt = setTimeout(() => update({ title: v.trim() || 'Untitled' }), 500); };
  $('#titleIn').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  $('#dueIn').onchange = e => update({ due: e.target.value });
  document.querySelectorAll('[data-subj]').forEach(b => b.onclick = () => update({ subject: b.dataset.subj }));
  document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => update({ size: b.dataset.size }));
  $('#doneBtn').onclick = () => update({ done: !cur().done });
  $('#cleanAllBtn').onclick = cleanAll;
  $('#addPagesBtn').onclick = pickFiles;
  $('#delBtn').onclick = () => { pendingDelete = 'assignment'; renderConfirm(); };
}

function pickFiles() { uploadTarget = null; $('#fileIn').click(); }

function renderConfirm() {
  const slot = $('#confirmSlot'); if (!slot) return;
  if (pendingDelete !== 'assignment') { slot.innerHTML = ''; return; }
  slot.innerHTML = `<div class="confirm"><span>Delete this assignment, its pages and every typed answer? This can't be undone.</span>
    <button class="btn" type="button" id="cancelDel">Keep it</button><button class="btn danger" type="button" id="okDel">Delete</button></div>`;
  $('#cancelDel').onclick = () => { pendingDelete = null; renderConfirm(); };
  $('#okDel').onclick = deleteAssignment;
}

async function deleteAssignment() {
  const a = cur(); if (!a) return;
  try {
    await API.deleteAssignment(a.id);
  } catch (e) { if (e.code !== 'not_found') return toast(errText(e, 'Could not delete')); }
  for (const t of saveTimers.values()) clearTimeout(t);
  for (const t of typedTimers.values()) clearTimeout(t);
  saveTimers.clear(); typedTimers.clear();
  assignments = assignments.filter(x => x.id !== a.id);
  try { localStorage.removeItem('hw:last'); } catch {}
  currentId = null; detail = null; pendingDelete = null; renderWelcome(); renderList();
  toast('Assignment deleted');
}

/* ---------- pages ---------- */
const ro = new ResizeObserver(entries => { for (const en of entries) en.target.style.setProperty('--pw', en.contentRect.width + 'px'); });

function renderPages() {
  const a = cur(); const el = $('#pages'); if (!a || !el) return;
  const pages = a.pages;
  el.dataset.sig = pages.map(p => p.id).join(',');
  ro.disconnect();
  if (!pages.length) {
    el.innerHTML = `<div class="drop" id="drop">
      <h2>Add the worksheet</h2>
      <p>Take a photo of each page, or pick a PDF. Every page of a PDF comes in as its own page. You can also drag files here.</p>
      <div class="actions"><button class="btn primary" type="button" id="dropPick">${ICON.cam}Add photos or PDF</button></div>
    </div>`;
    $('#dropPick').onclick = pickFiles;
    wireDrop($('#drop'));
    return;
  }
  el.innerHTML = `<div class="hint">${ICON.add.replace('aria-hidden', 'class="ico" aria-hidden')}<span><b>Clean copy</b> rebuilds a messy photo as a tidy worksheet with boxes to type in. On the <b>photo</b>, tap anywhere to type an answer right there.</span></div>` +
    pages.map((p, i) => `<section class="page" data-page="${esc(p.id)}" aria-label="Page ${i + 1}">
      <div class="page-bar"><span class="eyebrow">Page ${i + 1} of ${pages.length}<span class="prog"></span></span>
        <div class="page-tools"><span class="vtools" style="display:contents"></span>
          <button class="btn ghost" type="button" data-act="dl" data-i="${i}">${ICON.dl}Save image</button>
          ${i > 0 ? `<button class="btn ghost icon" type="button" data-act="up" data-i="${i}" aria-label="Move page up">${ICON.up}</button>` : ''}
          <button class="btn ghost icon" type="button" data-act="rm" data-i="${i}" aria-label="Remove page">${ICON.trash}</button>
        </div></div>
      <div class="pconfirm"></div>
      <div class="clean" style="--wfs:${WFS[a.size || 'm']}" hidden></div>
      <div class="sheet" style="--fs:${SIZES[a.size || 'm']}"><img src="${esc(API.imgUrl(p.key))}" alt="Worksheet page ${i + 1}" width="${p.w || ''}" height="${p.h || ''}"><div class="layer"></div></div>
    </section>`).join('') +
    `<div class="drop" id="drop" style="padding:24px"><div class="actions"><button class="btn" type="button" id="dropPick">${ICON.cam}Add more pages</button></div></div>`;
  $('#dropPick').onclick = pickFiles;
  wireDrop($('#drop'));
  el.querySelectorAll('.sheet').forEach(s => { ro.observe(s); s.addEventListener('click', onSheetClick); });
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => pageAction(b.dataset.act, +b.dataset.i, b));
  el.querySelectorAll('.page').forEach(refreshPage);
  syncBoxes();
}

async function pageAction(act, i, btn) {
  const a = cur(); if (!a) return;
  const p = a.pages[i]; if (!p) return;
  if (act === 'dl') return savePageImage(i);
  if (act === 'up') {
    [a.pages[i - 1], a.pages[i]] = [a.pages[i], a.pages[i - 1]];
    syncListItem(); renderList(); renderPages();
    try { await API.movePage(p.id, i - 1); }
    catch (e) { toast(errText(e, 'Page order not saved')); loadDetail(a.id); }
    return;
  }
  if (act === 'rm') {
    const slot = btn.closest('.page').querySelector('.pconfirm');
    slot.innerHTML = `<div class="confirm" style="margin:8px;border-radius:var(--r-sm)"><span>Remove page ${i + 1} and its answers?</span>
      <button class="btn" type="button">Keep</button><button class="btn danger" type="button">Remove</button></div>`;
    const [keep, rm] = slot.querySelectorAll('button');
    keep.onclick = () => slot.innerHTML = '';
    rm.onclick = async () => {
      rm.disabled = true;
      try { await API.deletePage(p.id); }
      catch (e) { if (e.code !== 'not_found') { rm.disabled = false; return toast(errText(e, 'Could not remove the page')); } }
      for (const [aid, d] of answers) if (d.p === p.id) { clearTimeout(saveTimers.get(aid)); saveTimers.delete(aid); localBoxes.delete(aid); answers.delete(aid); }
      clearTimeout(typedTimers.get(p.id)); typedTimers.delete(p.id);
      cleanMap.delete(p.id); typedMap.delete(p.id); genState.get(p.id)?.ctl?.abort(); genState.delete(p.id);
      if (cur() === a) { a.pages = a.pages.filter(x => x.id !== p.id); syncListItem(); renderList(); renderPages(); }
    };
  }
}

/* ---------- clean copy ---------- */
// The prompt lives in the Worker (src/prompt.ts). The renderer below is the other half of that JSON contract.

function cleanMode(pid) { return viewMode.get(pid) || (cleanMap.has(pid) ? 'clean' : 'photo'); }

function refreshPage(sec) {
  const pid = sec.dataset.page;
  const has = cleanMap.has(pid), g = genState.get(pid), mode = cleanMode(pid);
  const vt = sec.querySelector('.vtools');
  let h = '';
  if (has) h += `<div class="seg vseg" role="group" aria-label="View"><button type="button" data-v="clean" aria-pressed="${mode === 'clean'}">Clean copy</button><button type="button" data-v="photo" aria-pressed="${mode === 'photo'}">Photo</button></div>`;
  if (!g?.ctl) h += `<button class="btn ghost" type="button" data-gen>${ICON.wand}${has ? 'Redo' : 'Make clean copy'}</button>`;
  vt.innerHTML = h;
  vt.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { viewMode.set(pid, b.dataset.v); refreshPage(sec); });
  const gb = vt.querySelector('[data-gen]'); if (gb) gb.onclick = () => has ? confirmRedo(sec) : makeClean(pid);
  const dl = sec.querySelector('[data-act="dl"]'); if (dl) dl.hidden = mode === 'clean' && !g;

  const box = sec.querySelector('.clean'), sheet = sec.querySelector('.sheet');
  const showClean = mode === 'clean' || !!g;
  box.hidden = !showClean; sheet.hidden = showClean;
  if (g?.ctl) {
    box.dataset.at = '';
    box.innerHTML = `<div class="gen"><b>Reading the worksheet…</b><span>This usually takes 20–60 seconds.</span><button class="btn" type="button">Stop</button></div>`;
    box.querySelector('button').onclick = () => g.ctl.abort();
  } else if (g?.error) {
    box.dataset.at = '';
    box.innerHTML = `<div class="gen"><span class="err">${esc(g.error)}</span><div class="actions"><button class="btn primary" type="button" data-r>Try again</button><button class="btn" type="button" data-p>Back to photo</button></div></div>`;
    box.querySelector('[data-r]').onclick = () => makeClean(pid);
    box.querySelector('[data-p]').onclick = () => { genState.delete(pid); viewMode.set(pid, 'photo'); refreshPage(sec); };
  } else if (has && String(cleanMap.get(pid).at) !== box.dataset.at) {
    box.dataset.at = String(cleanMap.get(pid).at);
    box.innerHTML = renderWorksheet(cleanMap.get(pid).data, pid);
    wireWorksheet(box, pid);
    fillTyped(sec);
  }
  updateProgress(sec);
}

function confirmRedo(sec) {
  const slot = sec.querySelector('.pconfirm');
  slot.innerHTML = `<div class="confirm" style="margin:8px;border-radius:var(--r-sm)"><span>Rebuild the clean copy from the photo? Answers typed on the clean copy will be cleared.</span>
    <button class="btn" type="button">Keep it</button><button class="btn danger" type="button">Rebuild</button></div>`;
  const [k, r] = slot.querySelectorAll('button');
  k.onclick = () => slot.innerHTML = '';
  r.onclick = () => { slot.innerHTML = ''; makeClean(sec.dataset.page); };
}

async function makeClean(pid) {
  if (genState.get(pid)?.ctl) return;
  const ctl = new AbortController();
  genState.set(pid, { ctl });
  const sec = () => document.querySelector(`.page[data-page="${pid}"]`);
  if (sec()) refreshPage(sec());
  try {
    const r = await API.makeClean(pid, ctl.signal);
    genState.delete(pid);
    // The server clears typed values when it rebuilds a clean copy: field ids are renumbered.
    clearTimeout(typedTimers.get(pid)); typedTimers.delete(pid); typedMap.delete(pid);
    cleanMap.set(pid, { data: r.data, at: r.at });
    viewMode.set(pid, 'clean');
  } catch (e) {
    if (e.code === 'cancelled') genState.delete(pid);
    else genState.set(pid, { error: ERR_TEXT[e.code] || 'The clean copy did not finish (' + (e.code || 'error') + '). Try again.' });
  }
  if (sec()) refreshPage(sec());
}

async function cleanAll() {
  const a = cur(); if (!a) return;
  const pages = a.pages.filter(p => !cleanMap.has(p.id));
  if (!pages.length) return toast('Every page already has a clean copy.');
  for (const p of pages) { if (currentId === a.id) await makeClean(p.id); }
}

/* ---------- crayons ---------- */
// Tap a word cell or a choice to colour it. Saved as a typed value: "3:yellow,7:green" (cell index : crayon).
// A bare index ("2") is a choice picked before crayons existed; it shows in the old blue.
const CRAYONS = { yellow: '#FFE066', orange: '#FFC078', pink: '#FAA2C1', purple: '#D0BFFF', blue: '#74C0FC', green: '#8CE99A' };
let crayon = 'yellow';
try { const c = localStorage.getItem('hw:crayon'); if (c in CRAYONS || c === 'erase') crayon = c; } catch {}
function parsePaint(v) {
  const m = new Map();
  for (const part of String(v ?? '').split(',')) {
    const [k, c] = part.split(':');
    if (/^\d+$/.test(k)) m.set(k, c in CRAYONS ? c : '');
  }
  return m;
}
const paintStr = m => [...m].map(([k, c]) => c ? `${k}:${c}` : k).join(',');
function showPaint(g, m) {
  g.querySelectorAll('[data-k]').forEach(b => {
    const on = m.has(b.dataset.k), c = CRAYONS[m.get(b.dataset.k)];
    b.setAttribute('aria-pressed', on);
    b.classList.toggle('painted', on && !!c);
    if (on && c) b.style.setProperty('--paint', c); else b.style.removeProperty('--paint');
  });
}
function crayonsHTML() {
  return `<div class="crayons" role="radiogroup" aria-label="Crayons">${Object.entries(CRAYONS).map(([name, c]) =>
    `<button type="button" class="crayon" role="radio" data-c="${name}" style="--c:${c}" aria-checked="${crayon === name}" aria-label="${name}"></button>`).join('')}
    <button type="button" class="crayon erase" role="radio" data-c="erase" aria-checked="${crayon === 'erase'}" aria-label="Eraser">${ICON.eraser}</button></div>`;
}
function setCrayon(c) {
  crayon = c;
  try { localStorage.setItem('hw:crayon', c); } catch {}
  document.querySelectorAll('.crayon').forEach(b => b.setAttribute('aria-checked', b.dataset.c === c));
}

function renderWorksheet(d, pid) {
  let n = 0, paints = false;
  const T = s => esc(s ?? '');
  const blank = (b) => {
    const kind = ['number', 'word', 'sentence'].includes(b?.blank) ? b.blank : 'word';
    const id = 'b' + (n++);
    return `<input class="blank ${kind}" data-f="${id}" autocomplete="off" spellcheck="false" ${kind === 'number' ? 'inputmode="numeric" size="3"' : kind === 'word' ? 'size="8"' : ''} aria-label="Answer">`;
  };
  const lbl = it => `<span class="lbl">${T(it.label)}</span>`;
  const item = it => {
    switch (it?.type) {
      case 'line': return `<div class="it">${lbl(it)}<span class="flow">${(it.parts || []).map(p => typeof p === 'string' ? `<span>${T(p)}</span>` : blank(p)).join('')}</span></div>`;
      case 'vertical': {
        const rows = (it.rows || []).map(String); const last = rows.pop() ?? '';
        return `<div class="it it-vert">${lbl(it)}<div class="vert">${rows.map(r => `<div>${T(r)}</div>`).join('')}<div class="row2"><span>${T(it.op)}</span><span>${T(last)}</span></div>${blank({ blank: 'number' })}</div></div>`;
      }
      case 'write': { const id = 'w' + (n++); return `<div class="it">${lbl(it)}<div><p class="prompt">${T(it.prompt)}</p><textarea class="lined" data-f="${id}" rows="${Math.max(2, Math.min(12, +it.lines || 3))}" aria-label="Writing answer"></textarea></div></div>`; }
      case 'choice': { const id = 'c' + (n++); paints = true; return `<div class="it">${lbl(it)}<div><p class="prompt">${T(it.prompt)}</p><div class="opts paint" data-f="${id}"${it.many ? ' data-many="1"' : ''} role="group">${(it.options || []).map((o, k) => `<button type="button" class="opt" data-k="${k}" aria-pressed="false">${T(o)}</button>`).join('')}</div></div></div>`; }
      case 'table': {
        const rows = (Array.isArray(it.rows) ? it.rows : []).filter(Array.isArray);
        if (!rows.length) return '';
        const cols = Math.max(...rows.map(r => r.length)), mark = ['color', 'circle', 'cross'].includes(it.pick) ? it.pick : '';
        const id = 't' + (n++); let k = 0;
        const cell = c => {
          if (typeof c === 'string' || typeof c === 'number') return `<td><button type="button" class="cell" data-k="${k++}" aria-pressed="false">${T(String(c))}</button></td>`;
          if (Array.isArray(c)) return `<td class="mixed"><span class="flow">${c.map(p => typeof p === 'string' ? `<span>${T(p)}</span>` : blank(p)).join('')}</span></td>`;
          if (c?.blank) return `<td class="mixed">${blank(c)}</td>`;
          return '<td></td>';
        };
        const body = rows.map(r => `<tr>${r.map(cell).join('')}${'<td></td>'.repeat(cols - r.length)}</tr>`).join('');
        if (k) paints = true;
        // Any word cell can be coloured; it only counts as a question when the sheet says to colour/circle/cross cells.
        return `<table class="ws-table${k ? ' paint' : ''}"${k ? ` data-f="${id}" data-many="1"${mark ? ` data-mark="${mark}"` : ' data-count="0"'}` : ''}><tbody>${body}</tbody></table>`;
      }
      case 'wordbank': return `<div class="bank" aria-label="Word bank">${(it.words || []).map(w => `<span>${T(w)}</span>`).join('')}</div>`;
      case 'text': return `<p class="para">${T(it.text)}</p>`;
      case 'figure': return `<div class="fig"><span>Picture on the worksheet: ${T(it.description)}</span><button class="btn" type="button" data-show-photo>Show photo</button></div>`;
      default: return it?.text ? `<p class="para">${T(it.text)}</p>` : '';
    }
  };
  const sections = (d.sections || []).map(s => {
    const items = s.items || []; const grid = items.length > 1 && items.every(x => x?.type === 'vertical');
    // Older clean copies often repeat the heading as the instructions; show it once.
    const instr = s.instructions && s.instructions.trim() !== (s.heading || '').trim() ? s.instructions : '';
    paints = false;
    const body = items.map(item).join('');
    // Crayons sit at the top of a section that has something to colour, and stay in view while it's on screen.
    return `<section class="ws-sec">${paints ? crayonsHTML() : ''}${s.heading ? `<h3>${T(s.heading)}</h3>` : ''}${instr ? `<p class="ws-instr">${T(instr)}</p>` : ''}<div class="ws-items${grid ? ' grid' : ''}">${body}</div></section>`;
  }).join('');
  return `<div class="ws">
    ${d.title ? `<h2 class="ws-title">${T(d.title)}</h2>` : ''}
    ${d.instructions ? `<p class="ws-instr">${T(d.instructions)}</p>` : ''}
    ${sections}
  </div>`;
}

function wireWorksheet(box, pid) {
  const sec = box.closest('.page');
  box.querySelectorAll('input[data-f],textarea[data-f]').forEach(el => el.addEventListener('input', () => setTyped(pid, el.dataset.f, el.value, sec)));
  box.querySelectorAll('.paint[data-f]').forEach(g => g.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    const f = g.dataset.f, m = parsePaint((typedMap.get(pid) || {})[f]), k = b.dataset.k;
    if (crayon === 'erase' || (m.has(k) && (m.get(k) || 'yellow') === crayon)) m.delete(k);
    else { if (!g.dataset.many) m.clear(); m.set(k, crayon); }
    setTyped(pid, f, paintStr(m), sec);
    showPaint(g, m);
  }));
  box.querySelectorAll('.crayon').forEach(b => b.onclick = () => setCrayon(b.dataset.c));
  box.querySelectorAll('[data-show-photo]').forEach(b => b.onclick = () => { viewMode.set(pid, 'photo'); refreshPage(sec); });
}

function setTyped(pid, f, v, sec) {
  const vals = typedMap.get(pid) || {}; vals[f] = v; typedMap.set(pid, vals);
  updateProgress(sec);
  clearTimeout(typedTimers.get(pid));
  typedTimers.set(pid, setTimeout(async () => {
    try { await API.saveTyped(pid, typedMap.get(pid) || {}); }
    catch (e) { toast(errText(e, 'Answer not saved')); }
    typedTimers.delete(pid);
  }, 500));
}

/* unchanged from the prototype */
function fillTyped(sec) {
  const vals = typedMap.get(sec.dataset.page) || {};
  sec.querySelectorAll('.clean input[data-f], .clean textarea[data-f]').forEach(el => { if (document.activeElement !== el && el.value !== (vals[el.dataset.f] || '')) el.value = vals[el.dataset.f] || ''; });
  sec.querySelectorAll('.clean .paint[data-f]').forEach(g => showPaint(g, parsePaint(vals[g.dataset.f])));
  updateProgress(sec);
}

function updateProgress(sec) {
  const pr = sec.querySelector('.prog'); if (!pr) return;
  const box = sec.querySelector('.clean');
  if (box.hidden || !cleanMap.has(sec.dataset.page)) { pr.textContent = ''; return; }
  const fields = box.querySelectorAll('[data-f]:not([data-count="0"])'); const vals = typedMap.get(sec.dataset.page) || {};
  const done = [...fields].filter(f => String(vals[f.dataset.f] ?? '').trim()).length;
  pr.textContent = fields.length ? ` · ${done} of ${fields.length} answered` : '';
}

/* ---------- uploads ---------- */
function wireDrop(el) {
  if (!el) return;
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
}
// Windows and Android pickers can hide .heic files under image/*, so name them.
// Not on iPhone/iPad: there image/* alone makes iOS hand over Photos picks as JPEG.
if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)))
  $('#fileIn').accept += ',.heic,.heif,image/heic,image/heif';
$('#fileIn').addEventListener('change', e => {
  const f = [...e.target.files]; e.target.value = '';
  const target = uploadTarget; uploadTarget = null;
  if (f.length) addFiles(f, target);
});
document.addEventListener('paste', e => {
  if (!currentId) return;
  const f = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith('image/') || x.type === 'application/pdf' || HEIC_EXT.test(x.name));
  if (f.length) { e.preventDefault(); addFiles(f); }
});

function setBusy(text, frac) {
  const s = $('#busySlot'); if (!s) return;
  if (text == null) { s.innerHTML = ''; return; }
  s.innerHTML = `<div class="busy"><span>${esc(text)}</span><span class="bar"><i style="width:${Math.round((frac || 0) * 100)}%"></i></span></div>`;
}

let pdfReady = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function loadPdf() {
  if (!pdfReady) pdfReady = (async () => {
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    await loadScript(base + 'pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
    return window.pdfjsLib;
  })().catch(e => { pdfReady = null; throw Object.assign(e instanceof Error ? e : new Error('pdf'), { code: 'pdf_load' }); });
  return pdfReady;
}

function canvasToBlob(c) { return new Promise(r => c.toBlob(r, 'image/jpeg', .86)); }

// iPhone photos are HEIC. Safari opens them itself; Chrome, Firefox and Edge can't,
// so they get a HEIC decoder (libheif), loaded only the first time one is needed.
const HEIC_EXT = /\.(heic|heif)$/i;
async function isHeic(file) {
  if (/^image\/hei[cf]/i.test(file.type) || HEIC_EXT.test(file.name)) return true;
  const brand = new TextDecoder().decode(await file.slice(8, 12).arrayBuffer());
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
}
let heicReady = null;
function loadHeic() {
  if (!heicReady) heicReady = loadScript('https://cdn.jsdelivr.net/npm/heic-to@1.6.5/dist/iife/heic-to.js')
    .then(() => window.HeicTo)
    .catch(e => { heicReady = null; throw Object.assign(new Error('heic_load'), { code: 'heic_load', cause: e }); });
  return heicReady;
}
function loadImageEl(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
    im.src = url;
  });
}
async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  try { return await loadImageEl(file); }
  catch (e) {
    if (!(await isHeic(file))) throw Object.assign(e, { code: 'image_unreadable' });
  }
  const HeicTo = await loadHeic();
  try { return await HeicTo({ blob: file, type: 'bitmap' }); }
  catch (e) { throw Object.assign(new Error('heic'), { code: 'heic_unreadable', cause: e }); }
}
async function imageFileToCanvas(file) {
  const MAX = 2000;
  const bmp = await decodeImage(file);
  const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, MAX / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

// Batches run one after another, so picking more photos mid-upload keeps the page order.
let uploadQueue = Promise.resolve();
function addFiles(files, target) {
  const dest = target || currentId; // a Promise<id> from "New", or the open assignment's id
  const run = uploadQueue.then(() => addFilesNow(files, dest));
  uploadQueue = run.catch(() => {});
  return run;
}

async function addFilesNow(files, dest) {
  const jobs = [];
  for (const f of files) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) jobs.push({ pdf: f });
    else if (f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name)) jobs.push({ img: f });
  }
  if (!jobs.length) return toast('Pick photos or a PDF.');
  let id;
  try { id = await dest; } catch { return; }
  if (!id) return;
  const added = [];
  let failed = 0, lastErr = null;
  // Each photo or PDF page is its own try, so one bad file doesn't stop the rest.
  const fail = (e, n = 1) => { failed += n; lastErr = e; console.warn('upload failed', e); };
  const flat = [];
  for (const j of jobs) {
    if (j.img) { flat.push(j); continue; }
    try {
      setBusy('Opening PDF…', 0);
      const lib = await loadPdf();
      const doc = await lib.getDocument({ data: await j.pdf.arrayBuffer() }).promise;
      for (let n = 1; n <= doc.numPages; n++) flat.push({ pdfDoc: doc, n });
    } catch (e) { fail(e); }
  }
  for (let k = 0; k < flat.length; k++) {
    setBusy(`Adding page ${k + 1} of ${flat.length}…`, k / flat.length);
    const j = flat[k];
    try {
      let c;
      if (j.img) c = await imageFileToCanvas(j.img);
      else {
        const page = await j.pdfDoc.getPage(j.n);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(3, 1700 / vp1.width) });
        c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
      }
      const { width: w, height: h } = c;
      const blob = await canvasToBlob(c);
      c.width = c.height = 0; // free the pixels before the next photo (matters on iPhone)
      added.push(await API.uploadPage(id, blob, w, h));
    } catch (e) { fail(e); }
  }
  setBusy(null);
  const code = lastErr ? ' (' + (lastErr.code || lastErr.message || 'error') + ')' : '';
  const pages = n => n === 1 ? '1 page' : n + ' pages';
  if (!failed) toast(added.length === 1 ? 'Page added' : added.length + ' pages added');
  else if (added.length) toast(`${pages(added.length)} added, ${pages(failed)} did not upload${code}`);
  else toast((failed === 1 ? 'The page did not upload' : 'The pages did not upload') + code);
  if (!added.length) return;
  const a = cur();
  if (a && a.id === id) {
    a.pages.push(...added.map(p => ({ id: p.id, key: p.key, w: p.w, h: p.h })));
    syncListItem(); renderList(); renderPages();
    // Make clean copies straight away, one page at a time.
    (async () => { for (const p of added) if (currentId === id) await makeClean(p.id); })();
  } else refreshList();
}

/* ---------- answer boxes on the photo ---------- */
/* unchanged from the prototype */
function onSheetClick(e) {
  if (e.target.closest('.ans')) return;
  const sheet = e.currentTarget;
  const r = sheet.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
  const fsPx = parseFloat(getComputedStyle(sheet).getPropertyValue('--fs')) * r.width;
  const yAdj = Math.max(0, y - (fsPx * .7) / r.height * 100);
  const pageId = sheet.closest('.page').dataset.page;
  const id = uid();
  localBoxes.add(id);
  answers.set(id, { a: currentId, p: pageId, x: Math.min(x, 92), y: yAdj, w: Math.min(30, 100 - Math.min(x, 92)), t: '', local: true });
  syncBoxes();
  const ta = document.querySelector(`.ans[data-id="${id}"] textarea`); ta?.focus();
}

function boxEl(id) {
  const el = document.createElement('div');
  el.className = 'ans'; el.dataset.id = id;
  el.innerHTML = `<button class="grip" type="button" aria-label="Move answer">${ICON.grip}</button>
    <textarea rows="1" spellcheck="false" autocapitalize="sentences" placeholder="Type…" aria-label="Answer"></textarea>
    <button class="kill" type="button" aria-label="Delete answer">${ICON.x}</button>
    <button class="size" type="button" aria-label="Make wider or narrower">${ICON.width}</button>`;
  const ta = el.querySelector('textarea');
  ta.addEventListener('input', () => { fit(ta); el.classList.toggle('empty', !ta.value); queueSave(id, { t: ta.value }); });
  ta.addEventListener('blur', () => setTimeout(() => {
    if (el.contains(document.activeElement)) return;
    if (!ta.value.trim()) removeBox(id);
  }, 150));
  el.querySelector('.kill').addEventListener('pointerdown', e => e.preventDefault());
  el.querySelector('.kill').onclick = () => removeBox(id);
  dragger(el.querySelector('.grip'), el, id, 'move');
  dragger(el.querySelector('.size'), el, id, 'size');
  return el;
}
function fit(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

function dragger(handle, el, id, mode) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const sheet = el.closest('.sheet'); const r = sheet.getBoundingClientRect();
    const d = answers.get(id); const start = { x: e.clientX, y: e.clientY, bx: d.x, by: d.y, bw: d.w };
    el.classList.add('dragging');
    const move = ev => {
      const dx = (ev.clientX - start.x) / r.width * 100, dy = (ev.clientY - start.y) / r.height * 100;
      if (mode === 'move') { d.x = Math.max(0, Math.min(98 - d.w, start.bx + dx)); d.y = Math.max(0, Math.min(97, start.by + dy)); }
      else d.w = Math.max(6, Math.min(100 - d.x, start.bw + dx));
      place(el, d); fit(el.querySelector('textarea'));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      queueSave(id, { x: d.x, y: d.y, w: d.w }, 0);
      el.querySelector('textarea').focus();
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
}

function place(el, d) { el.style.left = d.x + '%'; el.style.top = d.y + '%'; el.style.width = d.w + '%'; }

function queueSave(id, fields, delay = 450) {
  const d = answers.get(id); if (!d) return;
  Object.assign(d, fields);
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(async () => {
    saveTimers.delete(id);
    if (localBoxes.has(id)) {
      if (!d.t || !d.t.trim()) return;   // don't save empty boxes
      localBoxes.delete(id);
    }
    try { await API.saveAnswer(id, { pageId: d.p, x: d.x, y: d.y, w: d.w, t: d.t || '' }); }
    catch (e) { toast(errText(e, 'Answer not saved')); }
  }, delay));
}

function removeBox(id) {
  clearTimeout(saveTimers.get(id)); saveTimers.delete(id);
  const wasLocal = localBoxes.has(id);
  localBoxes.delete(id); answers.delete(id);
  document.querySelector(`.ans[data-id="${id}"]`)?.remove();
  if (!wasLocal) API.deleteAnswer(id).catch(() => {});
}

function syncBoxes() {
  const sheets = new Map([...document.querySelectorAll('.page')].map(p => [p.dataset.page, p.querySelector('.layer')]));
  const seen = new Set();
  for (const [id, d] of answers) {
    const layer = sheets.get(d.p); if (!layer) continue;
    seen.add(id);
    let el = layer.querySelector(`.ans[data-id="${id}"]`);
    if (!el) { el = boxEl(id); layer.appendChild(el); }
    const ta = el.querySelector('textarea');
    const editing = el.contains(document.activeElement) || el.classList.contains('dragging');
    if (!editing) { place(el, d); if (ta.value !== (d.t || '')) ta.value = d.t || ''; }
    else if (!el.style.left) place(el, d);
    el.classList.toggle('empty', !ta.value);
    requestAnimationFrame(() => fit(ta));
  }
  document.querySelectorAll('.ans').forEach(el => { if (!seen.has(el.dataset.id) && !localBoxes.has(el.dataset.id)) el.remove(); });
}

/* ---------- save page as image ---------- */
async function savePageImage(i) {
  const a = cur(); const p = a?.pages[i]; if (!p) return;
  try {
    await document.fonts.load('700 40px Andika');
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = API.imgUrl(p.key); });
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const fs = SIZES[a.size || 'm'] * W;
    g.fillStyle = '#1F669C'; g.font = `700 ${fs}px Andika, sans-serif`; g.textBaseline = 'top';
    for (const [, d] of answers) {
      if (d.p !== p.id || !d.t) continue;
      const x = d.x / 100 * W + fs * .2 + 1.5, maxW = d.w / 100 * W - fs * .4 - 3;
      let y = d.y / 100 * H + fs * .05 + 1.5;
      for (const para of d.t.split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
          const test = line ? line + ' ' + word : word;
          if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); y += fs * 1.25; line = word; }
          else line = test;
        }
        g.fillText(line, x, y); y += fs * 1.25;
      }
    }
    const blob = await canvasToBlob(c);
    const name = (a.title || 'homework').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + `-page-${i + 1}.jpg`;
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { toast('Could not save the image (' + (e?.code || 'error') + ')'); }
}

boot();
})();
