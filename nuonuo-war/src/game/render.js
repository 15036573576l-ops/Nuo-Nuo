// 糯糯战记 · 画面：斜视投影、烘焙地图、镜头、单位与水晶、投射物、区域、特效、飘字、小地图
// 只读引擎状态，不改任何数值。世界坐标 (x, y) 经下面的 sx / sy 投影到屏幕（契约第三节）：
//   sx = (x - cam.x) * zoom + w/2，sy = (y - cam.y) * zoom * K + h/2
// 精灵按脚底锚点画在投影点上，不做透视缩放；地面圆画成椭圆（ry = r * zoom * K）。
(function () {
  const R = window.RULES;
  const SH = window.HD_SHEETS;
  const SR = window.SpriteRender;
  const C = window.Combat;
  const MW = R.map.w, MH = R.map.h;

  const K = 0.6;                    // 地面压扁系数
  const ZOOM_MIN = 0.22, ZOOM_MAX = 1.8, ZOOM_INIT = 0.7;
  const LOD_ZOOM = 0.5;             // 低于它时单位画成阵营色圆点
  const SPRITE_BUDGET = 900;        // 视野内最多画这么多个精灵，其余画成圆点
  const BODY_BUDGET = 400;          // 尸体的精灵上限，超出的同样画成圆点
  const MANUAL_PAUSE = 3;           // 手动操作后暂停跟随的秒数
  const FOLLOW_RATE = 2.5;          // 跟随时镜头追赶跟随目标的速度（每秒比例）
  const FOCUS_RATE = 0.8;           // 跟随目标本身的平滑速度（每秒比例）：单位进出战斗时目标不跳变
  const SWING_WEIGHT = 3;           // 跟随目标里，正在挥击的单位权重（其余单位为 1）
  const DUST_LIFE = 0.5;            // 钻地尘土的寿命（秒）
  const DUST_MAX = 160;             // 尘土单独的数量上限，和飘字分开计数，不会挤掉伤害数字
  const BAKE = 0.5;                 // 地面烘焙分辨率：一个世界像素画成 0.5 个画布像素
  const FLY_LIFT = 36;              // 飞行单位离地的高度（世界像素）
  const CULL = 90;                  // 视野外多留的余量（屏幕像素），精灵边缘不会突然消失

  const ELEM = { fire: '#ff8a3d', frost: '#7dd8ff', poison: '#8be05c', shadow: '#c86bff', holy: '#ffe38a' };
  const PROJ_SCALE = { arrow: 1.8, spear: 1.5, bomb: 0.55, spore: 1.0, fireball: 1.1 };
  const BADGES = [
    ['burn', '燃', '#ff7a3d'], ['chill', '寒', '#7dd8ff'], ['frozen', '冻', '#9fe8ff'],
    ['poison', '毒', '#8be05c'], ['vulnerable', '易', '#ff9ad5'], ['weaken', '衰', '#b59cff'],
    ['holyShield', '盾', '#ffe38a'], ['unyielding', '不', '#ffd166'], ['stun', '晕', '#ffd166'], ['root', '定', '#c9a46b'],
  ];
  const SIDE_COLOR = ['#6fd3ff', '#ff6b6b'];
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';
  const FLOWERS = ['#fff3a3', '#ffffff', '#ff9ac1', '#c9a7ff', '#ffd166'];

  const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  // 椭圆路径（半径非负，避免 ctx.ellipse 抛错）
  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  }

  // 为 sprite 动画取得状态：攻击按 swing 的时钟，受击/死亡只播一次
  function pose(u) {
    if (u.bones) return { state: 'death', t: 10, opt: { alpha: 0.95 } };
    if (u.hitT < 0.22) return { state: 'hit', t: u.hitT, opt: { once: true, flash: true } };
    if (u.swing) return { state: 'attack', t: u.swing.t, opt: { period: u.swing.period } };
    if (u.charge) return { state: 'run', t: u.clock, opt: {} };
    if (u.burrowed) return { state: 'run', t: u.clock, opt: { alpha: 0.32 } };
    if (u.moving) return { state: 'run', t: u.clock, opt: {} };
    return { state: 'idle', t: u.clock, opt: {} };
  }

  // 固定种子的随机数（mulberry32）：每次打开地图都一样
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 启动时把整张地图画到离屏画布上（世界平面的俯视图，一半分辨率）。绘制时再按 K 压扁。
  // 内容：草地渐变、草丛噪点、一条土路（沿中线）、花、石头、树丛；水晶底座画在两端。
  // 写成生成器：每个 yield 处让出一小段时间（见 Renderer.bakeStep），不会一次卡住几百毫秒
  function* bakeGround(cv) {
    const g = cv.getContext('2d');
    g.setTransform(BAKE, 0, 0, BAKE, 0, 0);
    const rnd = seeded(7321);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const hy = MH / 2;
    // 土路的中心线：轻微起伏
    const roadY = (x) => hy + Math.sin(x * 0.0011) * 60 + Math.sin(x * 0.0037 + 1.3) * 18;
    const roadPath = (half) => {
      g.beginPath();
      for (let x = 0; x <= MW; x += 40) g.lineTo(x, roadY(x) - half);
      for (let x = MW; x >= 0; x -= 40) g.lineTo(x, roadY(x) + half);
      g.closePath();
    };

    // 草地渐变 + 大块明暗
    const gg = g.createLinearGradient(0, 0, 0, MH);
    gg.addColorStop(0, '#62944c');
    gg.addColorStop(0.5, '#558546');
    gg.addColorStop(1, '#3d6934');
    g.fillStyle = gg;
    g.fillRect(0, 0, MW, MH);
    yield;
    for (let i = 0; i < 36; i++) {
      if (i % 6 === 5) yield;
      const x = rnd() * MW, y = rnd() * MH, rad = 220 + rnd() * 380;
      const rg = g.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, rnd() < 0.5 ? 'rgba(190,230,140,0.10)' : 'rgba(18,48,18,0.14)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 草丛噪点：细小的明暗斑点，和一批短草叶
    const dark = 'rgba(16,42,16,0.32)', light = 'rgba(196,236,150,0.20)';
    for (let i = 0; i < 50000; i++) {
      const x = rnd() * MW, y = rnd() * MH, s = 1 + rnd() * 2;
      g.fillStyle = rnd() < 0.55 ? dark : light;
      g.fillRect(x, y, s, s * 0.8);
      if (i % 1000 === 999) yield;
    }
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(28,66,26,0.55)';
    g.beginPath();
    for (let i = 0; i < 7000; i++) {
      const x = rnd() * MW, y = rnd() * MH, d = (rnd() - 0.5) * 5;
      g.moveTo(x, y); g.lineTo(x + d, y - 3 - rnd() * 3);
      g.moveTo(x, y); g.lineTo(x - d * 0.8, y - 2 - rnd() * 3);
    }
    g.stroke();
    yield;

    // 土路：深色路基 → 路面 → 中间略亮 → 车辙 → 碎石
    g.fillStyle = '#5b4530'; roadPath(70); g.fill();
    g.fillStyle = '#8a6b47'; roadPath(60); g.fill();
    g.fillStyle = 'rgba(190,160,110,0.18)'; roadPath(22); g.fill();
    g.strokeStyle = 'rgba(70,50,30,0.35)';
    g.lineWidth = 3;
    for (const off of [-22, 22]) {
      g.beginPath();
      for (let x = 0; x <= MW; x += 40) g.lineTo(x, roadY(x) + off);
      g.stroke();
    }
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * MW, y = roadY(x) + (rnd() * 2 - 1) * 58, s = 1 + rnd() * 2.2;
      g.fillStyle = rnd() < 0.5 ? 'rgba(70,50,30,0.5)' : 'rgba(214,190,140,0.4)';
      g.fillRect(x, y, s, s);
    }

    yield;
    // 两座水晶的底座（石板圆台）：和水晶的碰撞圆同一个半径，单位站在圆边上正好贴着底座
    for (const px of [R.map.inset, MW - R.map.inset]) {
      const rr = R.map.crystalRadius;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.arc(px + 6, hy + 8, rr, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5b5c67';
      g.beginPath(); g.arc(px, hy, rr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3c3d47'; g.lineWidth = 4; g.stroke();
    }

    // 花丛
    for (let i = 0; i < 160; i++) {
      if (i % 40 === 39) yield;
      const cx = rnd() * MW, cy = rnd() * MH;
      if (Math.abs(cy - roadY(cx)) < 80) continue;
      const col = pick(FLOWERS), n = 6 + Math.floor(rnd() * 10);
      for (let j = 0; j < n; j++) {
        const x = cx + (rnd() - 0.5) * 70, y = cy + (rnd() - 0.5) * 50;
        g.fillStyle = rnd() < 0.7 ? col : pick(FLOWERS);
        g.beginPath(); g.arc(x, y, 1.5 + rnd() * 1.5, 0, Math.PI * 2); g.fill();
      }
    }
    // 石头
    for (let i = 0; i < 280; i++) {
      const x = rnd() * MW, y = rnd() * MH, rw = 5 + rnd() * 9, rh = rw * (0.6 + rnd() * 0.3);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath(); g.ellipse(x + 3, y + 4, rw, rh, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = rnd() < 0.5 ? '#8f959c' : '#737980';
      g.beginPath(); g.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.beginPath(); g.ellipse(x - rw * 0.25, y - rh * 0.3, rw * 0.5, rh * 0.4, 0, 0, Math.PI * 2); g.fill();
    }
    yield;
    // 树丛：俯视的树冠和投影，画在花和石头之上。不挡路，只是装饰
    const blocked = (x, y) => {
      if (Math.abs(y - roadY(x)) < 110) return true;
      return Math.hypot(x - R.map.inset, y - hy) < 260 || Math.hypot(x - (MW - R.map.inset), y - hy) < 260;
    };
    for (let i = 0; i < 120; i++) {
      if (i % 12 === 11) yield;
      const x = rnd() * MW, y = rnd() * MH;
      if (blocked(x, y)) continue;
      const n = 3 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        const cx = x + (rnd() - 0.5) * 130, cy = y + (rnd() - 0.5) * 100, rad = 24 + rnd() * 34;
        g.fillStyle = 'rgba(10,30,10,0.32)';
        g.beginPath(); g.arc(cx + 8, cy + 10, rad, 0, Math.PI * 2); g.fill();
        const cg = g.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, rad * 0.1, cx, cy, rad);
        cg.addColorStop(0, '#6aa253'); cg.addColorStop(0.65, '#3f7236'); cg.addColorStop(1, '#2a5025');
        g.fillStyle = cg;
        g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(200,240,160,0.22)';
        for (let j = 0; j < 5; j++) {
          const a = rnd() * Math.PI * 2, d = rnd() * rad * 0.6;
          g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + rnd() * 4, 0, Math.PI * 2); g.fill();
        }
      }
    }
    yield;
    // 地图边缘压暗
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 14;
    g.strokeRect(0, 0, MW, MH);
    return cv;
  }

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = 1;
      this.h = 1;
      // 镜头：x, y 是画面中心对应的世界坐标；follow 为跟随战斗；manualT 是最近一次手动操作的时间
      this.cam = { x: R.map.inset + 700, y: MH / 2, zoom: ZOOM_INIT, follow: true, manualT: -99 };
      this.focus = { x: this.cam.x, y: this.cam.y };   // 跟随目标（已平滑）
      this.popups = [];
      this.dust = [];
      this.time = 0;
      this.hpSeen = [null, null];   // 水晶上一帧的血量：用于受击闪烁
      this.flash = [0, 0];
      this.bake = document.createElement('canvas');
      this.bake.width = Math.round(MW * BAKE);
      this.bake.height = Math.round(MH * BAKE);
      this.bakeJob = bakeGround(this.bake);   // 地面分段烘焙，每帧用一小段时间（见 bakeStep）
      this.mini = document.createElement('canvas');
      this.mini.width = 320;
      this.mini.height = 128;
    }

    // 地面烘焙：每帧最多用 budgetMs 毫秒，烘焙完成后更新小地图底图
    bakeStep(budgetMs) {
      if (!this.bakeJob) return;
      const t0 = performance.now();
      do {
        if (this.bakeJob.next().done) {
          this.bakeJob = null;
          this.mini.getContext('2d').drawImage(this.bake, 0, 0, 320, 128);
          return;
        }
      } while (performance.now() - t0 < budgetMs);
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.cv.getBoundingClientRect();
      this.w = Math.max(320, r.width);
      this.h = Math.max(1, r.height);     // 按舞台的实际高度，不钳到 200（矮的舞台会把画面压扁）
      this.cv.width = Math.round(this.w * dpr);
      this.cv.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.clamp();
    }

    // ---------- 投影 ----------
    sx(x) { return (x - this.cam.x) * this.cam.zoom + this.w / 2; }
    sy(y) { return (y - this.cam.y) * this.cam.zoom * K + this.h / 2; }
    toWorld(px, py) {
      return {
        x: this.cam.x + (px - this.w / 2) / this.cam.zoom,
        y: this.cam.y + (py - this.h / 2) / (this.cam.zoom * K),
      };
    }

    // 镜头不离开地图太远：视野比地图小时才能平移，否则居中
    clamp() {
      const c = this.cam;
      const hx = this.w / (2 * c.zoom), hy = this.h / (2 * c.zoom * K);
      c.x = hx * 2 >= MW ? MW / 2 : Math.max(hx, Math.min(MW - hx, c.x));
      c.y = hy * 2 >= MH ? MH / 2 : Math.max(hy, Math.min(MH - hy, c.y));
    }

    // ---------- 镜头操作（界面输入调用） ----------
    markManual() { this.cam.manualT = this.time; }
    // 镜头直接移动（屏幕像素）：键盘
    moveCam(px, py) {
      const c = this.cam;
      c.x += px / c.zoom;
      c.y += py / (c.zoom * K);
      this.markManual();
      this.clamp();
    }
    // 拖动：内容跟着指针走
    dragCam(dx, dy) { this.moveCam(-dx, -dy); }
    // 以屏幕上某点为中心缩放，那一点下面的世界位置保持不动
    zoomAt(px, py, zoom) {
      const c = this.cam;
      const nz = clampZoom(zoom);
      const p = this.toWorld(px, py);
      c.zoom = nz;
      c.x = p.x - (px - this.w / 2) / nz;
      c.y = p.y - (py - this.h / 2) / (nz * K);
      this.markManual();
      this.clamp();
    }
    zoomBy(f) { this.zoomAt(this.w / 2, this.h / 2, this.cam.zoom * f); }
    centerOn(x, y) {
      this.cam.x = x;
      this.cam.y = y;
      this.markManual();
      this.clamp();
    }
    setFollow(on) {
      this.cam.follow = on;
      this.cam.manualT = -99;
    }
    resetCam() {
      this.cam.x = R.map.inset + 700;
      this.cam.y = MH / 2;
      this.cam.manualT = -99;
      this.focus.x = this.cam.x;
      this.focus.y = this.cam.y;
      this.clamp();
    }

    // 跟随目标：所有存活单位的加权平均，正在挥击的单位权重 ×3。
    // 不能只取挥击中的单位：挥击集合每秒大量进出，平均位置会跳来跳去，镜头跟着晃
    battleCenter(eng) {
      let x = 0, y = 0, w = 0;
      for (const u of eng.units) {
        if (!eng.alive(u)) continue;
        const k = u.swing ? SWING_WEIGHT : 1;
        x += u.x * k; y += u.y * k; w += k;
      }
      if (!w) return { x: R.map.inset + 700, y: MH / 2 };
      return { x: x / w, y: y / w };
    }
    followCamera(eng, dt) {
      const c = this.cam;
      // 跟随目标本身先平滑一下，再让镜头追它
      const t = this.battleCenter(eng);
      const kf = Math.min(1, dt * FOCUS_RATE);
      this.focus.x += (t.x - this.focus.x) * kf;
      this.focus.y += (t.y - this.focus.y) * kf;
      if (c.follow && this.time - c.manualT > MANUAL_PAUSE) {
        const k = Math.min(1, dt * FOLLOW_RATE);
        c.x += (this.focus.x - c.x) * k;
        c.y += (this.focus.y - c.y) * k;
      }
      this.clamp();
    }

    // ---------- 事件 → 飘字 ----------
    ingest(events) {
      for (const ev of events) {
        if (ev.t === 'num') {
          this.addPopup(ev.x, ev.y, String(ev.v), ev.color, 15, 0.9, 0);
        } else if (ev.t === 'react') {
          this.addPopup(ev.x, ev.y, ev.text, ev.color, 18, 1.1, 22);
        } else if (ev.t === 'skill') {
          this.addPopup(ev.x, ev.y, ev.name, ev.side === 0 ? '#bfe9ff' : '#ffc2c2', 17, 1.6, 40);
        }
      }
    }
    addPopup(x, y, text, color, size, dur, rise) {
      this.popups.push({ x, y, text, color, size, dur, rise, t: 0, jx: (Math.random() - 0.5) * 26, jy: Math.random() * 16 });
      if (this.popups.length > 160) this.popups.splice(0, this.popups.length - 160);
    }
    // 钻地尘土：单独计数，不进飘字数组，所以不会把伤害数字挤掉
    addDust(x, y) {
      this.dust.push({ x, y, t: 0 });
      if (this.dust.length > DUST_MAX) this.dust.splice(0, this.dust.length - DUST_MAX);
    }

    // ---------- 整帧 ----------
    draw(eng, dt) {
      this.time += dt;
      this.bakeStep(8);
      this.followCamera(eng, dt);
      this.updateFlash(eng, dt);
      this.drawVoid();
      this.drawGround();
      const { ents, bodies } = this.collect(eng);
      this.drawZones(eng);
      this.drawAuras(eng);
      for (const b of bodies) this.drawBody(b);
      // 单位和水晶按 y 排序（远的先画）
      ents.sort((a, b) => a.y - b.y);
      for (const it of ents) {
        if (it.k === 1) this.drawCrystal(it.o, it.sx, it.sy);
        else this.drawUnit(it.o, it.sx, it.sy, it.gy, it.sp);
      }
      this.drawProjectiles(eng);
      this.drawFx(eng);
      this.drawDust(dt);
      this.drawPopups(dt);
    }

    // 还没开局时的底图（烘焙也在这里继续做）
    drawIdle(dt) {
      this.time += dt;
      this.bakeStep(8);
      this.drawVoid();
      this.drawGround();
    }

    updateFlash(eng, dt) {
      for (let s = 0; s < 2; s++) {
        const c = eng.crystals[s];
        const seen = this.hpSeen[s];
        if (seen !== null && c.hp < seen - 0.5) this.flash[s] = 0.15;
        this.hpSeen[s] = c.hp;
        if (this.flash[s] > 0) this.flash[s] -= dt;
      }
    }

    drawVoid() {
      const { ctx, w, h } = this;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0b1020');
      g.addColorStop(1, '#17213a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // 只取视野对应的源矩形贴到屏幕上，超出地图的部分留给底色
    drawGround() {
      const { ctx, cam } = this;
      const z = cam.zoom;
      const hx = this.w / (2 * z), hy = this.h / (2 * z * K);
      const x0 = Math.max(0, cam.x - hx), x1 = Math.min(MW, cam.x + hx);
      const y0 = Math.max(0, cam.y - hy), y1 = Math.min(MH, cam.y + hy);
      if (x1 <= x0 || y1 <= y0) return;
      ctx.drawImage(
        this.bake,
        x0 * BAKE, y0 * BAKE, (x1 - x0) * BAKE, (y1 - y0) * BAKE,
        this.sx(x0), this.sy(y0), (x1 - x0) * z, (y1 - y0) * z * K,
      );
    }

    // 找出视野内要画的东西：单位和水晶进入排序列表；缩远或超出预算的单位只画圆点
    collect(eng) {
      const z = this.cam.zoom, w = this.w, h = this.h;
      const cx0 = w / 2, cy0 = h / 2;
      const lod = z < LOD_ZOOM;
      const ents = [];
      const near = [];
      for (const c of eng.crystals) {
        const gx = this.sx(c.x), gy = this.sy(c.y);
        ents.push({ k: 1, o: c, y: c.y, sx: gx, sy: gy, gy, sp: true });
      }
      for (const u of eng.units) {
        const gx = this.sx(u.x), gy = this.sy(u.y);
        const py = gy - (u.flying ? FLY_LIFT * z : 0);
        if (gx < -CULL || gx > w + CULL || py < -CULL || py > h + CULL) continue;
        const it = { k: 0, o: u, y: u.y, sx: gx, sy: py, gy, sp: false, d: (gx - cx0) ** 2 + (py - cy0) ** 2 };
        ents.push(it);
        near.push(it);
      }
      if (!lod) {
        // 离镜头中心近的优先画精灵
        if (near.length > SPRITE_BUDGET) near.sort((a, b) => a.d - b.d);
        const n = Math.min(SPRITE_BUDGET, near.length);
        for (let i = 0; i < n; i++) near[i].sp = true;
      }
      const bodies = [];
      let bodySprites = 0;
      for (const b of eng.bodies) {
        const gx = this.sx(b.x), gy = this.sy(b.y);
        if (gx < -CULL || gx > w + CULL || gy < -CULL || gy > h + CULL) continue;
        const sp = !lod && bodySprites < BODY_BUDGET;
        if (sp) bodySprites++;
        bodies.push({ b, sx: gx, sy: gy, sp });
      }
      return { ents, bodies };
    }

    // 单位的圆点（LOD 和超出预算时用）
    dot(x, y, side, alpha) {
      const ctx = this.ctx;
      const r = 2 + Math.min(2, this.cam.zoom * 2);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = SIDE_COLOR[side];
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawCrystal(c, cx, base) {
      const ctx = this.ctx, z = this.cam.zoom, s = c.side;
      const flashing = this.flash[s] > 0;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2 + s);
      const col = SIDE_COLOR[s];
      const rx = c.radius * z, ry = rx * K;      // 底座半径 = 水晶的碰撞半径
      const hpFrac = Math.max(0, c.hp / c.maxHp);
      // 脚下的范围圈
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.3 + 0.2 * pulse;
      ctx.lineWidth = 2;
      ellipse(ctx, cx, base, c.radius * z * 1.15, c.radius * z * 1.15 * K);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // 底座：椭圆底 + 侧面 + 台面
      ctx.fillStyle = '#2e2d37';
      ellipse(ctx, cx, base, rx, ry); ctx.fill();
      ctx.fillStyle = '#3b3a46';
      ctx.fillRect(cx - rx, base - 12 * z, rx * 2, 12 * z);
      ctx.fillStyle = '#55535f';
      ellipse(ctx, cx, base - 12 * z, rx, ry); ctx.fill();
      // 水晶本体
      const top = base - 120 * z, mid = base - 66 * z, low = base - 16 * z;
      ctx.save();
      ctx.globalAlpha = c.hp <= 0 ? 0.3 : 1;
      const grd = ctx.createLinearGradient(cx, top, cx, low);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.35, col);
      grd.addColorStop(1, '#1f2a44');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + 30 * z, mid);
      ctx.lineTo(cx + 18 * z, low);
      ctx.lineTo(cx - 18 * z, low);
      ctx.lineTo(cx - 30 * z, mid);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = col;
      ctx.shadowBlur = (14 + 8 * pulse) * z;
      ctx.strokeStyle = flashing ? '#ffffff' : col;
      ctx.lineWidth = 2 * z;
      ctx.stroke();
      ctx.restore();
      // 血条（缩远时不再细到看不见）
      const bw = Math.max(70, 150 * z), bh = Math.max(6, 10 * z);
      const bx = cx - bw / 2, by = top - 26 * z;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      ctx.fillStyle = s === 0 ? '#3ea6ff' : '#ff5a5a';
      ctx.fillRect(bx, by, bw * hpFrac, bh);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.max(10, Math.round(12 * z))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${s === 0 ? '我方' : '电脑'}水晶 ${Math.ceil(c.hp)}`, cx, by - 6 * z);
      // 炮塔冷却的小点
      if (c.hp > 0) {
        ctx.fillStyle = c.cd <= 0 ? '#ffe38a' : 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(cx + 40 * z, top + 6 * z, 3 * z, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 撒旦的炼狱光环：地面上一圈呼吸的暗红火光，画在地面层，不会盖住后方的单位
    drawAuras(eng) {
      const ctx = this.ctx, z = this.cam.zoom;
      for (const u of eng.units) {
        if (u.uid !== 'satan' || !eng.alive(u)) continue;
        const px = this.sx(u.x), gy = this.sy(u.y);
        const k = 0.5 + 0.5 * Math.sin(this.time * 3);
        const r = 200 * z;     // 光环半径就是 200，地面圆，走 K 压扁
        ctx.save();
        ctx.translate(px, gy);
        ctx.scale(1, K);
        const g = ctx.createRadialGradient(0, 0, 10, 0, 0, r);
        g.addColorStop(0, `rgba(255,80,30,${0.35 + 0.15 * k})`);
        g.addColorStop(1, 'rgba(120,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    drawZones(eng) {
      const ctx = this.ctx, z = this.cam.zoom;
      for (const zn of eng.zones) {
        const cx = this.sx(zn.x), cy = this.sy(zn.y);
        const rx = zn.r * z, ry = rx * K;
        const k = Math.max(0, Math.min(1, zn.t / 5));
        ctx.fillStyle = `rgba(255,110,40,${0.12 + 0.05 * Math.sin(this.time * 6)})`;
        ellipse(ctx, cx, cy, rx, ry);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,150,60,${0.4 * k + 0.1})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        // 落下的火星
        for (let i = 0; i < 9; i++) {
          const ph = (this.time * 1.7 + i / 9) % 1;
          const px = cx + Math.sin(i * 12.9 + zn.x) * rx * 0.9;
          const py = cy + Math.cos(i * 7.3 + zn.y) * ry * 0.9 - 150 * z * (1 - ph);
          ctx.fillStyle = `rgba(255,190,90,${0.8 * (1 - ph)})`;
          ctx.fillRect(px, py, 3, 3);
        }
      }
    }

    drawBody(it) {
      const b = it.b, ctx = this.ctx, z = this.cam.zoom;
      const left = b.life - b.age;
      const alpha = Math.max(0, Math.min(1, left / (b.corpse ? 1.5 : 0.4)));
      if (alpha <= 0) return;
      if (!it.sp) {
        this.dot(it.sx, it.sy, b.side, alpha * 0.6);
        return;
      }
      const sh = SH[b.sheet];
      if (!sh) return;
      const S = z * 1.3 * (b.small ? 0.7 : 1) * (b.scale || 1);
      SR.drawHero(ctx, { sheet: b.sheet, aspd: 1 }, 'death', b.age, it.sx, it.sy, S, b.side === 0 ? 1 : -1, { alpha });
    }

    // 单位：sp 为 false 时画成圆点（缩远、超出预算）
    drawUnit(u, px, py, gy, sp) {
      if (!sp) {
        this.dot(px, py, u.side, u.bones ? 0.45 : 1);
        return;
      }
      const sh = SH[u.sheet];
      if (!sh) return;
      const ctx = this.ctx, z = this.cam.zoom;
      const S = z * 1.3 * (u.small ? 0.7 : 1) * (u.def.scale || 1);
      // 地面阴影（飞行单位的影子留在地上）。精灵自己的影子关掉，只画这一处
      if (!u.burrowed) {
        const rr = Math.max(4, u.radius * z);
        ctx.fillStyle = u.flying ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.26)';
        ellipse(ctx, px, gy, rr, rr * K);
        ctx.fill();
      }
      if (u.uid === 'satan' && u.invuln > 0) {
        // 不灭无敌期间：身上一圈金色光环（炼狱光环在地面层，见 drawAuras）
        const k = 0.5 + 0.5 * Math.sin(this.time * 3);
        ctx.strokeStyle = `rgba(255,200,120,${0.6 + 0.4 * k})`;
        ctx.lineWidth = 3;
        ellipse(ctx, px, py - sh.bodyH * S * 0.5, sh.bodyW * S * 0.7, sh.bodyH * S * 0.62);
        ctx.stroke();
      }
      const p = pose(u);
      const alpha = p.opt.alpha == null ? 1 : p.opt.alpha;
      p.opt.noShadow = true;     // 影子已在上面画过，精灵自己的不画（pose 每次返回新的 opt，改它没有副作用）
      if (alpha > 0) SR.drawHero(ctx, u.def, p.state, p.t, px, py, S, u.dir, p.opt);
      if (u.bones) return;

      const top = py - sh.bodyH * S - 8 * z;
      // 冻结：脚下冰圈
      if (C.has(u, 'frozen')) {
        ctx.strokeStyle = 'rgba(159,232,255,0.8)';
        ctx.lineWidth = 2;
        ellipse(ctx, px, gy, sh.bodyW * S * 0.6, 4 * z);
        ctx.stroke();
      }
      // 血条
      const bw = Math.max(24, sh.bodyW * S * 1.05), bh = 4 * z;
      const bx = px - bw / 2, by = top - bh;
      const frac = Math.max(0, Math.min(1, u.hp / u.maxHp));
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = SIDE_COLOR[u.side];
      ctx.fillRect(bx, by, bw * frac, bh);
      const shield = u.st.holyShield;
      if (shield && shield.absorb > 0) {
        ctx.fillStyle = 'rgba(255,227,138,0.9)';
        ctx.fillRect(bx, by - 3 * z, Math.min(bw, bw * shield.absorb / 200), 2 * z);
      }
      // 状态角标
      const badges = BADGES.filter(([id]) => C.has(u, id));
      if (badges.length) {
        const bs = Math.max(10, 13 * z);
        const total = badges.length * (bs + 2);
        let x0 = px - total / 2;
        for (const [id, label, color] of badges) {
          const stacks = C.stacksOf(u, id);
          ctx.fillStyle = color;
          ctx.fillRect(x0, by - bs - 4 * z, bs, bs);
          ctx.fillStyle = '#111';
          ctx.font = `700 ${Math.max(9, Math.round(10 * z))}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(stacks > 1 ? String(stacks) : label, x0 + bs / 2, by - 4 * z - bs / 2 + 4 * z);
          x0 += bs + 2;
        }
      }
      // 蓄力条（居合、冰封）
      if (u.cast) {
        const k = Math.min(1, u.cast.t / u.cast.dur);
        const cw = 56 * z, chh = 4 * z;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(px - cw / 2 - 1, by - 14 * z, cw + 2, chh + 2);
        ctx.fillStyle = '#ffe38a';
        ctx.fillRect(px - cw / 2, by - 13 * z, cw * k, chh);
      }
      // 钻地的尘土
      if (u.burrowed && Math.random() < 0.3) {
        this.addDust(u.x + (Math.random() - 0.5) * 20, u.y);
      }
    }

    drawProjectiles(eng) {
      const ctx = this.ctx, z = this.cam.zoom;
      for (const p of eng.projectiles) {
        const k = Math.min(1, p.t / p.dur);
        const homing = p.homing && p.tgt;
        const x1 = homing ? p.tgt.x : p.x1, y1 = homing ? p.tgt.y : p.y1;
        const wx = p.x0 + (x1 - p.x0) * k, wy = p.y0 + (y1 - p.y0) * k;
        const arc = p.sprite === 'bomb' ? 110 : 36;
        const h = (p.h0 || 0) + Math.sin(Math.PI * k) * arc;
        const gx = this.sx(wx), gy = this.sy(wy);
        const sx = gx, sy = gy - h * z;
        // 落影：飞得越高影子越淡
        if (h > 4) {
          ctx.fillStyle = `rgba(0,0,0,${Math.max(0.06, 0.2 - h / 600)})`;
          ellipse(ctx, gx, gy, 5 * z, 5 * z * K);
          ctx.fill();
        }
        // 屏幕上的运动方向（地面位移 + 抛物线的竖直分量）
        const vx = (x1 - p.x0) * z;
        const vy = (y1 - p.y0) * z * K - Math.PI * Math.cos(Math.PI * k) * arc * z;
        const ang = Math.atan2(vy, vx || 1);
        const meta = SH._projectiles[p.sprite];
        ctx.save();
        ctx.translate(sx, sy);
        if (!meta) {
          const color = ELEM[p.el] || '#ffffff';
          const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 9 * z);
          gr.addColorStop(0, '#ffffff');
          gr.addColorStop(0.4, color);
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(0, 0, 9 * z, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const im = SR.img(meta.src);
          if (im && im.complete) {
            const scale = (PROJ_SCALE[p.sprite] || 1) * z;
            const frame = meta.n > 1 ? Math.floor(p.t * 18) % meta.n : 0;
            if (p.sprite === 'bomb') ctx.rotate(p.t * 10);
            else ctx.rotate(ang);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(im, frame * meta.fw, 0, meta.fw, meta.fh, -meta.fw * scale / 2, -meta.fh * scale / 2, meta.fw * scale, meta.fh * scale);
          }
        }
        ctx.restore();
      }
    }

    drawFx(eng) {
      const ctx = this.ctx, z = this.cam.zoom;
      for (const f of eng.fx) {
        const k = Math.min(1, f.t / f.dur);
        const fade = 1 - k;
        const who = f.follow && f.follow.dead ? null : f.follow;
        const x = who ? who.x : f.x, y = who ? who.y : f.y;
        const sx = this.sx(x), sy = this.sy(y);
        ctx.save();
        if (f.kind === 'line' || f.kind === 'dash') {
          // 穿云箭的箭线 / 影袭的残影：从 (x, y) 到 (x2, y2)
          ctx.strokeStyle = f.kind === 'line' ? `rgba(232,255,214,${fade})` : `rgba(255,107,107,${fade})`;
          ctx.lineWidth = (f.kind === 'line' ? 4 : 5) * z;
          ctx.beginPath();
          ctx.moveTo(this.sx(f.x), this.sy(f.y) - 30 * z);
          ctx.lineTo(this.sx(f.x2), this.sy(f.y2) - 30 * z);
          ctx.stroke();
        } else if (f.kind === 'cone') {
          // 扇形：顶点在 (x, y)，朝 dir 方向，半宽随距离线性增长（侧向 = 前向 × tan）
          const t = Math.tan(f.halfDeg * Math.PI / 180);
          const far = this.sx(f.x + f.dir * f.len);
          const up = this.sy(f.y - f.len * t), dn = this.sy(f.y + f.len * t);
          const gr = ctx.createLinearGradient(sx, 0, far, 0);
          gr.addColorStop(0, `rgba(255,140,50,${0.8 * fade})`);
          gr.addColorStop(1, 'rgba(255,80,20,0)');
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(far, up);
          ctx.lineTo(far, dn);
          ctx.closePath();
          ctx.fill();
        } else if (f.kind === 'ring') {
          // 地面椭圆：rx = r * zoom，ry = r * zoom * K
          const s = 0.3 + k * 0.7;
          ctx.strokeStyle = f.color;
          ctx.globalAlpha = fade;
          ctx.lineWidth = 3 * z;
          ellipse(ctx, sx, sy, f.r * z * s, f.r * z * K * s);
          ctx.stroke();
        } else if (f.kind === 'shield') {
          ctx.strokeStyle = f.color;
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(f.t * 8);
          ctx.lineWidth = 2 * z;
          ctx.beginPath();
          ctx.arc(sx, sy - 40 * z, 46 * z, 0, Math.PI * 2);
          ctx.stroke();
        } else if (f.kind === 'rect') {
          // 夜叉斩击：地面上的一条矩形带，加一道刀光
          const x0 = this.sx(f.x), x1 = this.sx(f.x + f.dir * f.len);
          const hw = f.halfW * z * K;
          ctx.fillStyle = `rgba(255,255,255,${0.14 * fade})`;
          ctx.fillRect(Math.min(x0, x1), sy - hw, Math.abs(x1 - x0), hw * 2);
          ctx.strokeStyle = `rgba(255,255,255,${fade})`;
          ctx.lineWidth = 4 * z;
          ctx.beginPath();
          ctx.moveTo(this.sx(f.x + f.dir * 20), sy - 60 * z);
          ctx.lineTo(x1, sy - 60 * z - 14 * z * k);
          ctx.stroke();
        } else if (f.kind === 'charge') {
          ctx.fillStyle = `rgba(255,227,138,${0.35 * fade})`;
          ellipse(ctx, sx, sy - 30 * z, 36 * z, 20 * z);
          ctx.fill();
        } else if (f.kind === 'meteor') {
          // 陨石：从左上方斜着砸下来，落地后炸开
          const fall = Math.min(1, k / 0.45);
          const mx = sx - 120 * z * (1 - fall), my = sy - 260 * z * (1 - fall) - 30 * z;
          if (fall < 1) {
            const gr = ctx.createLinearGradient(mx, my, mx - 60 * z, my - 120 * z);
            gr.addColorStop(0, 'rgba(255,230,150,1)');
            gr.addColorStop(1, 'rgba(255,80,20,0)');
            ctx.strokeStyle = gr;
            ctx.lineWidth = 10 * z;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(mx - 60 * z, my - 120 * z);
            ctx.stroke();
            ctx.fillStyle = '#fff1b8';
            ctx.beginPath();
            ctx.arc(mx, my, 9 * z, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const e = (k - 0.45) / 0.55;
            ctx.globalAlpha = 1 - e;
            ctx.fillStyle = 'rgba(255,120,40,0.85)';
            ellipse(ctx, sx, sy, (20 + 70 * e) * z, (20 + 70 * e) * z * K);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,240,180,0.9)';
            ellipse(ctx, sx, sy, (10 + 30 * e) * z, (10 + 30 * e) * z * K);
            ctx.fill();
          }
        } else if (f.kind === 'darkwave') {
          // 深渊威压：一圈紫黑色的冲击波扫过整个画面（世界半径随时间扩张）
          const rw = 40 + k * Math.hypot(this.w, this.h) / z * 0.5;
          ctx.strokeStyle = `rgba(200,107,255,${0.9 * fade})`;
          ctx.lineWidth = 18 * z * fade + 2;
          ellipse(ctx, sx, sy, rw * z, rw * z * K);
          ctx.stroke();
          ctx.strokeStyle = `rgba(40,0,60,${0.7 * fade})`;
          ctx.lineWidth = 6;
          ellipse(ctx, sx, sy, rw * z * 0.85, rw * z * K * 0.85);
          ctx.stroke();
        } else if (f.kind === 'soul') {
          // 灵魂收割：一缕青白色的魂从身上飘起来
          const yy = sy - 40 * z - 120 * z * k;
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#c8f6ff';
          ellipse(ctx, sx + Math.sin(k * 12) * 6 * z, yy, 9 * z, 14 * z);
          ctx.fill();
          ctx.fillStyle = 'rgba(120,220,255,0.5)';
          ellipse(ctx, sx, yy + 18 * z, 5 * z, 12 * z);
          ctx.fill();
        } else if (f.kind === 'tint') {
          // 全屏染色闪一下
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = `rgba(${f.color},${0.35 * fade})`;
          ctx.fillRect(0, 0, this.cv.width, this.cv.height);
        }
        ctx.restore();
      }
    }

    drawDust(dt) {
      const ctx = this.ctx;
      const alive = [];
      for (const d of this.dust) {
        d.t += dt;
        if (d.t >= DUST_LIFE) continue;
        alive.push(d);
        const k = d.t / DUST_LIFE;
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(200,168,120,${0.6 * (1 - k)})`;
        ctx.fillRect(this.sx(d.x), this.sy(d.y) - d.t * 12, 4, 4);
      }
      this.dust = alive;
    }

    drawPopups(dt) {
      const ctx = this.ctx, z = this.cam.zoom;
      ctx.textAlign = 'center';
      const alive = [];
      for (const p of this.popups) {
        p.t += dt;
        if (p.t >= p.dur) continue;
        alive.push(p);
        const k = p.t / p.dur;
        // 飘字：从单位头顶往上飘（位置用 x, y 投影）
        const sx = this.sx(p.x) + p.jx * 0.4;
        const sy = this.sy(p.y) - 70 * z - p.rise * z * 0.5 - 40 * z * k - (p.jy || 0) * z;
        ctx.globalAlpha = Math.max(0, 1 - Math.pow(k, 2.5));
        ctx.font = `800 ${Math.max(9, Math.round(p.size * z))}px ${FONT}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(p.text, sx, sy);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, sx, sy);
      }
      ctx.globalAlpha = 1;
      this.popups = alive;
    }

    // 小地图：完整地图（x / w、y / h），水晶和单位，镜头视野框
    drawMinimap(canvas, eng) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(60, r.width), h = Math.max(30, r.height);
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.drawImage(this.mini, 0, 0, w, h);
      const mx = (x) => (x / MW) * w, my = (y) => (y / MH) * h;
      if (eng) {
        for (const c of eng.crystals) {
          g.fillStyle = SIDE_COLOR[c.side];
          g.fillRect(mx(c.x) - 3, my(c.y) - 3, 6, 6);
        }
        for (const u of eng.units) {
          if (!eng.alive(u)) continue;
          g.fillStyle = SIDE_COLOR[u.side];
          g.fillRect(mx(u.x) - 1, my(u.y) - 1, 2, 2);
        }
      }
      const c = this.cam;
      const hx = this.w / (2 * c.zoom), hy = this.h / (2 * c.zoom * K);
      const vx = mx(c.x - hx), vy = my(c.y - hy);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 1;
      g.strokeRect(vx + 0.5, vy + 0.5, mx(c.x + hx) - vx - 1, my(c.y + hy) - vy - 1);
    }
  }

  window.Render = { Renderer, K, MW, MH, ZOOM_INIT, clampZoom };
})();
