/* LETTER LANE — race the clock down a country road. Something blocks the road (ducks, cones,
   a railroad gate, a big puddle) with a letter or word on its sign. Type it to get past.
   Miss and the car spins out (cartoon bonk, nobody gets hurt) and loses time. */
Arcade.boot({
  id: 'letter-lane',
  title: 'LETTER LANE',
  tagline: 'Type the sign to get past! Beat the clock!',
  stars: kind => kind === 'letters' ? [8, 16, 26] : [4, 8, 13],
  fmt: s => s + 'm',
  create(A) {
    const { W, H, text, bubble, sprite, rand, Sound } = A;
    const ROAD_L = 104, ROAD_R = 216, MID = 160;
    const CAR_Y = 140;                 // car centre
    const SPAWN_Y = 34, HIT_Y = 124;   // obstacle centre line: appears / reaches the car's nose
    const TRAVEL = HIT_Y - SPAWN_Y;
    const ROUND = 60;
    // Seconds for an obstacle to reach the car: base + perLetter × length, shrinking as he gets better.
    const TUNE = {
      fj: [1.8, 3.0], home: [1.5, 2.7], reach: [1.4, 2.4], abc: [1.3, 2.2],
      tiny: [2.0, 1.7], sight: [2.0, 1.45], homework: [2.2, 1.55],
    };

    const pal = { k: '#1b1b2f', r: '#e43b44', R: '#a3202a', y: '#fff3a0', b: '#6fd0ff', w: '#ffffff', o: '#ff8a00',
      Y: '#ffd93d', O: '#ff9a3c', g: '#2f8f3a', G: '#56c14f', n: '#7a4a24', s: '#c8c8d0', p: '#ff7eb6', B: '#3b6fd8' };
    const CAR = sprite([
      '...kkkkkk...', '..kyrrrryk..', '.krrrrrrrrk.', 'kkrrrrrrrrkk', 'kkrbbbbbbrkk', '.krbbbbbbrk.',
      '.krRbbbbRrk.', '.krrwwwwrrk.', '.krrwwwwrrk.', '.krrwwwwrrk.', '.krrrrrrrrk.', '.krRbbbbRrk.',
      'kkrbbbbbbrkk', 'kkrrrrrrrrkk', '.krrrrrrrrk.', '.kooRRRRook.', '..kkkkkkkk..',
    ], pal);
    const DUCK = sprite(['..YY....', '.YYkY...', '..YYOO..', '.YYYY...', 'YYYYYY..', 'YYYYYYY.', '.YYYYY..', '..O.O...'], pal);
    const DUCKLING = sprite(['.YY..', 'YkYO.', '.YY..', 'YYYY.', '.O.O.'], pal);
    const CONE = sprite(['..oo..', '..oo..', '.owwo.', '.oooo.', 'owwwwo', 'oooooo', 'kkkkkk'], pal);
    const TREE = sprite([
      '...gggg...', '.ggGGGgg..', 'gGGGGGGgg.', 'gGGgGGGGg.', 'ggGGGGgGgg', 'gGGGGGGGg.', '.ggGgGGgg.',
      '..ggggg...', '....nn....', '....nn....',
    ], pal);
    const FLOWER = sprite(['.p.', 'pyp', '.p.', '.G.'], pal);

    let level, T = 0, timeLeft = ROUND, dist = 0, speed = 30, targetSpeed = 30, roadY = 0;
    let obs = [], scenery = [], floats = [], lastWord = '', lastKind = '';
    let clears = 0, misses = 0, streak = 0, bestStreak = 0, spin = 0, hop = 0, lastTick = 0;

    function resetScenery() {
      scenery = [];
      for (let y = -20; y < H + 20; y += 14) addScenery(y);
    }
    function addScenery(y) {
      for (const side of [0, 1]) {
        if (Math.random() < 0.55) scenery.push({ y: y + rand(-4, 4), x: side ? rand(226, 300) : rand(8, 84), spr: Math.random() < 0.7 ? TREE : FLOWER });
      }
    }

    const ramp = () => Math.max(0.55, 1 - clears * 0.016);
    const reachTime = len => { const [b, p] = TUNE[level.id] || [1.6, 2]; return (b + p * len) * ramp(); };
    const target = () => obs.filter(o => !o.cleared).sort((a, b) => b.y - a.y)[0] || null;

    function spawn() {
      const avoid = new Set(obs.filter(o => !o.cleared).map(o => o.word[0]));
      const word = A.pick(avoid, lastWord); lastWord = word;
      const kinds = ['ducks', 'cones', 'gate', 'puddle'].filter(k => k !== lastKind);
      const kind = kinds[Math.floor(Math.random() * kinds.length)]; lastKind = kind;
      const parts = kind === 'ducks'
        ? [{ x: 128, big: true }, { x: 146 }, { x: 158 }, { x: 170 }].map(p => ({ ...p, dx: 0, dy: 0 }))
        : kind === 'cones' ? [110, 128, 146, 164, 182, 200].map(x => ({ x, dx: 0, dy: 0 })) : [];
      obs.push({ kind, word, typed: 0, y: SPAWN_Y, cleared: false, crashed: false, t: 0, parts, hopped: false });
      targetSpeed = TRAVEL / reachTime(word.length);
    }

    function float(msg, x, y, color = '#ffffff', size = 8) { floats.push({ msg, x, y, color, size, t: 0 }); }

    function clear(o) {
      o.cleared = true; o.t = 0; clears++; streak++; bestStreak = Math.max(bestStreak, streak);
      for (const p of o.parts) { p.dx = (p.x < MID ? -1 : 1) * rand(50, 90); p.dy = rand(-30, -10); }
      if (o.kind !== 'puddle') hop = 0.4;
      Sound.hop();
      const cheers = ['NICE!', 'GREAT!', 'ZOOM!', 'YES!', 'COOL!'];
      float(cheers[clears % cheers.length], MID, o.y - 6, '#5cff8a');
      if (streak % 5 === 0) { timeLeft += 3; float('+3 SEC!', MID, 70, '#ffcf3f', 12); Sound.bonus(); }
    }

    function crash(o) {
      o.cleared = true; o.crashed = true; o.t = 0; misses++; streak = 0; spin = 0.9;
      for (const p of o.parts) { p.dx = (p.x < MID ? -1 : 1) * rand(70, 110); p.dy = rand(-20, 0); }
      A.shake(4); Sound.crash();
      float('BONK!', MID, CAR_Y - 30, '#ff5f5f', 12);
    }

    function drive(dt, auto) {
      roadY = (roadY + speed * dt) % 16;
      for (const s of scenery) s.y += speed * dt;
      scenery = scenery.filter(s => s.y < H + 16);
      const topY = Math.min(...scenery.map(s => s.y), H);
      if (topY > -6) addScenery(topY - 14);
      if (auto) speed += (30 - speed) * Math.min(1, dt * 2);
    }

    // ---------- drawing ----------
    function drawRoad(w) {
      // grass bands and candy-stripe curbs scroll together, like an old arcade racer
      for (let y = -16; y < H + 16; y += 8) {
        const band = Math.floor((y - roadY) / 8) & 1;
        const yy = y + (roadY % 8);
        w.fillStyle = band ? '#4fae4a' : '#47a243'; w.fillRect(0, yy, W, 8);
        w.fillStyle = band ? '#e43b44' : '#ffffff'; w.fillRect(ROAD_L - 6, yy, 6, 8); w.fillRect(ROAD_R, yy, 6, 8);
      }
      w.fillStyle = '#5b5d6b'; w.fillRect(ROAD_L, 0, ROAD_R - ROAD_L, H);
      w.fillStyle = '#e9e9f0';
      for (let y = -16; y < H; y += 16) {
        const yy = y + roadY;
        w.fillRect(141, yy, 2, 8); w.fillRect(178, yy, 2, 8);
      }
      for (const s of scenery) w.drawImage(s.spr, Math.round(s.x), Math.round(s.y));
    }

    function drawObstacle(w, o) {
      const y = Math.round(o.y);
      if (o.kind === 'puddle') {
        for (let r = 0; r < 10; r++) {
          const half = Math.round(56 * Math.sqrt(1 - Math.pow((r - 4.5) / 5.2, 2)));
          w.fillStyle = r < 2 ? '#8fd3ff' : '#3b8fd8'; w.fillRect(MID - half, y - 5 + r, half * 2, 1);
        }
        w.fillStyle = '#ffffff'; w.fillRect(MID - 30, y - 2, 6, 1); w.fillRect(MID + 18, y + 1, 4, 1);
        return;
      }
      if (o.kind === 'gate') {
        const lift = o.cleared ? Math.min(1, o.t / 0.35) : 0;
        w.fillStyle = '#2b2b3a'; w.fillRect(ROAD_L - 10, y - 8, 4, 14);
        const blink = Math.floor(T * 4) & 1;
        w.fillStyle = blink ? '#ff3b3b' : '#5a1010'; w.fillRect(ROAD_L - 12, y - 10, 3, 3);
        w.fillStyle = blink ? '#5a1010' : '#ff3b3b'; w.fillRect(ROAD_L - 7, y - 10, 3, 3);
        w.save(); w.translate(ROAD_L - 8, y); w.rotate(-lift * 1.45);
        for (let i = 0; i < 14; i++) { w.fillStyle = i & 1 ? '#ffffff' : '#e43b44'; w.fillRect(i * 8, -2, 8, 4); }
        w.restore();
        return;
      }
      const spr = o.kind === 'cones' ? CONE : null;
      for (const p of o.parts) {
        const px = Math.round(p.x + p.dx * o.t), py = Math.round(y + p.dy * o.t + (o.cleared ? 60 * o.t * o.t : 0));
        if (o.kind === 'ducks') {
          const bob = Math.floor(T * 6 + p.x) & 1;
          w.drawImage(p.big ? DUCK : DUCKLING, px - (p.big ? 4 : 2), py - (p.big ? 4 : 2) - bob);
        } else w.drawImage(spr, px - 3, py - 4);
      }
    }

    function drawCar(w) {
      const lift = hop > 0 ? Math.sin((1 - hop / 0.4) * Math.PI) * 7 : 0;
      const cx = MID + Math.round(Math.sin(T * 1.7) * 2), cy = CAR_Y;
      w.fillStyle = 'rgba(0,0,0,.28)'; w.fillRect(cx - 6, cy - 6, 12, 15);
      if (streak >= 3 && spin <= 0) {          // nitro flames
        const f = Math.floor(T * 20) & 1;
        w.fillStyle = f ? '#ffd93d' : '#ff8a00'; w.fillRect(cx - 4, cy + 9 - lift, 2, 3 + f); w.fillRect(cx + 2, cy + 9 - lift, 2, 4 - f);
      }
      w.save(); w.translate(cx, Math.round(cy - lift));
      if (spin > 0) w.rotate((0.9 - spin) * Math.PI * 4);
      w.drawImage(CAR, -6, -8);
      w.restore();
    }

    return {
      start(l) {
        level = l; T = 0; timeLeft = ROUND; dist = 0; speed = 0; obs = []; floats = [];
        clears = misses = streak = bestStreak = 0; spin = hop = 0; lastWord = lastKind = ''; lastTick = 0;
        resetScenery(); spawn();
      },
      idle(dt) { T += dt; drive(dt, true); },
      update(dt) {
        T += dt; timeLeft -= dt;
        if (spin > 0) { spin -= dt; speed = 0; } else speed += (targetSpeed - speed) * Math.min(1, dt * 3);
        hop = Math.max(0, hop - dt);
        drive(dt, false);
        dist += speed * dt / 4;
        for (const o of obs) {
          o.y += speed * dt;
          if (o.cleared) o.t += dt;
          else if (o.y >= HIT_Y) crash(o);
          if (o.kind === 'puddle' && o.cleared && !o.crashed && !o.hopped && o.y >= HIT_Y - 6) { o.hopped = true; hop = 0.4; }
        }
        obs = obs.filter(o => o.y < H + 30);
        const live = obs.filter(o => !o.cleared), newest = obs[obs.length - 1];
        const maxLive = level.kind === 'letters' ? 2 : 1;
        const gap = level.kind === 'letters' ? 84 : 70;
        if (live.length < maxLive && (!newest || newest.y > gap)) spawn();
        else if (live.length) targetSpeed = TRAVEL / reachTime(live[0].word.length);
        for (const f of floats) { f.t += dt; f.y -= dt * 18; }
        floats = floats.filter(f => f.t < 1);
        const sec = Math.ceil(timeLeft);
        if (sec <= 10 && sec !== lastTick && sec > 0) { lastTick = sec; Sound.tick(); }
        Sound.engine(speed);
      },
      drawWorld(w) {
        drawRoad(w);
        for (const o of obs) drawObstacle(w, o);
        drawCar(w);
      },
      drawUI(g) {
        const tg = target();
        for (const o of obs) {
          if (o.cleared) continue;
          const letters = level.kind === 'letters';
          bubble(g, o.word, o.typed, MID, o.y - (letters ? 30 : 22), { size: letters ? 16 : 10, active: o === tg, upper: letters });
        }
        for (const f of floats) text(g, f.msg, f.x, f.y, { size: f.size, color: f.color, align: 'center', outline: '#1b1b2f' });
        // side panels: clock on the left, distance on the right
        const low = timeLeft <= 10, flash = low && (Math.floor(T * 4) & 1);
        g.fillStyle = 'rgba(20,20,40,.72)'; g.fillRect(6, 6, 84, 40); g.fillRect(230, 6, 84, 40);
        text(g, 'TIME', 48, 10, { size: 8, color: '#9aa3d6', align: 'center' });
        text(g, String(Math.max(0, Math.ceil(timeLeft))), 48, 22, { size: 16, color: flash ? '#ff5f5f' : low ? '#ffcf3f' : '#ffffff', align: 'center' });
        text(g, 'DIST', 272, 10, { size: 8, color: '#9aa3d6', align: 'center' });
        text(g, Math.round(dist) + 'm', 272, 24, { size: 10, color: '#ffffff', align: 'center' });
        if (streak >= 2) {
          g.fillStyle = 'rgba(20,20,40,.72)'; g.fillRect(230, 52, 84, 20);
          text(g, `STREAK ${streak}`, 272, 58, { size: 8, color: streak >= 5 ? '#ffcf3f' : '#5cff8a', align: 'center' });
        }
      },
      key(ch) {
        const o = target(); if (!o) return 'ignore';
        if (ch === o.word[o.typed]) {
          o.typed++;
          if (o.typed === o.word.length) clear(o); else Sound.key(o.typed);
          return 'ok';
        }
        streak = 0;
        return 'wrong';
      },
      nextKey() { const o = target(); return o ? o.word[o.typed] : null; },
      result() {
        if (timeLeft > 0) return null;
        const m = Math.round(dist);
        return { won: true, title: "TIME'S UP!", score: m, hits: clears,
          lines: [`DISTANCE ${m}m`, `GOT PAST ${clears}`, `BEST STREAK ${bestStreak}`] };
      },
    };
  },
});
