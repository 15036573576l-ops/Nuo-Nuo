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
  // 缩远能看到整张地图；默认比原来小一半多，兵不会一上来就很大。缩远时单位照常画精灵，不再变成圆点
  const ZOOM_MIN = 0.12, ZOOM_MAX = 1.8, ZOOM_INIT = 0.45;
  const DETAIL_ZOOM = 0.3;          // 低于它时省掉角标、蓄力条、冰圈这些小细节（精灵本身照常画）
  const MANUAL_PAUSE = 3;           // 手动操作后暂停跟随的秒数
  const FOLLOW_RATE = 2.5;          // 跟随时镜头追赶跟随目标的速度（每秒比例）
  const FOCUS_RATE = 0.8;           // 跟随目标本身的平滑速度（每秒比例）：单位进出战斗时目标不跳变
  const SWING_WEIGHT = 3;           // 跟随目标里，正在挥击的单位权重（其余单位为 1）
  const DUST_LIFE = 0.5;            // 钻地尘土的寿命（秒）
  const DUST_MAX = 160;             // 尘土单独的数量上限，和飘字分开计数，不会挤掉伤害数字
  const BAKE = 0.5;                 // 地面烘焙分辨率：一个世界像素画成 0.5 个画布像素
  const FLY_LIFT = 36;              // 飞行单位离地的高度（世界像素）
  const CULL = 90;                  // 视野外多留的余量（屏幕像素），精灵边缘不会突然消失
  const BODY_MAX = 400;             // 一帧最多画多少具尸体
  const byY = (a, b) => a.y - b.y;

  const ELEM = { fire: '#ff8a3d', frost: '#7dd8ff', poison: '#8be05c', shadow: '#c86bff', holy: '#ffe38a' };
  const PROJ_SCALE = { arrow: 1.8, spear: 1.5, bomb: 0.55, spore: 1.0, fireball: 1.1 };
  const BADGES = [
    ['burn', '燃', '#ff7a3d'], ['chill', '寒', '#7dd8ff'], ['frozen', '冻', '#9fe8ff'],
    ['poison', '毒', '#8be05c'], ['vulnerable', '易', '#ff9ad5'], ['weaken', '衰', '#b59cff'],
    ['holyShield', '盾', '#ffe38a'], ['unyielding', '不', '#ffd166'], ['stun', '晕', '#ffd166'], ['root', '定', '#c9a46b'],
  ];
  const SIDE_COLOR = ['#6fd3ff', '#ff6b6b'];
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';

  const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  // 椭圆路径（半径非负，避免 ctx.ellipse 抛错）
  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
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
  // 内容：冰面贴图（assets/ground/ice02.jpg，n4 作品，CC0，来自 OpenGameArt）平铺满图，再染成浅蓝；
  // 雪堆、冰裂纹、中线一条淡色的冰路、冰晶碎片和闪光；水晶底座画成冰台。
  // 写成生成器：每个 yield 处让出一小段时间（见 Renderer.bakeStep），不会一次卡住几百毫秒
  function* bakeGround(cv) {
    const g = cv.getContext('2d');
    g.setTransform(BAKE, 0, 0, BAKE, 0, 0);
    const rnd = seeded(7321);
    const hy = MH / 2;
    // 贴图还没解码完就等（每个 yield 让出一帧）；加载失败就用纯色底
    const img = new Image();
    img.src = window.ICE_TILE || '';
    while (!img.complete) yield;
    // 冰路的中心线：轻微起伏
    const roadY = (x) => hy + Math.sin(x * 0.0011) * 60 + Math.sin(x * 0.0037 + 1.3) * 18;
    const roadPath = (half) => {
      g.beginPath();
      for (let x = 0; x <= MW; x += 40) g.lineTo(x, roadY(x) - half);
      for (let x = MW; x >= 0; x -= 40) g.lineTo(x, roadY(x) + half);
      g.closePath();
    };

    // 底色 + 冰面贴图平铺，再染一层从上到下的浅蓝渐变
    g.fillStyle = '#bfe6fa';
    g.fillRect(0, 0, MW, MH);
    if (img.naturalWidth > 0) {
      const pat = g.createPattern(img, 'repeat');
      pat.setTransform(new DOMMatrix().scale(0.7));
      g.fillStyle = pat;
      g.fillRect(0, 0, MW, MH);
    }
    const tint = g.createLinearGradient(0, 0, 0, MH);
    tint.addColorStop(0, 'rgba(214,244,255,0.42)');
    tint.addColorStop(0.5, 'rgba(160,216,246,0.18)');
    tint.addColorStop(1, 'rgba(96,170,220,0.38)');
    g.fillStyle = tint;
    g.fillRect(0, 0, MW, MH);
    yield;
    // 大块的深浅：一片片冰面
    for (let i = 0; i < 40; i++) {
      if (i % 8 === 7) yield;
      const x = rnd() * MW, y = rnd() * MH, rad = 240 + rnd() * 420;
      const rg = g.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, rnd() < 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(40,110,170,0.14)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 雪堆：柔和的白色斑块
    for (let i = 0; i < 140; i++) {
      if (i % 35 === 34) yield;
      const x = rnd() * MW, y = rnd() * MH, rad = 30 + rnd() * 90;
      const rg = g.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, 'rgba(255,255,255,0.55)');
      rg.addColorStop(0.6, 'rgba(255,255,255,0.18)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    yield;
    // 冰裂纹：从一点出发的折线，亮边压一道暗边
    for (let i = 0; i < 90; i++) {
      if (i % 30 === 29) yield;
      let x = rnd() * MW, y = rnd() * MH, a = rnd() * Math.PI * 2;
      const n = 6 + Math.floor(rnd() * 10);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < n; k++) {
        a += (rnd() - 0.5) * 1.1;
        x += Math.cos(a) * (18 + rnd() * 26);
        y += Math.sin(a) * (18 + rnd() * 26);
        g.lineTo(x, y);
      }
      g.lineWidth = 2.2;
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.stroke();
      g.lineWidth = 0.9;
      g.strokeStyle = 'rgba(40,100,150,0.35)';
      g.stroke();
    }
    // 冰路：中线一条淡色的冰带，两侧压细亮线（不挡路，单位照样看得清）
    g.fillStyle = 'rgba(232,249,255,0.32)';
    roadPath(110);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.22)';
    roadPath(40);
    g.fill();
    g.strokeStyle = 'rgba(120,190,230,0.45)';
    g.lineWidth = 3;
    for (const off of [-110, 110]) {
      g.beginPath();
      for (let x = 0; x <= MW; x += 40) g.lineTo(x, roadY(x) + off);
      g.stroke();
    }
    yield;
    // 冰晶碎片：小三角，亮的一面朝左上，影子往右下
    for (let i = 0; i < 260; i++) {
      if (i % 65 === 64) yield;
      const x = rnd() * MW, y = rnd() * MH, s = 6 + rnd() * 12, a = rnd() * Math.PI * 2;
      if (Math.hypot(x - R.map.inset, y - hy) < 260 || Math.hypot(x - (MW - R.map.inset), y - hy) < 260) continue;
      const pts = [0, 1, 2].map((k) => {
        const t = a + k * 2.094 + (rnd() - 0.5) * 0.5, r = s * (0.6 + rnd() * 0.5);
        return [x + Math.cos(t) * r, y + Math.sin(t) * r];
      });
      const tri = (dx, dy) => {
        g.beginPath();
        g.moveTo(pts[0][0] + dx, pts[0][1] + dy);
        g.lineTo(pts[1][0] + dx, pts[1][1] + dy);
        g.lineTo(pts[2][0] + dx, pts[2][1] + dy);
        g.closePath();
        g.fill();
      };
      g.fillStyle = 'rgba(40,110,170,0.22)';
      tri(3, 3);
      g.fillStyle = rnd() < 0.5 ? 'rgba(235,250,255,0.85)' : 'rgba(170,220,250,0.85)';
      tri(0, 0);
    }
    yield;
    // 两座水晶的底座（冰台）：和水晶的碰撞圆同一个半径，单位站在圆边上正好贴着底座
    for (const px of [R.map.inset, MW - R.map.inset]) {
      const rr = R.map.crystalRadius;
      g.fillStyle = 'rgba(20,70,110,0.28)';
      g.beginPath(); g.arc(px + 6, hy + 8, rr, 0, Math.PI * 2); g.fill();
      const cg = g.createRadialGradient(px - rr * 0.3, hy - rr * 0.3, rr * 0.1, px, hy, rr);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.7, '#cdeeff');
      cg.addColorStop(1, '#8fd0f2');
      g.fillStyle = cg;
      g.beginPath(); g.arc(px, hy, rr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5aaee0'; g.lineWidth = 4; g.stroke();
    }
    // 闪光：细小的白点，画在地上（静态）
    for (let i = 0; i < 1200; i++) {
      if (i % 400 === 399) yield;
      const x = rnd() * MW, y = rnd() * MH;
      g.fillStyle = `rgba(255,255,255,${(0.35 + rnd() * 0.5).toFixed(2)})`;
      g.beginPath(); g.arc(x, y, 1 + rnd() * 1.6, 0, Math.PI * 2); g.fill();
    }
    yield;
    // 地图边缘压一圈冷色
    g.strokeStyle = 'rgba(30,80,120,0.5)';
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
      // 每帧复用的缓冲区：要画的东西、血条。不每帧新建几千个小对象
      this.pool = [];
      this.ents = [];
      this.bodyBuf = [];
      this.bars = [];             // 血条：x, y, w, h, frac, side 六个数一组
      this.base = 1;              // 画布的基础缩放 = 设备像素比 × 画质
      this.q = 1;                 // 画质（0.6 ~ 1）：显卡忙不过来时自动降分辨率，缓过来再升回去
      this.slowN = 0;
      this.fastN = 0;
      this.mmTick = 0;
      this.fontNow = '';
    }

    // 画质自适应。dt 是这一帧隔了多久，cpuMs 是这一帧脚本自己花的时间（逻辑 + 画图指令）。
    // 帧慢、但脚本没花多少时间，说明慢在显卡填像素上，降分辨率才有用；慢在脚本上就不降（降了也白糊）
    adapt(dt, cpuMs) {
      const ms = dt * 1000;
      if (ms > 24 && cpuMs < ms * 0.5) this.slowN++; else this.slowN = Math.max(0, this.slowN - 1);
      if (ms < 18.5) this.fastN++; else this.fastN = 0;
      if (this.slowN > 45 && this.q > 0.6) {
        this.q = Math.max(0.6, this.q - 0.1);
        this.slowN = 0; this.fastN = 0;
        this.resize();
      } else if (this.fastN > 360 && this.q < 1) {
        this.q = Math.min(1, this.q + 0.1);
        this.fastN = 0;
        this.resize();
      }
    }

    setFont(f) {
      if (this.fontNow !== f) { this.ctx.font = f; this.fontNow = f; }
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.q;
      const r = this.cv.getBoundingClientRect();
      // 还没排版好（0 宽或 0 高）就不动：否则缓冲区是 1 像素高，整张画面会被拉扁成一条
      if (r.width < 2 || r.height < 2) return;
      this.w = Math.max(320, r.width);
      this.h = r.height;                  // 按舞台的实际高度，不钳到 200（矮的舞台会把画面压扁）
      const pw = Math.round(this.w * dpr), ph = Math.round(this.h * dpr);
      // 尺寸没变就不碰 width / height（一赋值画布就清空重建，很贵）
      if (this.cv.width !== pw || this.cv.height !== ph) {
        this.cv.width = pw;
        this.cv.height = ph;
      }
      this.base = dpr;
      this.fontNow = '';
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
    // 拖动：镜头跟着手指走，所以手指往右，镜头往右，画面往左走（和 v1 的手感一样）
    dragCam(dx, dy) { this.moveCam(dx, dy); }
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
      // 超了就一次砍掉一批最旧的（不是每加一个就挪一遍数组）
      if (this.popups.length > 200) this.popups.splice(0, this.popups.length - 140);
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
      // 平滑开关先设成已知状态（画布一改尺寸，上下文的状态就全重置了），之后只在要变的时候才改
      this.smooth = false;
      this.ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < bodies.length; i++) this.drawBody(bodies[i]);
      this.drawShadows(ents);
      // 单位和水晶按 y 排序（远的先画）。缩得很远又有几千个时不排：精灵只有几个像素，谁压谁看不出来，
      // 不排的话顺序每帧都一样，也不会闪
      if (this.cam.zoom >= 0.2 || ents.length < 1500) ents.sort(byY);
      this.bars.length = 0;
      for (let i = 0; i < ents.length; i++) {
        const it = ents[i];
        if (it.k === 1) this.drawCrystal(it.o, it.sx, it.sy);
        else this.drawUnit(eng, it.o, it.sx, it.sy, it.gy);
      }
      this.drawBars();
      this.drawProjectiles(eng);
      this.drawFx(eng);
      this.drawBlizzard(eng);
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
      // 地图把整个画面盖满的时候底色看不见，不用画
      if (this.sx(0) <= 0 && this.sx(MW) >= w && this.sy(0) <= 0 && this.sy(MH) >= h) return;
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

    // 找出视野内要画的东西：单位和水晶进入排序列表，尸体单独一份。视野外的剔掉，视野内的全部画精灵
    collect(eng) {
      const z = this.cam.zoom, w = this.w, h = this.h;
      const pool = this.pool, ents = this.ents;
      let n = 0;
      const put = (k, o, y, gx, py, gy) => {
        let e = pool[n];
        if (!e) e = pool[n] = { k: 0, o: null, y: 0, sx: 0, sy: 0, gy: 0 };
        e.k = k; e.o = o; e.y = y; e.sx = gx; e.sy = py; e.gy = gy;
        ents[n++] = e;
      };
      for (const c of eng.crystals) {
        const gx = this.sx(c.x), gy = this.sy(c.y);
        put(1, c, c.y, gx, gy, gy);
      }
      const units = eng.units;
      // 缩远了又人多的时候，精灵只有几个像素大，一大群挤在一起互相盖住。把屏幕划成小格子，
      // 每格每个阵营只画一个（先到先得，顺序每帧一样所以不闪），看上去还是那一片人，要画的少好几倍。
      // 巨型和冰龙这种大个子不参与，照常全画
      const lod = z < DETAIL_ZOOM && units.length > 600;
      let occ = null, c = 1, cw = 0, ch = 0;
      if (lod) {
        c = Math.max(2.5, (z < 0.2 ? 20 : 12) * z);
        cw = Math.ceil(w / c) + 2;
        ch = Math.ceil(h / c) + 2;
        const size = cw * ch * 2;
        if (!this.occ || this.occ.length < size) this.occ = new Uint8Array(size);
        else this.occ.fill(0, 0, size);
        occ = this.occ;
      }
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        const gx = this.sx(u.x), gy = this.sy(u.y);
        const py = gy - (u.flying ? (u.def.lift || FLY_LIFT) * z : 0);
        const cull = Math.max(CULL, (u.def.cull || 0) * z);     // 冰龙的精灵很大，视野外要多留一截
        if (gx < -cull || gx > w + cull || py < -cull || py > h + cull) continue;
        if (occ && !u.giant && !u.def.cull) {
          const ix = ((gx / c) | 0) + 1, iy = ((py / c) | 0) + 1;
          if (ix >= 0 && ix < cw && iy >= 0 && iy < ch) {
            const k = (iy * cw + ix) * 2 + u.side;
            if (occ[k]) continue;
            occ[k] = 1;
          }
        }
        put(0, u, u.y, gx, py, gy);
      }
      ents.length = n;
      // 尸体：视野里最多画 BODY_MAX 具（从最新的往回数），一下子死了几千个也不会拖慢
      const bodies = this.bodyBuf;
      bodies.length = 0;
      const all = eng.bodies;
      for (let i = all.length - 1; i >= 0 && bodies.length < BODY_MAX; i--) {
        const b = all[i];
        const gx = this.sx(b.x), gy = this.sy(b.y);
        if (gx < -CULL || gx > w + CULL || gy < -CULL || gy > h + CULL) continue;
        bodies.push({ b, sx: gx, sy: gy });
      }
      return { ents, bodies };
    }

    // 所有单位的地面阴影一次画完：地面单位一条路径、飞行单位一条路径，各填一次（原来是一个单位填一次）
    drawShadows(ents) {
      const ctx = this.ctx, z = this.cam.zoom;
      if (z < 0.2 && ents.length > 600) return;     // 缩得很远、人又多：影子只有一两个像素，不画
      for (let pass = 0; pass < 2; pass++) {
        let any = false;
        ctx.beginPath();
        for (let i = 0; i < ents.length; i++) {
          const it = ents[i];
          if (it.k !== 0) continue;
          const u = it.o;
          if (u.burrowed || (u.flying ? 1 : 0) !== pass) continue;
          const rr = Math.max(4, (u.def.shadowR || u.radius) * z);
          ctx.moveTo(it.sx + rr, it.gy);
          ctx.ellipse(it.sx, it.gy, rr, rr * K, 0, 0, Math.PI * 2);
          any = true;
        }
        if (any) {
          ctx.fillStyle = pass ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.26)';
          ctx.fill();
        }
      }
    }

    // 血条也攒起来一次画完：底色一条路径，两个阵营各一条路径
    drawBars() {
      const ctx = this.ctx, b = this.bars;
      if (!b.length) return;
      ctx.beginPath();
      for (let i = 0; i < b.length; i += 6) ctx.rect(b[i] - 1, b[i + 1] - 1, b[i + 2] + 2, b[i + 3] + 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fill();
      for (let s = 0; s < 2; s++) {
        let any = false;
        ctx.beginPath();
        for (let i = 0; i < b.length; i += 6) {
          if (b[i + 5] !== s) continue;
          ctx.rect(b[i], b[i + 1], b[i + 2] * b[i + 4], b[i + 3]);
          any = true;
        }
        if (any) { ctx.fillStyle = SIDE_COLOR[s]; ctx.fill(); }
      }
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
      this.setFont(`700 ${Math.max(10, Math.round(12 * z))}px ${FONT}`);
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
      // 场上没有撒旦也没有冰龙就不用翻一遍单位
      const h0 = eng.has[0], h1 = eng.has[1];
      if (!h0.satan && !h1.satan && !h0.frostwing && !h1.frostwing) return;
      let shown = 0;
      for (const u of eng.units) {
        const ice = u.uid === 'frostwing';
        if ((u.uid !== 'satan' && !ice) || !eng.alive(u)) continue;
        if (++shown > 30) break;       // 批量出了一大群的时候只画前 30 个的光环
        const px = this.sx(u.x), gy = this.sy(u.y);
        if (ice && u.def.taunt) {
          // 嘲讽范围：一圈很淡的虚线
          ctx.save();
          ctx.setLineDash([14, 12]);
          ctx.lineDashOffset = -this.time * 20;
          ctx.strokeStyle = 'rgba(190,228,255,0.35)';
          ctx.lineWidth = 2;
          ellipse(ctx, px, gy, u.def.taunt * z, u.def.taunt * z * K);
          ctx.stroke();
          ctx.restore();
        }
        const k = 0.5 + 0.5 * Math.sin(this.time * 3);
        const r = (ice ? 420 : 200) * z;     // 光环半径：撒旦 200、冰龙 420，地面圆，走 K 压扁
        ctx.save();
        ctx.translate(px, gy);
        ctx.scale(1, K);
        const g = ctx.createRadialGradient(0, 0, 10, 0, 0, r);
        if (ice) {
          g.addColorStop(0, `rgba(228,239,255,${0.3 + 0.12 * k})`);
          g.addColorStop(0.55, `rgba(125,216,255,${0.16 + 0.06 * k})`);
          g.addColorStop(1, 'rgba(47,116,255,0)');
        } else {
        g.addColorStop(0, `rgba(255,80,30,${0.35 + 0.15 * k})`);
        g.addColorStop(1, 'rgba(120,0,0,0)');
        }
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
        if (zn.kind === 'blizzard') continue;      // 暴风雪是全屏的，见 drawBlizzard
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

    setSmooth(v) {
      if (this.smooth !== v) { this.ctx.imageSmoothingEnabled = v; this.smooth = v; }
    }

    drawBody(it) {
      const b = it.b, ctx = this.ctx, z = this.cam.zoom;
      const left = b.life - b.age;
      const alpha = Math.max(0, Math.min(1, left / (b.corpse ? 1.5 : 0.4)));
      if (alpha <= 0) return;
      const sh = SH[b.sheet];
      if (!sh) return;
      const S = z * 1.3 * (b.small ? 0.7 : 1) * (b.scale || 1);
      this.setSmooth(!!sh.smooth);
      ctx.globalAlpha = alpha;
      SR.drawSheetFast(ctx, sh, 1, 'death', b.age, it.sx, it.sy, S, b.side === 0 ? 1 : -1, false, 0, false, this.base);
      ctx.setTransform(this.base, 0, 0, this.base, 0, 0);
      ctx.globalAlpha = 1;
    }

    // 单位：精灵照常画。缩远时（DETAIL_ZOOM 以下）省掉角标、蓄力条、冰圈、尘土这些小细节。
    // 影子在 drawShadows 里统一画过了，血条只是记下来，由 drawBars 统一画
    drawUnit(eng, u, px, py, gy) {
      const sh = SH[u.sheet];
      if (!sh) return;
      const ctx = this.ctx, z = this.cam.zoom, def = u.def;
      const detail = z >= DETAIL_ZOOM;
      const S = z * 1.3 * (u.small ? 0.7 : 1) * (def.scale || 1);
      if ((u.uid === 'satan' || def.revive) && u.invuln > 0) {
        // 不灭 / 冰晶重生的无敌期间：身上一圈光环（地面光环见 drawAuras）
        const k = 0.5 + 0.5 * Math.sin(this.time * 3);
        ctx.strokeStyle = def.revive ? `rgba(200,235,255,${0.6 + 0.4 * k})` : `rgba(255,200,120,${0.6 + 0.4 * k})`;
        ctx.lineWidth = 3;
        ellipse(ctx, px, py - sh.bodyH * S * 0.5, sh.bodyW * S * 0.7, sh.bodyH * S * 0.62);
        ctx.stroke();
      }
      // 动画状态：攻击按 swing 的时钟，受击只播一次；冰龙的拍击用振翼的动作，身体往目标那边扑一下
      let state = 'idle', t = u.clock, alpha = 1, once = false, period = 0, flash = false;
      const sw = u.swing;
      if (u.bones) { state = 'death'; t = 10; alpha = 0.95; }
      else if (u.hitT < 0.22 && !def.noFlinch) { state = 'hit'; t = u.hitT; once = true; flash = true; }
      else if (sw) {
        if (sw.slap) {
          state = 'run';
          const k = Math.sin(Math.PI * Math.min(1, sw.t / sw.period));
          px += u.dir * 80 * z * k;
          py -= 26 * z * k;
        } else { state = 'attack'; t = sw.t; period = sw.period; }
      }
      else if (u.charge) state = 'run';
      else if (u.burrowed) { state = 'run'; alpha = 0.32; }
      else if (u.moving) state = 'run';

      this.setSmooth(!!sh.smooth);
      if (alpha !== 1) ctx.globalAlpha = alpha;
      SR.drawSheetFast(ctx, sh, def.aspd, state, t, px, py, S, u.dir, once, period, flash, this.base);
      ctx.setTransform(this.base, 0, 0, this.base, 0, 0);
      if (alpha !== 1) ctx.globalAlpha = 1;
      if (u.bones) return;

      const top = py - sh.bodyH * S - 8 * z;
      // 血条：近看时全部画；缩远时只画受伤的（满血的一排血条叠在一起会变成一片色块，盖住精灵）
      // 缩远时血条跟着精灵缩小、压细：血条是最后统一画在最上面的，太粗会把人群盖住
      const bw = detail ? Math.max(24, sh.bodyW * S * 1.05) : Math.max(6, sh.bodyW * S * 0.9), bh = detail ? Math.max(2, 4 * z) : 1.5;
      const bx = px - bw / 2, by = top - bh;
      const frac = u.hp >= u.maxHp ? 1 : Math.max(0, u.hp / u.maxHp);
      if (detail || frac < 1) this.bars.push(bx, by, bw, bh, frac, u.side);
      // 下面这些只有身上挂着状态或者在蓄力才会有，先看一眼有没有，大多数单位到这里就结束了
      let hasSt = false;
      for (const id in u.st) { hasSt = true; break; }
      if (hasSt) {
        // 冻结：脚下冰圈
        if (detail && C.has(u, 'frozen')) {
          ctx.strokeStyle = 'rgba(159,232,255,0.8)';
          ctx.lineWidth = 2;
          ellipse(ctx, px, gy, sh.bodyW * S * 0.6, 4 * z);
          ctx.stroke();
        }
        const shield = u.st.holyShield;
        if (shield && shield.absorb > 0) {
          ctx.fillStyle = 'rgba(255,227,138,0.9)';
          ctx.fillRect(bx, by - 3 * z, Math.min(bw, bw * shield.absorb / 200), 2 * z);
        }
        // 状态角标
        if (detail) {
          let cnt = 0;
          for (const [id] of BADGES) if (C.has(u, id)) cnt++;
          if (cnt) {
            const bs = Math.max(10, 13 * z);
            let x0 = px - cnt * (bs + 2) / 2;
            this.setFont(`700 ${Math.max(9, Math.round(10 * z))}px ${FONT}`);
            ctx.textAlign = 'center';
            for (const [id, label, color] of BADGES) {
              if (!C.has(u, id)) continue;
              const stacks = C.stacksOf(u, id);
              ctx.fillStyle = color;
              ctx.fillRect(x0, by - bs - 4 * z, bs, bs);
              ctx.fillStyle = '#111';
              ctx.fillText(stacks > 1 ? String(stacks) : label, x0 + bs / 2, by - 4 * z - bs / 2 + 4 * z);
              x0 += bs + 2;
            }
          }
        }
      }
      // 蓄力条（居合、冰封）
      if (detail && u.cast) {
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
        if (h > 4 && z >= DETAIL_ZOOM) {
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
        } else if (f.kind === 'frostbeam') {
          // 冰霜吐息：从龙嘴（离地 h）到落点的一道冰雾，外层淡蓝、芯是白的
          const x0 = this.sx(f.x), y0 = this.sy(f.y) - f.h * z;
          const x1 = this.sx(f.x2), y1 = this.sy(f.y2) - 12 * z;
          const grow = Math.min(1, k / 0.25);
          const ex = x0 + (x1 - x0) * grow, ey = y0 + (y1 - y0) * grow;
          ctx.lineCap = 'round';
          for (const [wd, col] of [[f.w * 1.8, `rgba(125,200,255,${0.28 * fade})`], [f.w, `rgba(190,228,255,${0.5 * fade})`], [f.w * 0.4, `rgba(255,255,255,${0.9 * fade})`]]) {
            ctx.strokeStyle = col;
            ctx.lineWidth = Math.max(1, wd * z);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          }
        } else if (f.kind === 'frostburst') {
          // 吐息落点：地面上一片冰霜炸开，边上竖起一圈冰刺
          const rr = f.r * (0.35 + 0.65 * Math.min(1, k / 0.3)) * z;
          const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, rr));
          gr.addColorStop(0, `rgba(255,255,255,${0.75 * fade})`);
          gr.addColorStop(0.5, `rgba(160,215,255,${0.45 * fade})`);
          gr.addColorStop(1, 'rgba(47,116,255,0)');
          ctx.save();
          ctx.translate(sx, sy);
          ctx.scale(1, K);
          ctx.translate(-sx, -sy);
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(1, rr), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = `rgba(228,243,255,${0.9 * fade})`;
          const n = Math.max(6, Math.min(16, Math.round(f.r / 18)));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + f.x * 0.01;
            const bx = sx + Math.cos(a) * rr * 0.7, by = sy + Math.sin(a) * rr * 0.7 * K;
            const hh = (18 + 26 * ((i * 7) % 5) / 4) * z * Math.sin(Math.PI * Math.min(1, k * 1.4));
            ctx.beginPath();
            ctx.moveTo(bx - 4 * z, by);
            ctx.lineTo(bx + 4 * z, by);
            ctx.lineTo(bx + Math.cos(a) * 3 * z, by - hh);
            ctx.closePath();
            ctx.fill();
          }
        } else if (f.kind === 'slap') {
          // 拍击：目标身上三道爪痕，脚下一圈冰霜炸开
          const rr = f.r * (0.4 + 0.6 * k) * z;
          ctx.strokeStyle = `rgba(200,232,255,${0.7 * fade})`;
          ctx.lineWidth = 4 * z * fade + 1;
          ellipse(ctx, sx, sy, rr, rr * K);
          ctx.stroke();
          ctx.lineCap = 'round';
          ctx.strokeStyle = `rgba(255,255,255,${fade})`;
          ctx.lineWidth = Math.max(1.5, 7 * z);
          const sweep = Math.min(1, k / 0.35);
          for (let i = -1; i <= 1; i++) {
            const ox = i * 34 * z;
            ctx.beginPath();
            ctx.moveTo(sx + ox - f.dir * 70 * z, sy - 170 * z);
            ctx.lineTo(sx + ox - f.dir * 70 * z + f.dir * 140 * z * sweep, sy - 170 * z + 150 * z * sweep);
            ctx.stroke();
          }
        } else if (f.kind === 'gust') {
          // 振翼：从龙身上往外扩的两圈冰晶气浪，带一圈被吹散的冰尘
          for (const [lag, wd, col] of [[0, 16, '200,230,255'], [0.18, 7, '255,255,255']]) {
            const kk = Math.max(0, Math.min(1, (k - lag) / (1 - lag)));
            if (kk <= 0) continue;
            const rr = f.r * (1 - Math.pow(1 - kk, 2.2)) * z;
            ctx.strokeStyle = `rgba(${col},${0.8 * (1 - kk)})`;
            ctx.lineWidth = wd * z * (1 - kk) + 1;
            ellipse(ctx, sx, sy, rr, rr * K);
            ctx.stroke();
          }
          const rr = f.r * (1 - Math.pow(1 - k, 2.2)) * z;
          ctx.fillStyle = `rgba(228,243,255,${0.9 * fade})`;
          for (let i = 0; i < 46; i++) {
            const a = i * 2.399 + f.x;
            const q = 0.82 + 0.18 * ((i * 13) % 7) / 6;
            const s2 = (2 + (i % 3)) * Math.max(0.5, z * 1.6);
            ctx.fillRect(sx + Math.cos(a) * rr * q, sy + Math.sin(a) * rr * q * K - (20 + (i % 5) * 14) * z * fade, s2, s2);
          }
        } else if (f.kind === 'icelane') {
          // 咆哮：贯穿全图的一条极寒吐息。先是从龙嘴冲出去的光柱，然后地上留一条慢慢褪掉的冰带
          const x0 = this.sx(f.x), x1 = this.sx(f.x2);
          const hw = f.halfW * z * K;
          const grow = Math.min(1, k / 0.18);
          const ex = x0 + (x1 - x0) * grow;
          const lo = Math.min(x0, ex), wd = Math.abs(ex - x0);
          const gr = ctx.createLinearGradient(0, sy - hw, 0, sy + hw);
          gr.addColorStop(0, 'rgba(47,116,255,0)');
          gr.addColorStop(0.5, `rgba(190,228,255,${0.55 * fade})`);
          gr.addColorStop(1, 'rgba(47,116,255,0)');
          ctx.fillStyle = gr;
          ctx.fillRect(lo, sy - hw, wd, hw * 2);
          const core = Math.max(0, 1 - k / 0.55);
          if (core > 0) {
            // 光柱：从龙嘴斜着压到前方 520 处的地面，再贴着冰带中线一路冲到头
            const dir = x1 >= x0 ? 1 : -1;
            const tx = x0 + dir * Math.min(520 * z, Math.abs(ex - x0));
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const [w2, col] of [[170, `rgba(125,200,255,${0.3 * core})`], [90, `rgba(200,232,255,${0.55 * core})`], [34, `rgba(255,255,255,${0.95 * core})`]]) {
              ctx.strokeStyle = col;
              ctx.lineWidth = Math.max(1, w2 * z);
              ctx.beginPath();
              ctx.moveTo(x0, sy - f.h * z);
              ctx.lineTo(tx, sy);
              ctx.lineTo(ex, sy);
              ctx.stroke();
            }
          }
          // 冰带上的碎冰
          ctx.fillStyle = `rgba(240,248,255,${0.85 * fade})`;
          const cnt = Math.min(90, Math.floor(wd / 14));
          for (let i = 0; i < cnt; i++) {
            const u2 = ((i * 0.6180339) % 1), v2 = ((i * 0.3819) % 1) * 2 - 1;
            const s2 = (2 + (i % 4)) * Math.max(0.5, z * 1.5);
            ctx.fillRect(lo + u2 * wd, sy + v2 * hw * 0.9 - (i % 6) * 5 * z * fade, s2, s2);
          }
        } else if (f.kind === 'tint') {
          // 全屏染色闪一下
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = `rgba(${f.color},${0.35 * fade})`;
          ctx.fillRect(0, 0, this.cv.width, this.cv.height);
        }
        ctx.restore();
      }
    }

    // 暴风雪：屏幕空间的一层。整屏偏冷的雾色 + 顺风斜着刮的雪线，开始和结束各用半秒淡入淡出
    drawBlizzard(eng) {
      const zn = eng.zones.find((q) => q.kind === 'blizzard');
      if (!zn) return;
      const ctx = this.ctx, w = this.w, h = this.h;
      const k = Math.max(0, Math.min(1, (zn.dur - zn.t) / 0.5, zn.t / 0.5));
      ctx.save();
      ctx.fillStyle = `rgba(150,190,255,${0.2 * k})`;
      ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, 'rgba(228,239,255,0)');
      g.addColorStop(1, `rgba(228,239,255,${0.5 * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.lineCap = 'round';
      const t = this.time;
      for (let i = 0; i < 150; i++) {
        const sp = 0.9 + ((i * 37) % 11) / 8;                       // 每条雪线自己的速度
        const ph = (i * 0.6180339 + t * sp * 0.9) % 1;
        const lane = (i * 0.3819660 + Math.floor(i * 0.6180339 + t * sp * 0.9) * 0.137) % 1;
        const x = (1.25 - ph * 1.5) * w, y = (lane * 1.3 - 0.15) * h + ph * h * 0.28;
        const len = (26 + (i % 5) * 16) * sp;
        ctx.strokeStyle = `rgba(255,255,255,${(0.25 + 0.5 * ((i * 7) % 5) / 4) * k})`;
        ctx.lineWidth = 1 + (i % 3) * 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y - len * 0.19);
        ctx.stroke();
      }
      ctx.restore();
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
        if (sx < -60 || sx > this.w + 60 || sy < -20 || sy > this.h + 20) continue;   // 画面外的不画
        ctx.globalAlpha = Math.max(0, 1 - Math.pow(k, 2.5));
        this.setFont(`800 ${Math.max(9, Math.round(p.size * z))}px ${FONT}`);
        // 不描边（描边字很贵）：先画一份往右下偏一个像素的深色字当底
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillText(p.text, sx + 1, sy + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, sx, sy);
      }
      ctx.globalAlpha = 1;
      this.popups = alive;
    }

    // 小地图：完整地图（x / w、y / h），水晶和单位，镜头视野框
    drawMinimap(canvas, eng) {
      if ((this.mmTick++ & 3) !== 0) return;       // 每 4 帧画一次
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
        const units = eng.units, kx = w / MW, ky = h / MH;
        for (let s = 0; s < 2; s++) {
          g.beginPath();
          for (let i = 0; i < units.length; i++) {
            const u = units[i];
            if (u.side !== s || u.dead || u.hp <= 0) continue;
            g.rect(u.x * kx - 1, u.y * ky - 1, 2, 2);
          }
          g.fillStyle = SIDE_COLOR[s];
          g.fill();
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
