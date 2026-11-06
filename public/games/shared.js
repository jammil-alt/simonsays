/* Shared code for the typing games: levels and word lists, the finger-colour keyboard helper,
   chiptune sounds, the pixel screen, and the menu → countdown → play → results flow.
   Plain script, no build step. Each game calls Arcade.boot({...}) with its own create(). */
window.Arcade = (() => {
'use strict';
const W = 320, H = 180;                       // logical screen, scaled up to fit
const FONT = '"Press Start 2P", ui-monospace, monospace';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = (a, b) => a + Math.random() * (b - a);
const store = {
  get(k, d) { try { const v = localStorage.getItem('arcade:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('arcade:' + k, JSON.stringify(v)); } catch {} },
};

/* ---------- levels: letters first, then words ---------- */
const TINY_WORDS = ('dad sad add ask lad all fall jam cat dog sun run fun big red hat bat cup pig hen box fox bus bed mom ' +
  'map net pen top van web yes zip kid leg mud nut rug sit ten wet jet egg ant owl car').split(' ');
// Dolch sight words (1st–2nd grade), apostrophes removed.
const SIGHT_WORDS = ('always around because been before best both buy call cold does fast first five found gave goes green ' +
  'made many off pull read right sing sleep tell their these those upon very wash which why wish work would write your ' +
  'about after again could every from going just know like look little only open over play said some them then think ' +
  'want went were what when where with').split(' ');

const LEVELS = [
  { id: 'fj', name: 'BUMPY KEYS', blurb: 'F J D K', kind: 'letters', pool: [...'fjdk'] },
  { id: 'home', name: 'HOME ROW', blurb: 'A S D F J K L', kind: 'letters', pool: [...'asdfjkl'] },
  { id: 'reach', name: 'REACH UP', blurb: 'Home row + E I R U T O', kind: 'letters', pool: [...'asdfjkleiruto'] },
  { id: 'abc', name: 'ALL LETTERS', blurb: 'A to Z', kind: 'letters', pool: [...'abcdefghijklmnopqrstuvwxyz'] },
  { id: 'tiny', name: 'TINY WORDS', blurb: 'cat, dog, sun…', kind: 'words', pool: TINY_WORDS },
  { id: 'sight', name: 'SIGHT WORDS', blurb: 'because, their…', kind: 'words', pool: SIGHT_WORDS },
  { id: 'homework', name: 'MY HOMEWORK', blurb: 'Words from your worksheets', kind: 'words', pool: null },
];

/** Pick a target whose first letter isn't already on screen (so typing it is never ambiguous). */
function pickTarget(pool, avoid, last) {
  const ok = pool.filter(w => !avoid.has(w[0]) && w !== last);
  const from = ok.length ? ok : pool.filter(w => w !== last).length ? pool.filter(w => w !== last) : pool;
  return from[Math.floor(Math.random() * from.length)];
}

/* ---------- keyboard helper: finger colours, next key pulses ---------- */
const ROWS = ['qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'];
const FINGERS = {};
[['qaz', 'left', 'pinky'], ['wsx', 'left', 'ring'], ['edc', 'left', 'middle'], ['rfvtgb', 'left', 'pointer'],
 ['yhnujm', 'right', 'pointer'], ['ik,', 'right', 'middle'], ['ol.', 'right', 'ring'], ['p;/', 'right', 'pinky']]
  .forEach(([keys, hand, finger]) => { for (const k of keys) FINGERS[k] = { hand, finger }; });

class KeyboardHelp {
  constructor(el) {
    this.el = el; this.cur = null;
    el.innerHTML = ROWS.map((r, i) => `<div class="krow" style="padding-left:${i * 20}px">${[...r].map(k =>
      `<span class="key f-${FINGERS[k].finger}${k === 'f' || k === 'j' ? ' bump' : ''}" data-k="${esc(k)}">${esc(k.toUpperCase())}</span>`).join('')}</div>`).join('') +
      `<div class="khint" aria-live="polite"></div>`;
    this.hint = $('.khint', el);
  }
  show(ch) {
    if (ch === this.cur) return;
    this.cur = ch;
    this.el.querySelector('.key.next')?.classList.remove('next');
    this.el.classList.toggle('has-next', !!ch);
    if (!ch) { this.hint.textContent = ''; return; }
    this.el.querySelector(`.key[data-k="${CSS.escape(ch)}"]`)?.classList.add('next');
    const f = FINGERS[ch];
    this.hint.textContent = f ? `${ch.toUpperCase()} = ${f.hand.toUpperCase()} ${f.finger.toUpperCase()}` : '';
  }
  wrong(ch) {
    const k = this.el.querySelector(`.key[data-k="${CSS.escape(ch)}"]`); if (!k) return;
    k.classList.remove('wrong'); void k.offsetWidth; k.classList.add('wrong');
  }
  setVisible(v) { this.el.hidden = !v; }
}

/* ---------- sound: tiny WebAudio chiptune, no files ---------- */
const Sound = (() => {
  let ac = null, master = null, eng = null, muted = store.get('muted', false);
  function ctx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ac = new AC(); master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, dur, { type = 'square', vol = 0.15, to = null, delay = 0 } = {}) {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, { vol = 0.3, lp = 1200, delay = 0 } = {}) {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + delay, buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = buf; f.type = 'lowpass'; f.frequency.setValueAtTime(lp, t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t);
  }
  const seq = (notes, step, opts) => notes.forEach((f, i) => tone(f, step * 1.3, { ...opts, delay: i * step }));
  return {
    unlock: ctx,
    get muted() { return muted; },
    setMuted(m) { muted = m; store.set('muted', m); if (master) master.gain.value = m ? 0 : 0.5; },
    key(n = 0) { tone(520 * Math.pow(1.06, Math.min(n, 12)), 0.06, { vol: 0.1 }); },
    wrong() { tone(110, 0.16, { type: 'sawtooth', vol: 0.12 }); },
    zap() { tone(1500, 0.14, { type: 'sawtooth', vol: 0.08, to: 220 }); },
    pop() { noise(0.25, { vol: 0.25, lp: 2500 }); tone(600, 0.12, { vol: 0.08, to: 1200 }); },
    boom() { noise(0.6, { vol: 0.4, lp: 900 }); tone(90, 0.4, { type: 'triangle', vol: 0.3, to: 35 }); },
    hop() { tone(300, 0.16, { vol: 0.1, to: 760 }); },
    crash() { noise(0.35, { vol: 0.35, lp: 600 }); tone(170, 0.3, { vol: 0.12, to: 60 }); },
    tick() { tone(1000, 0.04, { vol: 0.07 }); },
    count(go) { tone(go ? 880 : 440, go ? 0.4 : 0.14, { vol: 0.14 }); },
    bonus() { seq([660, 880, 1100, 1320], 0.06, { vol: 0.1 }); },
    win() { seq([523, 659, 784, 1047, 784, 1047], 0.11, { vol: 0.12 }); },
    lose() { seq([392, 330, 262, 196], 0.16, { vol: 0.12, type: 'triangle' }); },
    star(i) { tone(784 * Math.pow(1.26, i), 0.22, { vol: 0.13 }); },
    /** Engine hum that follows speed; engine(null) stops it. */
    engine(speed) {
      if (!ac) return;
      if (speed == null) {
        if (eng) { const e = eng; eng = null; e.g.gain.setTargetAtTime(0, ac.currentTime, 0.05); setTimeout(() => { try { e.o.stop(); } catch {} }, 300); }
        return;
      }
      if (!eng) {
        const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 320; g.gain.value = 0;
        o.connect(f).connect(g).connect(master); o.start(); eng = { o, g };
        g.gain.setTargetAtTime(0.05, ac.currentTime, 0.1);
      }
      eng.o.frequency.setTargetAtTime(40 + speed * 0.9, ac.currentTime, 0.1);
    },
  };
})();

/* ---------- drawing helpers ---------- */
/** Build a sprite from rows of palette characters ('.' = transparent). */
function sprite(rows, pal) {
  const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
  return c;
}

function text(g, s, x, y, { size = 8, color = '#fff', align = 'left', base = 'top', outline = null } = {}) {
  g.font = `${size}px ${FONT}`; g.textAlign = align; g.textBaseline = base;
  if (outline) { g.lineWidth = size / 3; g.lineJoin = 'round'; g.strokeStyle = outline; g.strokeText(s, x, y); }
  g.fillStyle = color; g.fillText(s, x, y);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** A word bubble centred on x with its top at y. Typed letters turn green, the next one is red and underlined. */
function bubble(g, word, typed, x, y, { size = 8, active = false, upper = false } = {}) {
  const shown = upper ? word.toUpperCase() : word, pad = Math.max(3, size / 3);
  const bw = shown.length * size + pad * 2, bh = size + pad * 2, x0 = Math.round(x - bw / 2);
  roundRect(g, x0, y, bw, bh, 3);
  g.fillStyle = active ? '#fff6bf' : '#ffffff'; g.fill();
  g.lineWidth = active ? 2 : 1; g.strokeStyle = active ? '#ff9d00' : '#1b1b2f'; g.stroke();
  for (let i = 0; i < shown.length; i++) {
    const color = i < typed ? '#1f9d3a' : (i === typed && active) ? '#e2341c' : '#1b1b2f';
    text(g, shown[i], x0 + pad + i * size, y + pad + 0.5, { size, color });
    if (i === typed && active) { g.fillStyle = '#e2341c'; g.fillRect(x0 + pad + i * size, y + pad + size + 1, size - 1, 1.5); }
  }
  return { x: x0, w: bw, h: bh };
}

/* ---------- screen: chunky 1x world canvas scaled up, crisp text drawn on top ---------- */
function makeScreen(canvas) {
  const world = document.createElement('canvas'); world.width = W; world.height = H;
  const w = world.getContext('2d');
  const ctx = canvas.getContext('2d');
  let k = 1;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(W, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.round(canvas.width * H / W);
    k = canvas.width / W;
  };
  new ResizeObserver(resize).observe(canvas); resize();
  return {
    w, world, ctx,
    present(sx, sy) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(world, sx * k, sy * k, canvas.width, canvas.height);
      ctx.setTransform(k, 0, 0, k, sx * k, sy * k);
      return ctx;
    },
  };
}

/* ---------- the game shell ---------- */
/**
 * def: { id, title, tagline, stars(kind) -> [1★, 2★, 3★] hits needed, fmt(score), create(env) -> game }
 * game: { start(level, pool), update(dt), idle(dt), drawWorld(w), drawUI(g), key(ch) -> 'ok'|'wrong'|'ignore',
 *         cancel?(), nextKey() -> char|null, result() -> null | {won, title, score, hits, lines[]} }
 */
function boot(def) {
  const canvas = $('#screen'), overlay = $('#overlay');
  const scr = makeScreen(canvas);
  const kb = new KeyboardHelp($('#kbd'));
  let showHelp = store.get('help', true);
  let state = 'loading', level = null, pool = null, focusIdx = 0;
  let last = 0, shake = 0, countT = 0, goT = 0, lastCount = null, overAt = 0, keysOk = 0, keysBad = 0;
  let scores = {}, homework = [];

  const env = { W, H, text, bubble, sprite, rand, Sound, roundRect, shake: a => { shake = Math.max(shake, a); },
    pick: (avoid, prev) => pickTarget(pool, avoid, prev) };
  const game = def.create(env);

  // header buttons
  const helpBtn = $('#helpBtn'), muteBtn = $('#muteBtn');
  const syncButtons = () => {
    helpBtn.setAttribute('aria-pressed', showHelp); helpBtn.textContent = showHelp ? 'KEYS: ON' : 'KEYS: OFF';
    muteBtn.setAttribute('aria-pressed', !Sound.muted); muteBtn.textContent = Sound.muted ? 'SOUND: OFF' : 'SOUND: ON';
    kb.setVisible(showHelp);
  };
  helpBtn.onclick = () => { showHelp = !showHelp; store.set('help', showHelp); syncButtons(); helpBtn.blur(); };
  muteBtn.onclick = () => { Sound.setMuted(!Sound.muted); syncButtons(); muteBtn.blur(); };
  syncButtons();

  const myScores = () => scores[def.id] || {};
  const stars = n => '<span class="stars">' + [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}">★</i>`).join('') + '</span>';

  function showMenu() {
    state = 'menu'; Sound.engine(null); kb.show(null);
    const sc = myScores();
    // Suggest the first level without two stars yet.
    let suggest = LEVELS.findIndex(l => (sc[l.id]?.stars || 0) < 2 && !(l.id === 'homework' && homework.length < 4));
    if (suggest < 0) suggest = 0;
    overlay.innerHTML = `<div class="panel menu">
      <h2 class="ptitle">${esc(def.title)}</h2>
      <p class="tag">${esc(def.tagline)}</p>
      <div class="levels">${LEVELS.map((l, i) => {
        const s = sc[l.id], off = l.id === 'homework' && homework.length < 4;
        return `<button class="lvl${i === suggest ? ' suggest' : ''}" type="button" data-i="${i}" ${off ? 'disabled' : ''}>
          <span class="lvl-n">${i + 1}</span>
          <span class="lvl-name">${esc(l.name)}<small>${esc(off ? 'Make a clean copy of a worksheet first' : l.blurb)}</small></span>
          <span class="lvl-score">${stars(s?.stars || 0)}<small>${s ? 'BEST ' + esc(def.fmt(s.best)) : ''}</small></span>
        </button>`;
      }).join('')}</div>
      <p class="hint">↑ ↓ PICK · ENTER PLAY</p>
    </div>`;
    overlay.hidden = false;
    overlay.querySelectorAll('.lvl').forEach(b => b.onclick = () => start(LEVELS[+b.dataset.i]));
    focusIdx = suggest;
    overlay.querySelectorAll('.lvl')[suggest]?.focus({ preventScroll: true });
  }

  function start(l) {
    level = l;
    pool = l.pool || homework;
    Sound.unlock();
    document.activeElement?.blur?.();
    overlay.hidden = true; overlay.innerHTML = '';
    keysOk = keysBad = 0;
    game.start(l, pool);
    state = 'count'; countT = 3; lastCount = null; goT = 0;
  }

  function pause() {
    if (state !== 'play') return;
    state = 'paused'; Sound.engine(null);
    overlay.innerHTML = `<div class="panel small"><h2 class="ptitle">PAUSED</h2>
      <div class="row"><button class="pbtn big" type="button" data-a="go">KEEP GOING</button><button class="pbtn" type="button" data-a="menu">LEVELS</button></div>
      <p class="hint">ESC TO KEEP GOING</p></div>`;
    overlay.hidden = false;
    overlay.querySelector('[data-a=go]').onclick = resume;
    overlay.querySelector('[data-a=menu]').onclick = showMenu;
  }
  function resume() { overlay.hidden = true; state = 'play'; }

  function end(r) {
    state = 'over'; overAt = performance.now(); Sound.engine(null); kb.show(null);
    const th = def.stars(level.kind);
    const n = th.filter(t => r.hits >= t).length;
    const acc = keysOk + keysBad ? keysOk / (keysOk + keysBad) : 1;
    (r.won ? Sound.win : Sound.lose)();
    for (let i = 0; i < n; i++) setTimeout(() => Sound.star(i), 700 + i * 300);
    const next = n < 3 ? `${th[n] - r.hits} MORE FOR ${'★'.repeat(n + 1)}` : 'PERFECT!';
    overlay.innerHTML = `<div class="panel over">
      <h2 class="ptitle ${r.won ? 'good' : 'bad'}">${esc(r.title)}</h2>
      <div class="bigstars">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}" style="animation-delay:${0.7 + i * 0.3}s">★</i>`).join('')}</div>
      <p class="next">${esc(next)}</p>
      <ul class="lines">${r.lines.map(x => `<li>${esc(x)}</li>`).join('')}<li>ACCURACY ${Math.round(acc * 100)}%</li></ul>
      <p class="newbest" hidden>NEW BEST!</p>
      <div class="row"><button class="pbtn big" type="button" data-a="again">PLAY AGAIN</button><button class="pbtn" type="button" data-a="menu">LEVELS</button></div>
      <p class="hint">ENTER AGAIN · ESC LEVELS</p>
    </div>`;
    overlay.hidden = false;
    overlay.querySelector('[data-a=again]').onclick = () => start(level);
    overlay.querySelector('[data-a=menu]').onclick = showMenu;
    const round = { game: def.id, level: level.id, score: r.score, hits: r.hits, stars: n, accuracy: acc };
    const mine = (scores[def.id] ??= {});
    const prev = mine[level.id];
    mine[level.id] = { best: Math.max(prev?.best || 0, r.score), stars: Math.max(prev?.stars || 0, n), plays: (prev?.plays || 0) + 1 };
    window.API?.saveGameScore(round).then(res => {
      if (res.isBest && state === 'over') overlay.querySelector('.newbest')?.removeAttribute('hidden');
    }).catch(() => {});
  }

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (state === 'play') {
      if (k === 'Escape') { e.preventDefault(); return pause(); }
      if (k === 'Backspace') { e.preventDefault(); game.cancel?.(); return; }
      if (k.length !== 1) return;
      e.preventDefault();
      if (e.repeat) return;
      const ch = k.toLowerCase();
      if (!/^[a-z]$/.test(ch)) return;
      const r = game.key(ch);
      if (r === 'ok') keysOk++;
      else if (r === 'wrong') { keysBad++; Sound.wrong(); kb.wrong(ch); }
      return;
    }
    if (state === 'count') { if (k.length === 1) e.preventDefault(); if (k === 'Escape') showMenu(); return; }
    if (state === 'paused') { if (k === 'Escape' || k === 'Enter' || k === ' ') { e.preventDefault(); resume(); } return; }
    if (state === 'over') {
      if (k.length === 1 || k === 'Enter') e.preventDefault();
      if (performance.now() - overAt < 900) return;    // don't skip the results with leftover keystrokes
      if (k === 'Enter' || k === ' ') start(level);
      else if (k === 'Escape') showMenu();
      return;
    }
    if (state === 'menu') {
      const btns = [...overlay.querySelectorAll('.lvl:not([disabled])')];
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const at = Math.max(0, btns.indexOf(document.activeElement));
        btns[(at + (k === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus();
      } else if (k === 'Escape') location.href = '/games/';
      else if ((k === 'Enter' || k === ' ') && !btns.includes(document.activeElement)) {
        e.preventDefault(); (btns.find(b => b.classList.contains('suggest')) || btns[0])?.click();
      }
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  function frame(t) {
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0); last = t;
    if (state === 'play') {
      game.update(dt);
      goT = Math.max(0, goT - dt);
      const r = game.result();
      if (r) end(r);
    } else if (state === 'count') {
      countT -= dt;
      const n = Math.ceil(countT);
      if (n !== lastCount) { lastCount = n; Sound.count(n <= 0); }
      if (countT <= 0) { state = 'play'; goT = 0.7; }
    } else if (state === 'menu' || state === 'over' || state === 'loading') game.idle(dt);
    kb.show(state === 'play' || state === 'count' ? game.nextKey() : null);

    shake = Math.max(0, shake - dt * 25);
    const sx = shake ? Math.round(rand(-shake, shake)) : 0, sy = shake ? Math.round(rand(-shake, shake)) : 0;
    game.drawWorld(scr.w);
    const g = scr.present(sx, sy);
    game.drawUI(g);
    if (state === 'count') text(g, String(Math.max(1, Math.ceil(countT))), W / 2, H / 2, { size: 32, color: '#ffcf3f', align: 'center', base: 'middle', outline: '#1b1b2f' });
    if (goT > 0) text(g, 'GO!', W / 2, H / 2, { size: 32, color: '#5cff8a', align: 'center', base: 'middle', outline: '#1b1b2f' });
    requestAnimationFrame(frame);
  }

  Promise.allSettled([
    document.fonts?.load(`8px ${FONT}`),
    window.API?.gameScores().then(s => { scores = s || {}; }),
    window.API?.gameWords().then(r => { homework = r?.words || []; }),
  ]).then(showMenu);
  requestAnimationFrame(frame);
}

return { boot, LEVELS, store, Sound, W, H };
})();
