/* Comic Maker. Simon types a story; the Worker asks Claude for a comic script, then this page asks
   the Worker to draw each character sheet and panel (3 at a time) and lays the words over the pictures,
   so his words are always spelled exactly right. No points, streaks or timers: just a calm "The End". */
(() => {
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const DRAFT = 'comic:draft';
const cache = new Map();          // comic id -> comic payload
const drawing = new Map();        // comic id -> running draw job
const failed = new Map();         // `${id}:${slot}` -> message
let lib = null;                   // { comics, today: {used, limit}, art }
let current = null;               // the comic on screen

const ERR = {
  daily_limit: "That's all the comics for today. Come back tomorrow for more!",
  too_short: 'Tell me a little more of the story!',
  too_long: 'That story is too long for one comic. Try a shorter one.',
  not_configured: "The comic writer isn't set up yet: the server has no working Anthropic API key.",
  rate_limited: 'Lots of comics at once! Wait a minute and try again.',
  overloaded: 'The artists are busy. Wait a minute and try again.',
  timeout: 'That took too long. Try again.',
  script_failed: "The story didn't turn into a comic this time. Try again.",
  script_refused: "That story didn't work as a comic. Try changing it a little.",
  art_blocked: "The artist couldn't draw this one.",
  art_failed: "This picture didn't work.",
  signed_out: 'You were signed out. Reload the page to sign in again.',
  offline: "Can't reach the server. Check the Wi-Fi and try again.",
  not_found: 'That comic was deleted.',
};
const errText = (e, what) => ERR[e?.code] || `${what} (${e?.code || 'error'})`;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3500);
}
function draft(v) {
  try { if (v === undefined) return localStorage.getItem(DRAFT) || ''; if (v) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT); } catch { return ''; }
}
function setTab(name) { document.querySelectorAll('.tabs a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === name)); }
const render = html => { app.innerHTML = html; window.scrollTo(0, 0); };

async function loadLib() {
  try { lib = await API.listComics(); } catch (e) { if (!lib) lib = { comics: [], today: { used: 0, limit: 3 }, art: false }; if (e.code === 'signed_out') toast(errText(e)); }
  return lib;
}

/* ---------- routing ---------- */
function route() {
  stopReading();
  const h = location.hash;
  if (h.startsWith('#/c/')) showComic(decodeURIComponent(h.slice(4)));
  else if (h === '#/library') showLibrary();
  else showWrite();
}
window.addEventListener('hashchange', route);

/* ---------- write ---------- */
function showWrite(error) {
  setTab('write'); current = null;
  render(`<section class="card write">
    <h1 class="logo">Comic Maker</h1>
    <p class="lead">Type your story. I'll turn it into a comic!</p>
    <div class="helpers" role="group" aria-label="Story helpers">
      <button type="button" data-add="My hero is ">Who's your hero?</button>
      <button type="button" data-add="Then something goes wrong: ">What goes wrong?</button>
      <button type="button" data-add="In the end, ">How does it end?</button>
    </div>
    <textarea id="story" aria-label="Your story" maxlength="2000" placeholder="Once upon a time…" autocapitalize="sentences"></textarea>
    <div class="write-foot"><span class="today" id="today"></span><button class="btn big" id="make" type="button">Make my comic!</button></div>
    <p class="err" id="err" ${error ? '' : 'hidden'}>${esc(error || '')}</p>
    <div id="limitSlot"></div>
  </section>
  <p class="libnote"><a href="#/library">See my comics</a></p>`);
  const ta = $('#story');
  ta.value = draft();
  ta.addEventListener('input', () => draft(ta.value));
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    const v = ta.value.replace(/\s+$/, '');
    ta.value = (v ? v + (/[.!?]$/.test(v) ? ' ' : '. ') : '') + b.dataset.add;
    draft(ta.value); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  $('#make').onclick = makeComic;
  ta.focus();
  loadLib().then(updateToday);
}

function updateToday() {
  if (!lib || !$('#today')) return;
  const { used, limit } = lib.today;
  const left = Math.max(0, limit - used);
  $('#today').textContent = limit ? `Comics today: ${used} of ${limit}` : '';
  if (!left) {
    $('#make').disabled = true;
    $('#limitSlot').innerHTML = `<p class="done-for-today">That's all the comics for today. Your comics are waiting in <a href="#/library">My comics</a>. Come back tomorrow for more!</p>`;
  }
}

async function makeComic() {
  const story = $('#story').value.trim();
  if (story.length < 15) { $('#err').hidden = false; $('#err').textContent = ERR.too_short; return; }
  render(`<section class="card making" aria-live="polite">
    <h2>Making your comic…</h2>
    <div class="scribble" aria-hidden="true"></div>
    <p>Writing the story…</p>
    <p class="hint">This takes about a minute.</p>
  </section>`);
  let c;
  try { c = await API.createComic(story); }
  catch (e) { await loadLib(); return showWrite(errText(e, 'The comic did not start')); }
  draft('');
  cache.set(c.id, c);
  if (lib) lib.today.used++;
  location.hash = '#/c/' + c.id;
}

/* ---------- comic ---------- */
async function showComic(id) {
  setTab(null);
  let c = cache.get(id);
  if (!c) {
    render(`<section class="card making"><h2>Opening…</h2></section>`);
    try { c = await API.getComic(id); cache.set(id, c); }
    catch (e) { render(`<section class="card empty"><p class="lead">${esc(errText(e, 'Could not open the comic'))}</p><a class="btn" href="#/library">My comics</a></section>`); return; }
  }
  if (location.hash !== '#/c/' + id) return;
  current = c;
  renderComic(c);
  if (c.art) finishDrawing(c);
}

function bubblesHTML(p) {
  const ds = [...p.dialogue].sort((a, b) => (a.side === 'left' ? 0 : 1) - (b.side === 'left' ? 0 : 1));
  if (!ds.length) return '';
  return `<div class="bubbles">${ds.map(d => `<div class="bubble ${d.side === 'right' ? 'right' : 'left'}" title="${esc(d.speaker)}">${esc(d.text)}</div>`).join('')}</div>`;
}

function artHTML(c, i) {
  const p = c.script.panels[i], slot = 'panel-' + i, key = c.images[slot];
  if (key) return `<div class="art"><img src="/img/${esc(key)}" alt="${esc(p.scene)}">${bubblesHTML(p)}</div>`;
  if (!c.art) return `<div class="art text-only">${bubblesHTML(p)}<p class="scene">${esc(p.scene)}</p></div>`;
  const err = failed.get(c.id + ':' + slot);
  if (err) return `<div class="art"><div class="note">Oops!<small>${esc(err)}</small><button class="btn quiet" type="button" data-retry="${i}">Try again</button></div></div>`;
  return `<div class="art waiting"><div class="note">Drawing…</div></div>`;
}

function renderComic(c) {
  const s = c.script, n = s.panels.length;
  const made = new Date(c.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const left = lib ? Math.max(0, lib.today.limit - lib.today.used) : 1;
  render(`<article class="comic">
    <div class="comic-head">
      <div><h1 class="ctitle">${esc(s.title)}</h1><p class="byline">By Simon · ${esc(made)}</p></div>
      <button class="btn" type="button" id="readBtn">Read it to me</button>
    </div>
    <p class="status" id="status" hidden></p>
    <div class="panels">
      ${s.panels.map((p, i) => `<figure class="panel" data-i="${i}">
        ${p.caption ? `<figcaption class="cap">${esc(p.caption)}</figcaption>` : ''}
        <div class="art-slot">${artHTML(c, i)}</div>
      </figure>`).join('')}
      <figure class="panel theend${(n + 1) % 2 ? ' wide' : ''}" data-i="end"><span>The End</span></figure>
    </div>
    <div class="comic-actions">
      <a class="btn" href="#/library">My comics</a>
      ${left ? '<a class="btn" href="#/">Write another story</a>' : ''}
    </div>
    <details class="parents">
      <summary>For grown-ups: Simon's original story</summary>
      <blockquote>${esc(c.story)}</blockquote>
      ${c.changes?.length ? `<h3>What Claude changed</h3><ul>${c.changes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<h3>Nothing was changed for the content rules.</h3>'}
      ${c.storyWords?.length ? `<h3>Flagged words in the story</h3><p>${esc(c.storyWords.join(', '))}</p>` : ''}
      <div class="row"><button class="btn quiet" type="button" id="redoArt" ${c.art ? '' : 'hidden'}>Redraw all pictures</button><button class="btn quiet" type="button" id="delBtn">Delete this comic</button></div>
    </details>
  </article>`);
  $('#readBtn').onclick = () => (reading ? stopReading() : readAloud());
  app.querySelectorAll('.panel[data-i]').forEach(f => f.addEventListener('click', e => {
    if (e.target.closest('button') || f.dataset.i === 'end') return;
    readAloud(+f.dataset.i);
  }));
  wireRetry(c);
  $('#delBtn').onclick = () => deleteComic(c);
  $('#redoArt').onclick = () => redrawAll(c);
}

function wireRetry(c) {
  app.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => {
    const i = +b.dataset.retry; failed.delete(c.id + ':panel-' + i); updatePanel(c, i);
    finishDrawing(c);
  });
}

function updatePanel(c, i) {
  if (current !== c) return;
  const slot = app.querySelector(`.panel[data-i="${i}"] .art-slot`);
  if (slot) { slot.innerHTML = artHTML(c, i); wireRetry(c); }
}
function setStatus(c, text) {
  if (current !== c) return;
  const s = $('#status'); if (!s) return;
  s.hidden = !text; s.textContent = text || '';
}

async function pool(items, size, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(size, q.length) }, async () => { while (q.length) await fn(q.shift()); }));
}

/** Draw whatever is missing: character sheets first (so panels can match them), then panels. Resumable. */
function finishDrawing(c, redo = false) {
  if (drawing.has(c.id)) return drawing.get(c.id);
  const s = c.script, n = s.panels.length;
  const job = (async () => {
    const chars = s.characters.map((_, i) => 'char-' + i).filter(k => redo || !c.images[k]);
    const panels = s.panels.map((_, i) => i).filter(i => (redo || !c.images['panel-' + i]) && !failed.has(c.id + ':panel-' + i));
    if (!panels.length) return;
    let artOff = false;
    const draw = async slot => {
      try { const r = await API.drawComic(c.id, slot, redo); c.images[slot] = r.key; }
      catch (e) { if (e.code === 'art_off') artOff = true; throw e; }
    };
    if (chars.length) {
      setStatus(c, chars.length === 1 ? 'Drawing the hero…' : 'Drawing the characters…');
      await pool(chars, 3, k => draw(k).catch(() => {}));   // panels still work without a sheet
    }
    if (artOff) { c.art = false; if (current === c) renderComic(c); return; }
    let done = n - panels.length;
    const progress = () => setStatus(c, `Drawing panel ${Math.min(done + 1, n)} of ${n}…`);
    progress();
    await pool(panels, 3, async i => {
      try { await draw('panel-' + i); }
      catch (e) { failed.set(c.id + ':panel-' + i, errText(e, "This picture didn't work") + (e.code === 'art_off' ? '' : ' Tap Try again.')); }
      done++; updatePanel(c, i); progress();
    });
    if (artOff) { c.art = false; if (current === c) renderComic(c); return; }
    const bad = s.panels.some((_, i) => failed.has(c.id + ':panel-' + i));
    setStatus(c, bad ? 'Some pictures did not work. Tap Try again on them.' : null);
  })().finally(() => drawing.delete(c.id));
  drawing.set(c.id, job);
  return job;
}

async function redrawAll(c) {
  if (drawing.has(c.id)) return toast('Still drawing. Wait a moment.');
  for (let i = 0; i < c.script.panels.length; i++) failed.delete(c.id + ':panel-' + i);
  finishDrawing(c, true).then(() => cache.set(c.id, c));
  toast('Redrawing the pictures…');
}

async function deleteComic(c) {
  if (!confirm(`Delete "${c.script.title}"? This can't be undone.`)) return;
  try { await API.deleteComic(c.id); } catch (e) { if (e.code !== 'not_found') return toast(errText(e, 'Could not delete')); }
  cache.delete(c.id);
  if (lib) lib.comics = lib.comics.filter(x => x.id !== c.id);
  location.hash = '#/library';
}

/* ---------- read aloud ----------
   Real voices: the Worker's voice director gives every character a voice and every line a direction,
   and Gemini performs each line once (kept with the comic, so re-reading is instant and free).
   If voices aren't available, it falls back to the browser's own (robotic) voice. */
let reading = null;               // the read-aloud in progress: { stopped, source }
let audioCtx = null;

function setReadBtn(text) { const b = $('#readBtn'); if (b) b.textContent = text; }
function highlight(i) {
  app.querySelectorAll('.panel.reading').forEach(p => p.classList.remove('reading'));
  const el = i == null || i === 'title' ? null : app.querySelector(`.panel[data-i="${i}"]`);
  if (el) { el.classList.add('reading'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}
function stopReading() {
  if (reading) { reading.stopped = true; try { reading.source?.stop(); } catch {} reading = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  highlight(null); setReadBtn('Read it to me');
}
/** Must run inside the tap itself: iPads only allow sound that starts from a tap. */
function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const b = audioCtx.createBuffer(1, 1, 22050), src = audioCtx.createBufferSource();   // silent blip to wake it up
  src.buffer = b; src.connect(audioCtx.destination); src.start(0);
  return audioCtx;
}
function playBuffer(ac, buf, run) {
  return new Promise(res => {
    const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
    src.onended = () => res(); run.source = src; src.start(0);
  });
}
function browserSay(text) {
  return new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    const u = new SpeechSynthesisUtterance(text); u.rate = 0.92; u.pitch = 1.05;
    u.onend = u.onerror = () => res(); speechSynthesis.speak(u);
  });
}
function scriptLinesForBrowser(c) {
  const out = [{ panel: 'title', who: 'Narrator', text: c.script.title }];
  c.script.panels.forEach((p, i) => {
    if (p.caption) out.push({ panel: i, who: 'Narrator', text: p.caption });
    for (const d of p.dialogue) out.push({ panel: i, who: d.speaker, text: `${d.speaker} says: ${d.text}` });
  });
  out.push({ panel: 'end', who: 'Narrator', text: 'The End.' });
  return out;
}

async function readAloud(only) {
  const c = current; if (!c) return;
  stopReading();
  const run = { stopped: false, source: null }; reading = run;
  const ac = unlockAudio();
  setReadBtn('Stop reading');
  const wanted = l => only == null || l.panel === only;

  let plan = null;
  if (ac && c.voice !== false) {
    if (!c.voice) setReadBtn('Warming up the voices…');
    try { plan = c.voice || (c.voice = await API.comicVoice(c.id)); }
    catch (e) { if (e.code === 'voice_off') c.voice = false; plan = null; }
    if (run.stopped) return;
    setReadBtn('Stop reading');
  }
  if (!plan) {                                   // fallback: the browser's own voice
    for (const l of scriptLinesForBrowser(c).filter(wanted)) {
      if (run.stopped) return;
      highlight(l.panel); await browserSay(l.text);
    }
    if (!run.stopped) stopReading();
    return;
  }

  const lines = plan.lines.filter(wanted);
  const clips = new Map();
  const fails = new Set();                       // why lines fell back to the browser voice, shown afterwards
  const clip = l => {                            // record (once) and decode one line
    if (!clips.has(l.k)) clips.set(l.k, (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          if (!l.key) l.key = (await API.comicVoiceLine(c.id, l.k)).key;
          const r = await fetch('/img/' + l.key);
          if (!r.ok) throw Object.assign(new Error('clip'), { code: 'clip_' + r.status });
          return await ac.decodeAudioData(await r.arrayBuffer());
        } catch (e) {
          // Busy or rate-limited: wait a moment and try once more before using the backup voice.
          if (attempt < 1 && !run.stopped && ['rate_limited', 'overloaded', 'timeout', 'offline'].includes(e.code)) {
            await new Promise(r => setTimeout(r, 3000)); continue;
          }
          throw e;
        }
      }
    })());
    return clips.get(l.k);
  };
  for (let n = 0; n < lines.length; n++) {
    if (run.stopped) return;
    lines.slice(n, n + 3).forEach(l => clip(l).catch(() => {}));   // stay two lines ahead (gentle on rate limits)
    const l = lines[n];
    let buf = null;
    try { buf = await clip(l); } catch (e) { buf = null; fails.add(e?.code || e?.name || 'error'); }
    if (run.stopped) return;
    highlight(l.panel);
    if (buf) await playBuffer(ac, buf, run);
    else await browserSay(l.who === 'Narrator' ? l.text : `${l.who} says: ${l.text}`);   // one line failed: don't stop the story
    await new Promise(r => setTimeout(r, l.panel !== lines[n + 1]?.panel ? 350 : 120)); // a breath between panels
  }
  if (run.stopped) return;
  stopReading();
  if (fails.size) toast(`Some lines used the backup voice (${[...fails].join(', ')}). Tap "Read it to me" again to retry them.`);
}

/* ---------- library ---------- */
async function showLibrary() {
  setTab('library'); current = null;
  render(`<section class="card making"><h2>Opening your comics…</h2></section>`);
  await loadLib();
  if (location.hash !== '#/library') return;
  const comics = lib.comics;
  const left = Math.max(0, lib.today.limit - lib.today.used);
  render(`<div class="libhead"><h1 class="logo small">My Comics</h1>${left ? '<a class="btn big" href="#/">New comic</a>' : ''}</div>
    ${comics.length ? `<div class="shelf">${comics.map(c => {
      const date = new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const unfinished = lib.art && c.drawn < c.panels;
      return `<a class="book" href="#/c/${esc(c.id)}">
        <span class="cover" ${c.cover ? `style="background-image:url('/img/${esc(c.cover)}')"` : ''}>${c.cover ? '' : esc(c.title)}</span>
        <b>${esc(c.title)}</b><small>${esc(date)} · ${c.panels} panels${unfinished ? ' · still drawing' : ''}</small></a>`;
    }).join('')}</div>`
    : `<div class="card empty"><p class="lead">No comics yet. Type a story and make your first one!</p><a class="btn big" href="#/">Write a story</a></div>`}`);
}

route();
})();
