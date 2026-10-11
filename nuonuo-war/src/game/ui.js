// 糯糯战记 · 界面：开局、出兵栏、HUD、镜头输入（拖动、双指、滚轮、键盘、小地图、按钮）、简介浮窗、结束统计、主循环
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
  const PAN_SPEED = 900;        // 键盘平移：屏幕像素每秒
  const ZOOM_RATE = 1.2;        // 按住缩放键时，每秒的对数缩放量
  const TAP_SLOP = 10;          // 出兵栏：手指移动超过这么多像素就不算点按（是划动，不出兵）
  const BIG_BATCH = 1000;       // 批量出兵达到这个数量，要连点两次同一个兵种才出，防止误触
  const BATCH_CONFIRM_MS = 3000; // 连点确认的等待时间
  // 键盘平移的镜头方向。W 留给 Q–P 出兵（第 12 个兵种），上移用方向键
  const PAN = new Map([
    ['ArrowLeft', [-1, 0]], ['a', [-1, 0]], ['ArrowRight', [1, 0]], ['d', [1, 0]],
    ['ArrowUp', [0, -1]], ['ArrowDown', [0, 1]], ['s', [0, 1]],
  ]);
  // 缩放键：按物理键位（e.code）记录，] 和 [，= 和 - 的两个符号（+ _）共用同一个键
  const ZOOM_CODE = new Map([
    ['BracketRight', 1], ['Equal', 1], ['NumpadAdd', 1],
    ['BracketLeft', -1], ['Minus', -1], ['NumpadSubtract', -1],
  ]);

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
  const normKey = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  const fmtCount = (n) => (n >= 1e4 ? `${+(n / 1e4).toFixed(1)} 万` : String(n));

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
    panKeys: new Set(),
    zoomKeys: new Set(),
    batch: null,        // 批量出兵模式：{ side, count, pendingUid, pendingT }，由作弊菜单打开
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
      const wrap = el('div', 'av-wrap');
      const av = el('canvas', 'av');
      av.width = 48;
      av.height = 48;
      wrap.appendChild(av);
      card.appendChild(wrap);
      card.appendChild(el('div', 'nm', d.name));
      const cost = el('div', 'cost');
      cost.innerHTML = `<i class="coin"></i><b>${d.cost}</b><span>人口${d.supply}</span>`;
      card.appendChild(cost);
      const cd = el('div', 'cd');
      card.appendChild(cd);
      roster.appendChild(card);
      state.cards.set(d.id, { card, av, cd, cost, def: d, drawn: false });

      card.addEventListener('pointerdown', (e) => onCardDown(e, d.id));
      card.addEventListener('pointermove', onCardMove);
      card.addEventListener('pointerup', (e) => onCardUp(e, d.id));
      card.addEventListener('pointercancel', onCardCancel);
      card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
      card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(d.id, card); });
    });
  }

  // 出兵栏的点按只认“轻点”：手指按下后移动超过 TAP_SLOP 像素就是划动（横向滚动出兵栏），不出兵；
  // 按住超过 420 毫秒只弹出简介，松手也不出兵。误触来自划动和长按，这两种都不出兵。
  let press = null;
  let pressTimer = 0;
  function onCardDown(e, uid) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    press = { id: e.pointerId, uid, x: e.clientX, y: e.clientY, moved: false, long: false };
    // 按住期间的移动都送到这张卡上，松手时才知道手指有没有离开
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* 不支持就算了，靠移动距离判断 */ }
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!press || press.moved) return;
      press.long = true;
      showTip(uid, state.cards.get(uid).card);
    }, 420);
  }
  function onCardMove(e) {
    if (!press || e.pointerId !== press.id || press.moved) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) {
      press.moved = true;
      clearTimeout(pressTimer);
    }
  }
  function onCardUp(e, uid) {
    clearTimeout(pressTimer);
    const p = press;
    press = null;
    if (!p || p.moved || p.uid !== uid) return;
    if (p.long) {
      if (e.pointerType !== 'mouse') hideTip();
      return;
    }
    pick(uid);
  }
  // 手指在出兵栏横滑（pointercancel）：取消长按计时器，不然之后还会弹出简介且没有松手来收起
  function onCardCancel() {
    clearTimeout(pressTimer);
    press = null;
    hideTip();
  }

  // 点兵种（卡片或数字键）：平时出一个；批量出兵模式下是批量出兵
  function pick(uid) {
    if (state.batch) batchPick(uid);
    else spawn(uid);
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

  // ---------- 批量出兵（作弊菜单打开，见 cheat-ui.js） ----------
  // 进入后顶部出现提示条，点下方兵种就按设定的数量批量出兵，不扣金币、人口和冷却。
  // 数量 ≥ 1000 时要连点两次同一个兵种确认，防止误触出一大片。按 Esc 或提示条上的“取消”退出
  function armBatch(side, count) {
    const eng = state.eng;
    if (!eng || !state.running || eng.ended) { toast('先开始一局'); return; }
    state.batch = { side, count, pendingUid: null, pendingT: 0 };
    updateBatchBar();
  }
  function disarmBatch() {
    state.batch = null;
    updateBatchBar();
  }
  function batchPick(uid) {
    const b = state.batch;
    const eng = state.eng;
    if (!b || !eng || !state.running || state.paused || eng.ended) return;
    const d = ALL.find((x) => x.id === uid);
    const c = state.cards.get(uid);
    const who = b.side === 0 ? '我方' : '电脑';
    if (d.maxOnField) { toast(`${d.name}一次只能有一个，不能批量出`); return; }
    if (d.playerOnly && b.side !== 0) { toast(`${d.name}只能我方使用`); return; }
    const now = performance.now();
    if (b.count >= BIG_BATCH && !(b.pendingUid === uid && now < b.pendingT)) {
      b.pendingUid = uid;
      b.pendingT = now + BATCH_CONFIRM_MS;
      c.card.classList.add('pending');
      setTimeout(() => c.card.classList.remove('pending'), BATCH_CONFIRM_MS);
      updateBatchBar();
      return;
    }
    b.pendingUid = null;
    const n = eng.massSpawn(b.side, uid, b.count);
    flash(c.card, 'flash');
    toast(`${who}批量出兵 ${fmtCount(n)} 个${d.name}` + (n > Engine.BATCH_MAX ? `，${fmtCount(Engine.BATCH_MAX)} 个先上场，其余待命` : ''));
    updateBatchBar();
  }
  function updateBatchBar() {
    const bar = $('batchbar');
    const b = state.batch;
    if (!b) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    const who = b.side === 0 ? '我方' : '电脑';
    const waiting = !!b.pendingUid && performance.now() < b.pendingT;
    if (waiting) {
      const d = ALL.find((x) => x.id === b.pendingUid);
      $('batch-text').textContent = `再点一次「${d.name}」确认：${who} ×${fmtCount(b.count)}`;
    } else {
      b.pendingUid = null;
      $('batch-text').textContent = `批量出兵 · ${who} ×${fmtCount(b.count)} · 点下方兵种出兵`;
    }
    bar.classList.toggle('pending', waiting);
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
    const batch = !!state.batch;    // 批量出兵不看金币、人口和冷却，卡片全亮、不画冷却遮罩
    for (const c of state.cards.values()) {
      const d = c.def;
      // 作弊“出兵无冷却”开着时不画冷却遮罩（canSpawn 也忽略冷却，按钮是亮的）
      const left = batch || !S || eng.cheats.noCd ? 0 : S.cdLeft[d.id] || 0;
      c.cd.style.height = `${Math.round((left / d.cooldown) * 100)}%`;
      const ok = batch ? true : eng ? eng.canSpawn(0, d.id) === 'ok' : false;
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
    const cap = eng.supplyCap();
    setText('gold', String(Math.floor(S.gold)));
    const mimics = eng.count(0, 'mimic');
    // 与引擎的收入一致：基础收入（随时间涨）+ 贪婪宝箱，再乘作弊的收入倍率
    setText('income', `+${Math.round((eng.baseIncome(0) + 3 * mimics) * eng.cheats.incomeMul[0])}/秒`);
    setText('pop', eng.cheats.noSupply ? `人口 ${S.supplyUsed}/∞` : `人口 ${S.supplyUsed}/${cap}`);
    const popFrac = eng.cheats.noSupply ? 0 : Math.min(1, S.supplyUsed / cap);
    $('pop-fill').style.width = `${Math.round(popFrac * 100)}%`;
    $('pop-fill').classList.toggle('warn', popFrac > 0.9);
    setText('clock', fmtTime(eng.time));
    const alive = eng.stat ? eng.stat.alive : [0, 0];
    const wait = [eng.queued(0), eng.queued(1)];
    setText('alive-me', `在场 ${alive[0]}${wait[0] ? ` · 待命 ${fmtCount(wait[0])}` : ''}`);
    setText('alive-foe', `在场 ${alive[1]}${wait[1] ? ` · 待命 ${fmtCount(wait[1])}` : ''}`);
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
  function toggleFollow() {
    const rv = state.renderer;
    rv.setFollow(!rv.cam.follow);
    syncFollow();
  }
  function syncFollow() {
    $('btn-follow').classList.toggle('on', state.renderer.cam.follow);
  }

  function bindCamera() {
    const cv = $('cv');
    // 指针位置表：鼠标和手指都走这里。一根手指拖动，两根手指捏合缩放并跟着中点平移
    const pts = new Map();
    let pinch = null;
    const pinchInfo = () => {
      const [a, b] = [...pts.values()];
      const r = cv.getBoundingClientRect();
      return {
        mx: (a.x + b.x) / 2 - r.left,
        my: (a.y + b.y) / 2 - r.top,
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      };
    };
    cv.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cv.setPointerCapture(e.pointerId);
      pinch = pts.size === 2 ? pinchInfo() : null;
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const rv = state.renderer;
      const px = p.x, py = p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 1) {
        rv.dragCam(p.x - px, p.y - py);
      } else if (pts.size === 2 && pinch) {
        const cur = pinchInfo();
        rv.dragCam(cur.mx - pinch.mx, cur.my - pinch.my);
        rv.zoomAt(cur.mx, cur.my, rv.cam.zoom * cur.d / pinch.d);
        pinch = cur;
      }
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      pinch = pts.size === 2 ? pinchInfo() : null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      if (!state.renderer) return;
      e.preventDefault();
      const rv = state.renderer;
      const k = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * k, dy = e.deltaY * k;
      if (Math.abs(dx) > Math.abs(dy)) {
        rv.moveCam(-dx, 0);      // 横向滚动：和拖动同一个方向（触控板两指右滑，画面往左走）
      } else {
        const r = cv.getBoundingClientRect();
        rv.zoomAt(e.clientX - r.left, e.clientY - r.top, rv.cam.zoom * Math.exp(-dy * 0.0015));
      }
    }, { passive: false });

    // 小地图：点击或拖动跳转（完整地图，x / w、y / h）
    const mm = $('minimap');
    let mmDown = false;
    const mmMove = (e) => {
      const r = mm.getBoundingClientRect();
      const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      state.renderer.centerOn(fx * Render.MW, fy * Render.MH);
    };
    mm.addEventListener('pointerdown', (e) => { mmDown = true; mm.setPointerCapture(e.pointerId); mmMove(e); });
    mm.addEventListener('pointermove', (e) => { if (mmDown) mmMove(e); });
    const mmEnd = () => { mmDown = false; };
    mm.addEventListener('pointerup', mmEnd);
    mm.addEventListener('pointercancel', mmEnd);

    // 画布右侧的 + − 和跟随开关（给触屏用）
    $('btn-zin').addEventListener('click', () => state.renderer.zoomBy(1.25));
    $('btn-zout').addEventListener('click', () => state.renderer.zoomBy(0.8));
    $('btn-follow').addEventListener('click', toggleFollow);
  }

  // 键盘镜头：平移和缩放按住持续生效（每帧按 dt 计算）
  function applyKeys(dt) {
    const rv = state.renderer;
    if (!rv || dt <= 0) return;
    let dx = 0, dy = 0, dz = 0;
    for (const k of state.panKeys) { const d = PAN.get(k); dx += d[0]; dy += d[1]; }
    for (const k of state.zoomKeys) dz += ZOOM_CODE.get(k);
    if (dx || dy) rv.moveCam(dx * PAN_SPEED * dt, dy * PAN_SPEED * dt);
    if (dz) rv.zoomBy(Math.exp(dz * ZOOM_RATE * dt));
  }

  // ---------- 键盘 ----------
  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      // 带 Ctrl / Cmd / Alt 的组合键留给浏览器（刷新、打印、标签页、缩放等），游戏不处理
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && state.batch) { disarmBatch(); return; }
      const low = normKey(e);
      if (PAN.has(low)) { e.preventDefault(); state.panKeys.add(low); return; }
      // 缩放键按物理键位记录：+ 和 = 是同一个键，松开时 e.key 可能已经变了
      if (ZOOM_CODE.has(e.code)) { e.preventDefault(); state.zoomKeys.add(e.code); return; }
      if (!state.running) return;
      if (e.repeat) return;     // 按住不放时的自动重复：不反复切换暂停和倍速
      if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
      if (low === 'z') { toggleSpeed(); return; }
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const i = KEYS.indexOf(k);
      if (i >= 0 && i < ALL.length) { pick(ALL[i].id); return; }
      if (window.GameUI.onKey) window.GameUI.onKey(k, e);
    });
    window.addEventListener('keyup', (e) => {
      state.panKeys.delete(normKey(e));
      state.zoomKeys.delete(e.code);
    });
    // 切换窗口时松开所有按住的键，防止镜头一直走
    window.addEventListener('blur', () => { state.panKeys.clear(); state.zoomKeys.clear(); });
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
    state.renderer.resetCam();
    state.renderer.popups = [];
    disarmBatch();
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
    const won = eng.winner === 0, draw = eng.winner === 'draw';
    $('end-title').textContent = draw ? '平局' : won ? '胜利' : '失败';
    $('end-title').className = draw ? 'draw' : won ? 'win' : 'lose';
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
    $('batch-cancel').addEventListener('click', disarmBatch);
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
    const rv = state.renderer;
    applyKeys(dt);
    const eng = state.eng;
    if (eng) {
      if (state.running && !state.paused && !eng.ended) eng.update(dt);
      const events = eng.drainEvents();
      rv.ingest(events);
      if (events.some((e) => e.t === 'end')) state.endAt = now + 1600;
      rv.draw(eng, dt);
      updateHud();
      updateRoster();
      if (window.GameUI.onFrame) window.GameUI.onFrame(eng);
      rv.drawMinimap($('minimap'), eng);
      // 连点确认的等待时间到了，提示条恢复成普通文字
      if (state.batch && state.batch.pendingUid && performance.now() >= state.batch.pendingT) updateBatchBar();
      if (eng.ended && state.endAt && now >= state.endAt) {
        state.endAt = 0;
        state.running = false;
        showEnd();
      }
    } else if (rv) {
      rv.drawIdle(dt);
      rv.drawMinimap($('minimap'), null);
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
    syncFollow();
    SR.preload().then(() => {
      drawAvatars();
    });
    showStart();
    requestAnimationFrame(loop);
  }

  // 给作弊菜单和撒旦技能栏（cheat-ui.js）用的接口
  window.GameUI = { state, toast, setSpeed, flash, armBatch, fmtCount, onKey: null, onNewGame: null, onFrame: null };

  init();
})();
