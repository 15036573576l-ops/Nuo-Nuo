// 糯糯战记 · 界面：开局、出兵栏、HUD、镜头输入、小地图、简介浮窗、结束统计、主循环
// 界面只调用引擎的 canSpawn / spawn 和读取状态，不直接改任何数值。
(function () {
  const R = window.RULES;
  const U = window.UNITS;
  const ALL = U.concat(window.SPECIAL_UNITS || []);   // 出兵栏 = 普通兵种 + 只有玩家能用的特殊单位
  const SR = window.SpriteRender;
  const SH = window.HD_SHEETS;
  const Engine = window.Engine;
  const AI = window.AI;
  const LEVELS = window.AI_LEVELS;
  const Render = window.Render;

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'X'];
  const TIER_COLOR = { T3: '#9aa4b8', T2: '#6fd3ff', T1: '#b58cff', 'T0.5': '#ffb36b', T0: '#ffd166' };
  const DMG = { slash: '斩击', pierce: '穿刺', magic: '魔法', siege: '攻城' };
  const ARMOR = { none: '无甲', light: '轻甲', heavy: '重甲' };
  const ELEM = { fire: '火', frost: '冰', poison: '毒', shadow: '暗', holy: '圣' };
  const REASON = {
    gold: '金币不够', supply: '人口已满', cooldown: '冷却中', max: '场上数量已达上限', ended: '对局已结束', no: '没有这个兵种',
  };

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const state = {
    eng: null,
    level: 'normal',
    speed: 1,
    paused: false,
    running: false,
    endAt: 0,
    lastT: 0,
    cards: new Map(),
    renderer: null,
    tipUid: null,
    toastT: 0,
    drag: null,
  };

  // ---------- 出兵栏 ----------
  function buildRoster() {
    const roster = $('roster');
    roster.innerHTML = '';
    ALL.forEach((d, i) => {
      const card = el('div', d.playerOnly ? 'card evil' : 'card');
      card.dataset.uid = d.id;
      card.style.setProperty('--tier', TIER_COLOR[d.tier] || '#888');
      card.appendChild(el('span', 'key', KEYS[i]));
      const av = el('canvas', 'av');
      av.width = 48;
      av.height = 48;
      card.appendChild(av);
      card.appendChild(el('div', 'nm', d.name));
      const cost = el('div', 'cost');
      cost.innerHTML = `<b>${d.cost}</b> · 人口${d.supply}`;
      card.appendChild(cost);
      const cd = el('div', 'cd');
      card.appendChild(cd);
      roster.appendChild(card);
      state.cards.set(d.id, { card, av, cd, cost, def: d, drawn: false });

      card.addEventListener('pointerdown', (e) => onCardDown(e, d.id));
      card.addEventListener('pointerup', (e) => onCardUp(e, d.id));
      card.addEventListener('pointercancel', hideTip);
      card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
      card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(d.id, card); });
    });
  }

  let pressTimer = 0;
  let pressFired = false;
  function onCardDown(e, uid) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressFired = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressFired = true;
      showTip(uid, state.cards.get(uid).card);
    }, 420);
  }
  function onCardUp(e, uid) {
    clearTimeout(pressTimer);
    if (pressFired) {
      if (e.pointerType !== 'mouse') hideTip();
      pressFired = false;
      return;
    }
    spawn(uid);
  }

  // 出兵：成功闪绿，失败提示原因并闪红
  function spawn(uid) {
    const eng = state.eng;
    const c = state.cards.get(uid);
    if (!eng || !c) return;
    if (state.paused || !state.running) return;
    const why = eng.canSpawn(0, uid);
    if (why === 'ok') {
      eng.spawn(0, uid);
      flash(c.card, 'flash');
    } else {
      flash(c.card, 'bad');
      toast(REASON[why] || '现在不能出兵');
    }
  }
  function flash(card, cls) {
    card.classList.remove('flash', 'bad');
    void card.offsetWidth;
    card.classList.add(cls);
    setTimeout(() => card.classList.remove(cls), 220);
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(state.toastT);
    state.toastT = setTimeout(() => t.classList.remove('show'), 900);
  }

  // ---------- 简介浮窗 ----------
  function tipHtml(d) {
    const skill = d.skill
      ? `<div class="sk">主动·${d.skill.name}（冷却 ${d.skill.cd} 秒，自动释放）</div><div>${d.skill.desc}</div><div class="muted">释放条件：${d.skill.when}</div>`
      : d.manualSkills
        ? d.manualSkills.map((m) => `<div class="sk">手动·${m.name}（${m.key} 键，冷却 ${m.cd} 秒）</div><div>${m.desc}</div>`).join('')
        : '<div class="meta">没有主动技能</div>';
    const traits = d.traits.length
      ? `<ul>${d.traits.map((t) => `<li><b>${t.name}</b>：${t.desc}</li>`).join('')}</ul>`
      : '';
    const elem = d.element ? ELEM[d.element] : '无';
    return `
      <h3>${d.name} <small>${d.title} · ${d.tier}</small></h3>
      <div class="meta">${d.role} · 💰${d.cost} · 人口${d.supply} · 冷却${d.cooldown} 秒${d.count > 1 ? ` · 一次 ${d.count} 只` : ''}</div>
      <div class="meta">${DMG[d.dmg]} → ${ARMOR[d.armor]} · 元素：${elem} · 射程 ${d.range} · 移速 ${d.speed} · 生命 ${d.hp}</div>
      ${traits}
      ${skill}
      <div class="meta">克制：${d.strongVs.join('、')}</div>
      <div class="meta">怕：${d.weakVs.join('、')}</div>
      <p class="lore">${d.lore}</p>`;
  }
  function showTip(uid, card) {
    const d = ALL.find((x) => x.id === uid);
    const tip = $('tip');
    tip.innerHTML = tipHtml(d);
    tip.style.display = 'block';
    state.tipUid = uid;
    const stage = $('stage').getBoundingClientRect();
    const r = card.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - stage.left - tw / 2;
    left = Math.max(6, Math.min(stage.width - tw - 6, left));
    let top = r.top - stage.top - th - 10;
    if (top < 6) top = 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function hideTip() {
    $('tip').style.display = 'none';
    state.tipUid = null;
  }

  // 出兵栏图标：取 idle 第一帧，按脚底锚点裁出身体
  function drawAvatars() {
    for (const c of state.cards.values()) {
      const d = c.def;
      const sh = SH[d.sheet];
      const im = sh && SR.img(sh.anims.idle.src);
      if (!im || !im.complete || !im.naturalWidth) continue;
      const g = c.av.getContext('2d');
      g.clearRect(0, 0, 48, 48);
      g.imageSmoothingEnabled = false;
      const sw = Math.min(sh.fw, Math.max(20, sh.bodyW * 2.1));
      const shh = Math.min(sh.fh, Math.max(20, sh.bodyH * 1.9));
      const sx = Math.max(0, Math.min(sh.fw - sw, sh.cx - sw / 2));
      const sy = Math.max(0, Math.min(sh.fh - shh, sh.foot - shh + 4));
      const k = Math.min(44 / sw, 44 / shh);
      const dw = sw * k, dh = shh * k;
      g.drawImage(im, sx, sy, sw, shh, (48 - dw) / 2, (48 - dh) - 2, dw, dh);
      c.drawn = true;
    }
  }

  function updateRoster() {
    const eng = state.eng;
    const S = eng ? eng.sides[0] : null;
    for (const c of state.cards.values()) {
      const d = c.def;
      const left = S ? S.cdLeft[d.id] || 0 : 0;
      c.cd.style.height = `${Math.round((left / d.cooldown) * 100)}%`;
      const ok = eng ? eng.canSpawn(0, d.id) === 'ok' : false;
      if (c.ok !== ok) {
        c.ok = ok;
        c.card.classList.toggle('no', !ok);
      }
    }
  }

  // ---------- HUD ----------
  let hudCache = {};
  function setText(id, v) {
    if (hudCache[id] === v) return;
    hudCache[id] = v;
    $(id).textContent = v;
  }
  function updateHud() {
    const eng = state.eng;
    if (!eng) return;
    const S = eng.sides[0];
    setText('gold', String(Math.floor(S.gold)));
    const mimics = eng.count(0, 'mimic');
    setText('income', `+${Math.round((R.economy.income + 3 * mimics) * eng.cheats.incomeMul[0])}/秒`);
    setText('pop', eng.cheats.noSupply ? `人口 ${S.supplyUsed}/∞` : `人口 ${S.supplyUsed}/${R.economy.supplyCap}`);
    setText('clock', fmtTime(eng.time));
    for (let s = 0; s < 2; s++) {
      const c = eng.crystals[s];
      const id = s === 0 ? 'hp-me' : 'hp-foe';
      const pct = Math.max(0, (c.hp / c.maxHp) * 100);
      $(id).style.width = `${pct}%`;
      setText(`${id}-n`, String(Math.max(0, Math.ceil(c.hp))));
    }
    $('btn-speed').textContent = `${state.speed}×`;
  }

  // ---------- 镜头输入 ----------
  function bindCamera() {
    const cv = $('cv');
    cv.addEventListener('pointerdown', (e) => {
      state.drag = { x: e.clientX, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!state.drag) return;
      const dx = e.clientX - state.drag.x;
      if (Math.abs(dx) > 0) {
        state.drag.moved = true;
        state.renderer.panPixels(-dx);
        state.drag.x = e.clientX;
      }
    });
    const end = () => { state.drag = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      if (!state.renderer) return;
      e.preventDefault();
      state.renderer.panPixels(e.deltaX || e.deltaY);
    }, { passive: false });

    const mm = $('minimap');
    const mmMove = (e) => {
      const r = mm.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
      state.renderer.cam.x = Render.LANE * (x / r.width);
      state.renderer.cam.manual = true;
      state.renderer.cam.manualT = state.renderer.time;
      state.renderer.clampCam();
    };
    let mmDown = false;
    mm.addEventListener('pointerdown', (e) => { mmDown = true; mm.setPointerCapture(e.pointerId); mmMove(e); });
    mm.addEventListener('pointermove', (e) => { if (mmDown) mmMove(e); });
    mm.addEventListener('pointerup', () => { mmDown = false; });
    mm.addEventListener('pointercancel', () => { mmDown = false; });
  }

  // ---------- 键盘 ----------
  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (!state.running) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
      if (e.key === 'z' || e.key === 'Z') { toggleSpeed(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { state.renderer.panPixels(-60); return; }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { state.renderer.panPixels(60); return; }
      if (e.repeat) return;
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const i = KEYS.indexOf(k);
      if (i >= 0 && i < ALL.length) { spawn(ALL[i].id); return; }
      if (window.GameUI.onKey) window.GameUI.onKey(k, e);
    });
  }

  function togglePause() {
    if (!state.running || !state.eng || state.eng.ended) return;
    state.paused = !state.paused;
    $('ov-pause').classList.toggle('hidden', !state.paused);
    $('btn-pause').textContent = state.paused ? '继续' : '暂停';
  }
  function toggleSpeed() {
    setSpeed(state.speed === 1 ? 2 : 1);
  }
  function setSpeed(v) {
    state.speed = v;
    if (state.eng) state.eng.speed = v;
  }

  // ---------- 对局 ----------
  function newGame() {
    const seed = (Math.random() * 1e9) | 0;
    const eng = new Engine({ seed });
    eng.speed = state.speed;
    AI.attach(eng, 1, state.level);
    state.eng = eng;
    state.running = true;
    state.paused = false;
    state.endAt = 0;
    state.renderer.cam.manual = false;
    state.renderer.popups = [];
    hudCache = {};
    if (window.GameUI.onNewGame) window.GameUI.onNewGame(eng);
    $('ov-start').classList.add('hidden');
    $('ov-end').classList.add('hidden');
    $('ov-pause').classList.add('hidden');
    $('btn-pause').textContent = '暂停';
    hideTip();
  }

  function showEnd() {
    const eng = state.eng;
    const won = eng.winner === 0;
    $('end-title').textContent = won ? '胜利' : '失败';
    $('end-title').className = won ? 'win' : 'lose';
    $('end-sub').textContent = `用时 ${fmtTime(eng.time)} · 难度：${LEVELS[state.level].label}`;
    const table = $('end-stats');
    const mine = eng.sides[0].spawned, foe = eng.sides[1].spawned;
    const ids = ALL.map((d) => d.id).filter((id) => (mine[id] || 0) + (foe[id] || 0) > 0);
    ids.sort((a, b) => (foe[b] || 0) + (mine[b] || 0) - ((foe[a] || 0) + (mine[a] || 0)));
    const name = (id) => ALL.find((d) => d.id === id).name;
    table.innerHTML = `<tr><th>兵种</th><th>我方出兵</th><th>电脑出兵</th></tr>` +
      ids.map((id) => `<tr><td>${name(id)}</td><td>${mine[id] || 0}</td><td>${foe[id] || 0}</td></tr>`).join('') +
      `<tr><th>合计</th><th>${Object.values(mine).reduce((a, b) => a + b, 0)}</th><th>${Object.values(foe).reduce((a, b) => a + b, 0)}</th></tr>`;
    $('ov-end').classList.remove('hidden');
  }

  function showStart() {
    state.running = false;
    $('ov-start').classList.remove('hidden');
    $('ov-end').classList.add('hidden');
    $('ov-pause').classList.add('hidden');
  }

  function bindMenus() {
    document.querySelectorAll('#levels button').forEach((b) => {
      b.addEventListener('click', () => {
        state.level = b.dataset.level;
        document.querySelectorAll('#levels button').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
    $('btn-start').addEventListener('click', newGame);
    $('btn-again').addEventListener('click', newGame);
    $('btn-menu').addEventListener('click', showStart);
    $('btn-pause').addEventListener('click', togglePause);
    $('btn-resume').addEventListener('click', togglePause);
    $('btn-speed').addEventListener('click', toggleSpeed);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.running && !state.paused) togglePause();
    });
  }

  // ---------- 主循环 ----------
  function loop(now) {
    const dt = state.lastT ? Math.min(0.1, (now - state.lastT) / 1000) : 0;
    state.lastT = now;
    const eng = state.eng;
    if (eng) {
      if (state.running && !state.paused && !eng.ended) eng.update(dt);
      const events = eng.drainEvents();
      state.renderer.ingest(events);
      if (events.some((e) => e.t === 'end')) state.endAt = now + 1600;
      state.renderer.draw(eng, dt);
      updateHud();
      updateRoster();
      if (window.GameUI.onFrame) window.GameUI.onFrame(eng);
      state.renderer.drawMinimap($('minimap'), eng);
      if (eng.ended && state.endAt && now >= state.endAt) {
        state.endAt = 0;
        state.running = false;
        showEnd();
      }
    } else if (state.renderer) {
      state.renderer.drawBackground();
    }
    requestAnimationFrame(loop);
  }

  function resize() {
    if (state.renderer) state.renderer.resize();
  }

  function init() {
    buildRoster();
    state.renderer = new Render.Renderer($('cv'));
    resize();
    window.addEventListener('resize', resize);
    bindCamera();
    bindKeys();
    bindMenus();
    SR.preload().then(() => {
      drawAvatars();
    });
    showStart();
    requestAnimationFrame(loop);
  }

  // 给作弊菜单和撒旦技能栏（cheat-ui.js）用的接口
  window.GameUI = { state, toast, setSpeed, flash, onKey: null, onNewGame: null, onFrame: null };

  init();
})();
