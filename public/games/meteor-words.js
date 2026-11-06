/* METEOR WORDS — meteors fall on a little pixel town. Type the letter or word on a meteor to zap it
   with the laser. Survive 4 waves (30 seconds each) to save the city; 3 hits and it's game over. */
Arcade.boot({
  id: 'meteor-words',
  title: 'METEOR WORDS',
  tagline: 'Zap the meteors! Save the city!',
  stars: kind => kind === 'letters' ? [10, 22, 36] : [5, 11, 18],
  fmt: s => s + ' PTS',
  create(A) {
    const { W, H, text, bubble, sprite, rand, Sound } = A;
    const GROUND = 152, CANNON = { x: 160, y: 164 }, WAVES = 4, WAVE_LEN = 30;
    // fall: seconds from top to ground (+ per letter for words); every: seconds between meteors; max: on screen at once
    const TUNE = {
      fj: { fall: 11, every: 2.8, max: 3 }, home: { fall: 10, every: 2.5, max: 4 },
      reach: { fall: 9.5, every: 2.3, max: 4 }, abc: { fall: 9, every: 2.1, max: 5 },
      tiny: { fall: 6, per: 1.6, every: 4.2, max: 3 }, sight: { fall: 6, per: 1.5, every: 4.6, max: 3 },
      homework: { fall: 6.5, per: 1.6, every: 4.8, max: 3 },
    };
    const pal = { k: '#1b1b2f', a: '#8a6a4f', b: '#b08968', c: '#5e4632', d: '#d4b28c', r: '#ff4d6d', R: '#ffb3c1', s: '#c7cbe8', S: '#7f86b8', y: '#ffe066' };
    const ROCK = sprite(['...kkkk...', '..kbbdbk..', '.kbddbbak.', 'kbbbacbbak', 'kbdbbbbcak', 'kbbcabbbak', 'kabbbbdbak', '.kabbcbak.', '..kaaaak..', '...kkkk...'], pal);
    const HEART = sprite(['.rr.rr.', 'rRrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], pal);
    const HEART_OFF = sprite(['.kk.kk.', 'kSkkkSk', 'kSSSSSk', '.kSSSk.', '..kSk..', '...k...'], pal);
    const CANNON_SPR = sprite(['...ss...', '..sSSs..', '.sSSSSs.', 'sSSyySSs', 'sSSSSSSs', 'kkkkkkkk'], pal);

    const stars = Array.from({ length: 46 }, () => ({ x: rand(0, W), y: rand(0, GROUND - 20), p: rand(0, 6), big: Math.random() < 0.15 }));
    let buildings = [];
    function makeCity() {
      buildings = [];
      let x = 0;
      while (x < W) {
        const w = Math.round(rand(16, 30)), h = Math.round(rand(16, 34));
        if (Math.abs(x + w / 2 - CANNON.x) < 18) { x += 10; continue; }
        const lit = Array.from({ length: 40 }, () => Math.random() < 0.45);
        buildings.push({ x, w, h, color: ['#2e3470', '#3a3f86', '#28306a'][buildings.length % 3], lit, hit: 0 });
        x += w + Math.round(rand(1, 4));
      }
    }
    makeCity();

    let level, tune, T = 0, meteors = [], parts = [], beams = [], floats = [], lock = null;
    let hearts = 3, wave = 1, waveT = 0, spawnT = 0, score = 0, zaps = 0, combo = 0, banner = null, lastWord = '', won = false, demoT = 0;

    const fallTime = word => (tune.fall + (tune.per || 0) * word.length) * Math.pow(0.9, wave - 1);
    const lowest = list => list.sort((a, b) => b.y - a.y)[0] || null;

    function spawn() {
      const avoid = new Set(meteors.map(m => m.word[0]));
      const word = A.pick(avoid, lastWord); lastWord = word;
      const half = (level.kind === 'letters' ? 14 : word.length * 5 + 6);
      let x = rand(half + 4, W - half - 4);
      for (let i = 0; i < 8 && meteors.some(m => m.y < 50 && Math.abs(m.x - x) < 44); i++) x = rand(half + 4, W - half - 4);
      // Appear (with a flash) just low enough that the label is fully on screen right away.
      const y0 = level.kind === 'letters' ? 32 : 24;
      const t = fallTime(word), tx = Math.min(W - half, Math.max(half, x + rand(-50, 50)));
      meteors.push({ word, typed: 0, x, y: y0, vx: (tx - x) / t, vy: (GROUND + 6 - y0) / t });
      burst(x, y0, 8, ['#ffffff', '#3fe0ff'], 40);
    }

    function burst(x, y, n, colors, speed = 60) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), v = rand(speed * 0.3, speed);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(0.4, 0.9), c: colors[i % colors.length] });
      }
    }
    function float(msg, x, y, color = '#fff', size = 8) { floats.push({ msg, x, y, color, size, t: 0 }); }
    function beam(m) { beams.push({ x: m.x, y: m.y, t: 0 }); Sound.zap(); }

    function destroy(m) {
      meteors = meteors.filter(x => x !== m);
      if (lock === m) lock = null;
      zaps++; combo++;
      const pts = Math.round(10 * m.word.length * (1 + Math.min(combo - 1, 9) * 0.2));
      score += pts;
      burst(m.x, m.y, 18, ['#ffe066', '#ff9a3c', '#ff4d6d', '#ffffff'], 70);
      Sound.pop();
      float('+' + pts, m.x, m.y - 10, '#ffe066');
      if (combo >= 3 && combo % 3 === 0) float(`COMBO x${combo}`, W / 2, 60, '#5cff8a', 12);
    }

    function groundHit(m) {
      meteors = meteors.filter(x => x !== m);
      if (lock === m) lock = null;
      hearts--; combo = 0;
      burst(m.x, GROUND, 26, ['#ff9a3c', '#ff4d6d', '#ffe066', '#8a6a4f'], 80);
      const b = buildings.find(b => m.x >= b.x - 4 && m.x <= b.x + b.w + 4); if (b) b.hit = 1;
      A.shake(6); Sound.boom();
      float(hearts > 0 ? 'OUCH!' : 'OH NO!', m.x, GROUND - 24, '#ff5f5f', 12);
    }

    function stepEffects(dt) {
      for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; }
      parts = parts.filter(p => p.t < p.life);
      for (const b of beams) b.t += dt;
      beams = beams.filter(b => b.t < 0.12);
      for (const f of floats) { f.t += dt; f.y -= dt * 16; }
      floats = floats.filter(f => f.t < 1);
      if (banner) { banner.t += dt; if (banner.t > 1.8) banner = null; }
      for (const b of buildings) b.hit = Math.max(0, b.hit - dt * 0.3);
    }

    function drawSky(w) {
      const bands = [['#0a0c26', 0], ['#10153a', 50], ['#171f52', 95], ['#20296a', 130]];
      bands.forEach(([c, y], i) => { w.fillStyle = c; w.fillRect(0, y, W, (bands[i + 1]?.[1] ?? H) - y); });
      // dithered edges between bands, very 90s
      w.fillStyle = '#10153a'; for (let x = 0; x < W; x += 2) w.fillRect(x + ((x / 2) & 1), 49, 1, 1);
      w.fillStyle = '#171f52'; for (let x = 0; x < W; x += 2) w.fillRect(x + ((x / 2) & 1), 94, 1, 1);
      for (const s of stars) {
        const on = Math.sin(T * 2 + s.p) > -0.3;
        w.fillStyle = on ? '#ffffff' : '#6b74b8'; w.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
        if (s.big && on) { w.fillRect(Math.round(s.x) - 1, Math.round(s.y), 3, 1); w.fillRect(Math.round(s.x), Math.round(s.y) - 1, 1, 3); }
      }
      w.fillStyle = '#fff4c7'; w.beginPath(); w.arc(282, 30, 11, 0, Math.PI * 2); w.fill();
      w.fillStyle = '#e8d9a0'; w.fillRect(277, 26, 3, 3); w.fillRect(285, 33, 4, 3);
    }

    function drawCity(w) {
      for (const b of buildings) {
        const top = GROUND + 18 - b.h;
        w.fillStyle = b.color; w.fillRect(b.x, top, b.w, H - top);
        let i = 0;
        for (let y = top + 3; y < GROUND + 14; y += 5) for (let x = b.x + 3; x < b.x + b.w - 3; x += 5) {
          const on = b.lit[i++ % b.lit.length] && !(b.hit > 0.5 && (x + y) % 3 === 0);
          w.fillStyle = on ? '#ffe28a' : '#151a40'; w.fillRect(x, y, 2, 2);
        }
        if (b.hit > 0) { w.fillStyle = `rgba(255,120,60,${b.hit * 0.5})`; w.fillRect(b.x, top, b.w, H - top); }
      }
      w.fillStyle = '#12142e'; w.fillRect(0, GROUND + 18, W, H);
      w.fillStyle = '#2b2f5e'; w.fillRect(0, GROUND + 18, W, 1);
      w.drawImage(CANNON_SPR, CANNON.x - 4, CANNON.y - 3);
    }

    function drawMeteor(w, m) {
      // flame trail
      for (let i = 1; i <= 6; i++) {
        const tx = Math.round(m.x - m.vx * i * 0.05), ty = Math.round(m.y - m.vy * i * 0.05);
        w.fillStyle = i < 3 ? '#ffe066' : i < 5 ? '#ff9a3c' : '#ff4d6d';
        const s = Math.max(1, 5 - Math.floor(i * 0.7));
        w.fillRect(tx - (s >> 1) + ((Math.floor(T * 30) + i) & 1), ty - (s >> 1), s, s);
      }
      w.drawImage(ROCK, Math.round(m.x) - 5, Math.round(m.y) - 5);
    }

    return {
      start(l) {
        level = l; tune = TUNE[l.id] || TUNE.abc;
        T = 0; meteors = []; parts = []; beams = []; floats = []; lock = null;
        hearts = 3; wave = 1; waveT = 0; spawnT = 0.5; score = zaps = combo = 0; won = false; lastWord = '';
        banner = { msg: 'WAVE 1', t: 0 };
        makeCity();
      },
      idle(dt) {
        T += dt; stepEffects(dt);
        demoT -= dt;
        if (demoT <= 0) { demoT = rand(1.2, 2.5); burst(rand(20, 300), rand(20, 80), 1, ['#ffffff'], 140); }
      },
      update(dt) {
        T += dt; waveT += dt;
        if (waveT >= WAVE_LEN) {
          waveT = 0; wave++;
          if (wave > WAVES) { won = true; return; }
          banner = { msg: wave === WAVES ? 'LAST WAVE!' : `WAVE ${wave}`, t: 0 };
          Sound.bonus();
        }
        spawnT -= dt;
        if (!meteors.length) spawnT = Math.min(spawnT, 0.4);
        if (spawnT <= 0 && meteors.length < tune.max + (wave >= 3 ? 1 : 0)) {
          spawn(); spawnT = tune.every * Math.pow(0.86, wave - 1) * rand(0.8, 1.2);
        }
        for (const m of [...meteors]) {
          m.x += m.vx * dt; m.y += m.vy * dt;
          if (m.y >= GROUND + 6) groundHit(m);
        }
        stepEffects(dt);
      },
      drawWorld(w) {
        drawSky(w);
        for (const p of parts) { w.fillStyle = p.c; w.fillRect(Math.round(p.x), Math.round(p.y), 2, 2); }
        for (const m of meteors) drawMeteor(w, m);
        drawCity(w);
        for (const b of beams) {
          w.strokeStyle = b.t < 0.06 ? '#ffffff' : '#3fe0ff'; w.lineWidth = 2;
          w.beginPath(); w.moveTo(CANNON.x, CANNON.y - 3); w.lineTo(b.x, b.y); w.stroke();
        }
        for (let i = 0; i < 3; i++) w.drawImage(i < hearts ? HEART : HEART_OFF, 6 + i * 9, 6);
      },
      drawUI(g) {
        const letters = level?.kind === 'letters';
        for (const m of meteors) {
          bubble(g, m.word, m.typed, m.x, m.y - (letters ? 30 : 22), { size: letters ? 16 : 10, active: m === lock, upper: letters });
        }
        for (const f of floats) text(g, f.msg, f.x, f.y, { size: f.size, color: f.color, align: 'center', outline: '#0a0c26' });
        if (!level) return;
        text(g, `WAVE ${Math.min(wave, WAVES)}/${WAVES}`, W / 2, 5, { size: 8, color: '#9aa3d6', align: 'center' });
        g.fillStyle = '#2b2f5e'; g.fillRect(W / 2 - 30, 15, 60, 3);
        g.fillStyle = '#3fe0ff'; g.fillRect(W / 2 - 30, 15, 60 * Math.min(1, waveT / WAVE_LEN), 3);
        text(g, String(score), W - 6, 5, { size: 8, color: '#ffe066', align: 'right' });
        if (banner) text(g, banner.msg, W / 2, 70, { size: 16, color: '#ffcf3f', align: 'center', outline: '#0a0c26' });
      },
      key(ch) {
        if (lock) {
          if (ch !== lock.word[lock.typed]) { combo = 0; return 'wrong'; }
          lock.typed++; beam(lock);
          if (lock.typed === lock.word.length) destroy(lock); else Sound.key(lock.typed);
          return 'ok';
        }
        const m = lowest(meteors.filter(x => x.word[0] === ch));
        if (!m) { combo = 0; return 'wrong'; }
        m.typed = 1; beam(m);
        if (m.word.length === 1) destroy(m); else { lock = m; Sound.key(1); }
        return 'ok';
      },
      cancel() { if (lock) { lock.typed = 0; lock = null; } },
      nextKey() {
        if (lock) return lock.word[lock.typed];
        const m = lowest([...meteors]);
        return m ? m.word[0] : null;
      },
      result() {
        if (won) return { won: true, title: 'CITY SAVED!', score, hits: zaps, lines: [`SCORE ${score}`, `ZAPPED ${zaps}`, `HEARTS LEFT ${hearts}`] };
        if (hearts <= 0) return { won: false, title: 'GAME OVER', score, hits: zaps, lines: [`SCORE ${score}`, `ZAPPED ${zaps}`, `MADE IT TO WAVE ${wave}`] };
        return null;
      },
    };
  },
});
