// 糯糯战记 · 画面：背景、兵线、水晶、单位、血条、状态角标、投射物、技能特效、飘字、小地图
// 只读引擎状态，不改任何数值。单位动画用 SpriteRender.drawHero，按单位自己的动画时钟播放。
(function () {
  const R = window.RULES;
  const SH = window.HD_SHEETS;
  const SR = window.SpriteRender;
  const C = window.Combat;
  const LANE = R.lane.length;

  const ELEM = { fire: '#ff8a3d', frost: '#7dd8ff', poison: '#8be05c', shadow: '#c86bff', holy: '#ffe38a' };
  const PROJ_SCALE = { arrow: 1.8, spear: 1.5, bomb: 0.55, spore: 1.0, fireball: 1.1 };
  const BADGES = [
    ['burn', '燃', '#ff7a3d'], ['chill', '寒', '#7dd8ff'], ['frozen', '冻', '#9fe8ff'],
    ['poison', '毒', '#8be05c'], ['vulnerable', '易', '#ff9ad5'], ['weaken', '衰', '#b59cff'],
    ['holyShield', '盾', '#ffe38a'], ['unyielding', '不', '#ffd166'], ['stun', '晕', '#ffd166'], ['root', '定', '#c9a46b'],
  ];
  const SIDE_COLOR = ['#6fd3ff', '#ff6b6b'];
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';

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

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = 1;
      this.h = 1;
      this.zoom = 1;
      this.groundY = 0;
      this.horizonY = 0;
      this.cam = { x: 240, manual: false, manualT: -99, target: 240 };
      this.popups = [];
      this.time = 0;
      this.hpSeen = new Map();   // 水晶上一帧的血量：用于受击闪烁
      this.flash = [0, 0];
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.cv.getBoundingClientRect();
      this.w = Math.max(320, r.width);
      this.h = Math.max(200, r.height);
      this.cv.width = Math.round(this.w * dpr);
      this.cv.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.zoom = Math.max(0.75, Math.min(2.0, this.h / 340));
      this.groundY = this.h * 0.8;
      this.horizonY = this.h * 0.5;
      this.clampCam();
    }

    sx(x) { return this.w / 2 + (x - this.cam.x) * this.zoom; }
    worldX(px) { return this.cam.x + (px - this.w / 2) / this.zoom; }
    halfView() { return this.w / (2 * this.zoom); }

    clampCam() {
      const half = this.halfView();
      if (half * 2 >= LANE) this.cam.x = LANE / 2;
      else this.cam.x = Math.max(half, Math.min(LANE - half, this.cam.x));
    }
    panPixels(px) {
      this.cam.x -= px / this.zoom;
      this.cam.manual = true;
      this.cam.manualT = this.time;
      this.clampCam();
    }
    // 没有手动拖动时，镜头跟着前线走
    followCamera(eng, dt) {
      if (this.time - this.cam.manualT > 3) {
        let lead0 = null, lead1 = null;
        for (const u of eng.units) {
          if (!eng.alive(u)) continue;
          if (u.side === 0 && (lead0 === null || u.x > lead0)) lead0 = u.x;
          if (u.side === 1 && (lead1 === null || u.x < lead1)) lead1 = u.x;
        }
        let target = 260;   // 没有单位时停在己方一侧，能看到自家水晶
        if (lead0 !== null && lead1 !== null) target = (lead0 + lead1) / 2;
        else if (lead0 !== null) target = Math.min(LANE - 300, lead0 + 200);
        else if (lead1 !== null) target = Math.max(300, lead1 - 200);
        this.cam.x += (target - this.cam.x) * Math.min(1, dt * 1.5);
      }
      this.clampCam();
    }

    // 把事件变成飘字和技能名
    ingest(events) {
      for (const ev of events) {
        if (ev.t === 'num') {
          this.addPopup(ev.x, ev.uy, String(ev.v), ev.color, 15, 0.9, 0);
        } else if (ev.t === 'react') {
          this.addPopup(ev.x, ev.uy, ev.text, ev.color, 18, 1.1, 22);
        } else if (ev.t === 'skill') {
          this.addPopup(ev.x, ev.uy, ev.name, ev.side === 0 ? '#bfe9ff' : '#ffc2c2', 17, 1.6, 40);
        }
      }
    }
    addPopup(x, uy, text, color, size, dur, rise) {
      this.popups.push({ x, uy, text, color, size, dur, rise, t: 0, jx: (Math.random() - 0.5) * 26, jy: Math.random() * 16 });
      if (this.popups.length > 160) this.popups.splice(0, this.popups.length - 160);
    }

    // ---------- 整帧 ----------
    draw(eng, dt) {
      this.time += dt;
      this.followCamera(eng, dt);
      this.drawBackground();
      this.drawCrystals(eng, dt);
      this.drawZones(eng);
      this.drawBodies(eng);
      const units = eng.units.slice().sort((a, b) => a.uy - b.uy);
      for (const u of units) this.drawUnit(u);
      this.drawProjectiles(eng);
      this.drawFx(eng);
      this.drawPopups(dt);
    }

    drawBackground() {
      const { ctx, w, h } = this;
      const g = ctx.createLinearGradient(0, 0, 0, this.horizonY + 40);
      g.addColorStop(0, '#1b2750');
      g.addColorStop(0.55, '#3b5a8c');
      g.addColorStop(1, '#c98f6a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, this.horizonY + 40);
      // 远山两层，视差
      const layer = (color, base, amp, freq, shift) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let px = 0; px <= w; px += 8) {
          const wx = (px - w / 2) / this.zoom + this.cam.x * shift;
          const y = base - amp * (0.5 + 0.5 * Math.sin(wx * freq) * Math.cos(wx * freq * 0.37 + 1.3));
          ctx.lineTo(px, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      };
      layer('#36507f', this.horizonY - 10, 90, 0.004, 0.25);
      layer('#27395f', this.horizonY + 10, 60, 0.007, 0.5);
      // 草地
      const gg = ctx.createLinearGradient(0, this.horizonY, 0, h);
      gg.addColorStop(0, '#4b7340');
      gg.addColorStop(1, '#2c4a2a');
      ctx.fillStyle = gg;
      ctx.fillRect(0, this.horizonY + 20, w, h - this.horizonY);
      // 兵线（土路）
      const roadTop = this.groundY - 14 * this.zoom, roadBot = this.groundY + 22 * this.zoom;
      ctx.fillStyle = '#7a6246';
      ctx.fillRect(0, roadTop, w, roadBot - roadTop);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, roadBot - 3, w, 3);
      // 路上的刻度（随镜头移动）
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      const step = 100;
      const first = Math.floor((this.cam.x - this.halfView()) / step) * step;
      for (let wx = first; wx <= this.cam.x + this.halfView(); wx += step) {
        ctx.fillRect(this.sx(wx), roadTop + 4, 2, roadBot - roadTop - 8);
      }
    }

    drawCrystals(eng, dt) {
      const ctx = this.ctx;
      for (let s = 0; s < 2; s++) {
        const c = eng.crystals[s];
        const cx = this.sx(s === 0 ? 60 : LANE - 60);
        const z = this.zoom;
        const base = this.groundY + 6 * z;
        const seen = this.hpSeen.get(s);
        if (seen !== undefined && c.hp < seen - 0.5) this.flash[s] = 0.15;
        this.hpSeen.set(s, c.hp);
        if (this.flash[s] > 0) this.flash[s] -= dt;
        const flashing = this.flash[s] > 0;
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2 + s);
        const col = SIDE_COLOR[s];
        // 底座
        ctx.fillStyle = '#3b3a46';
        ctx.fillRect(cx - 44 * z, base - 14 * z, 88 * z, 14 * z);
        ctx.fillStyle = '#55535f';
        ctx.fillRect(cx - 36 * z, base - 22 * z, 72 * z, 8 * z);
        // 水晶本体
        const top = base - 120 * z, mid = base - 66 * z;
        const hpFrac = Math.max(0, c.hp / c.maxHp);
        ctx.save();
        ctx.globalAlpha = c.hp <= 0 ? 0.3 : 1;
        const grd = ctx.createLinearGradient(cx, top, cx, base);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.35, col);
        grd.addColorStop(1, '#1f2a44');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx + 30 * z, mid);
        ctx.lineTo(cx + 18 * z, base - 22 * z);
        ctx.lineTo(cx - 18 * z, base - 22 * z);
        ctx.lineTo(cx - 30 * z, mid);
        ctx.closePath();
        ctx.fill();
        ctx.shadowColor = col;
        ctx.shadowBlur = (14 + 8 * pulse) * z;
        ctx.strokeStyle = flashing ? '#ffffff' : col;
        ctx.lineWidth = 2 * z;
        ctx.stroke();
        ctx.restore();
        // 血条
        const bw = 150 * z, bh = 10 * z;
        const bx = cx - bw / 2, by = top - 26 * z;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        ctx.fillStyle = s === 0 ? '#3ea6ff' : '#ff5a5a';
        ctx.fillRect(bx, by, bw * hpFrac, bh);
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.round(12 * z)}px ${FONT}`;
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
    }

    drawZones(eng) {
      const ctx = this.ctx;
      for (const z of eng.zones) {
        const cx = this.sx(z.x);
        const rr = z.r * this.zoom;
        const k = z.t / 5;
        ctx.fillStyle = `rgba(255,110,40,${0.12 + 0.05 * Math.sin(this.time * 6)})`;
        ctx.beginPath();
        ctx.ellipse(cx, this.groundY, rr, rr * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,150,60,${0.4 * k + 0.1})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        // 落下的火星
        for (let i = 0; i < 9; i++) {
          const ph = (this.time * 1.7 + i / 9) % 1;
          const px = cx + Math.sin(i * 12.9 + z.x) * rr * 0.9;
          const py = this.groundY - 150 * this.zoom * (1 - ph);
          ctx.fillStyle = `rgba(255,190,90,${0.8 * (1 - ph)})`;
          ctx.fillRect(px, py, 3, 3);
        }
      }
    }

    drawBodies(eng) {
      for (const b of eng.bodies) {
        const sh = SH[b.sheet];
        if (!sh) continue;
        const S = this.zoom * 1.3 * (b.small ? 0.7 : 1) * (b.scale || 1);
        const left = b.life - b.age;
        const alpha = Math.max(0, Math.min(1, left / (b.corpse ? 1.5 : 0.4)));
        SR.drawHero(this.ctx, { sheet: b.sheet, aspd: 1 }, 'death', b.age, this.sx(b.x), this.groundY + b.uy * this.zoom, S, b.side === 0 ? 1 : -1, { alpha });
      }
    }

    drawUnit(u) {
      const sh = SH[u.sheet];
      if (!sh) return;
      const ctx = this.ctx;
      const S = this.zoom * 1.3 * (u.small ? 0.7 : 1) * (u.def.scale || 1);
      const px = this.sx(u.x);
      const py = this.groundY + u.uy * this.zoom;
      const p = pose(u);
      if (u.uid === 'satan') {
        // 炼狱光环：脚下一圈呼吸的暗红火光，半径就是光环的 200
        const k = 0.5 + 0.5 * Math.sin(this.time * 3);
        const r = 200 * this.zoom;
        const g = ctx.createRadialGradient(px, py, 10, px, py, r);
        g.addColorStop(0, `rgba(255,80,30,${0.35 + 0.15 * k})`);
        g.addColorStop(1, 'rgba(120,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        if (u.invuln > 0) {
          ctx.strokeStyle = `rgba(255,200,120,${0.6 + 0.4 * k})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(px, py - sh.bodyH * S * 0.5, sh.bodyW * S * 0.7, sh.bodyH * S * 0.62, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      const alpha = p.opt.alpha == null ? 1 : p.opt.alpha;
      if (alpha > 0) SR.drawHero(ctx, u.def, p.state, p.t, px, py, S, u.dir, p.opt);
      if (u.bones) return;

      const top = py - sh.bodyH * S - 8 * this.zoom;
      // 冻结：脚下冰圈
      if (C.has(u, 'frozen')) {
        ctx.strokeStyle = 'rgba(159,232,255,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(px, py, sh.bodyW * S * 0.6, 4 * this.zoom, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 血条
      const bw = Math.max(24, sh.bodyW * S * 1.05), bh = 4 * this.zoom;
      const bx = px - bw / 2, by = top - bh;
      const frac = Math.max(0, Math.min(1, u.hp / u.maxHp));
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = SIDE_COLOR[u.side];
      ctx.fillRect(bx, by, bw * frac, bh);
      const sh2 = u.st.holyShield;
      if (sh2 && sh2.absorb > 0) {
        ctx.fillStyle = 'rgba(255,227,138,0.9)';
        ctx.fillRect(bx, by - 3 * this.zoom, Math.min(bw, bw * sh2.absorb / 200), 2 * this.zoom);
      }
      // 状态角标
      const badges = BADGES.filter(([id]) => C.has(u, id));
      if (badges.length) {
        const bs = 13 * this.zoom;
        const total = badges.length * (bs + 2);
        let x0 = px - total / 2;
        for (const [id, label, color] of badges) {
          const stacks = C.stacksOf(u, id);
          ctx.fillStyle = color;
          ctx.fillRect(x0, by - bs - 4 * this.zoom, bs, bs);
          ctx.fillStyle = '#111';
          ctx.font = `700 ${Math.round(10 * this.zoom)}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(stacks > 1 ? String(stacks) : label, x0 + bs / 2, by - 4 * this.zoom - bs / 2 + 4 * this.zoom);
          x0 += bs + 2;
        }
      }
      // 蓄力条（居合、冰封）
      if (u.cast) {
        const k = Math.min(1, u.cast.t / u.cast.dur);
        const cw = 56 * this.zoom, chh = 4 * this.zoom;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(px - cw / 2 - 1, by - 14 * this.zoom, cw + 2, chh + 2);
        ctx.fillStyle = '#ffe38a';
        ctx.fillRect(px - cw / 2, by - 13 * this.zoom, cw * k, chh);
      }
      // 钻地的尘土
      if (u.burrowed && Math.random() < 0.3) {
        this.addDust(px + (Math.random() - 0.5) * 20, py);
      }
    }

    addDust(x, y) {
      this.popups.push({ dust: true, x: this.worldX(x), px: x, py: y, t: 0, dur: 0.5, uy: 0, text: '', color: '#c8a878', size: 0, rise: 0, jx: 0 });
    }

    drawProjectiles(eng) {
      const ctx = this.ctx;
      for (const p of eng.projectiles) {
        const k = Math.min(1, p.t / p.dur);
        const x1 = p.homing && p.tgt ? p.tgt.x : p.x1;
        const wx = p.x0 + (x1 - p.x0) * k;
        const arc = p.sprite === 'bomb' ? 110 : 36;
        const h = p.h0 + Math.sin(Math.PI * k) * arc;
        const sx = this.sx(wx);
        const sy = this.groundY - h * this.zoom;
        const vx = (x1 - p.x0) * this.zoom;
        const vy = -Math.PI * Math.cos(Math.PI * k) * arc * this.zoom;
        const ang = Math.atan2(vy, vx || 1);
        const meta = SH._projectiles[p.sprite];
        ctx.save();
        ctx.translate(sx, sy);
        if (!meta) {
          const color = ELEM[p.el] || '#ffffff';
          const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 9 * this.zoom);
          gr.addColorStop(0, '#ffffff');
          gr.addColorStop(0.4, color);
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(0, 0, 9 * this.zoom, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const im = SR.img(meta.src);
          if (im && im.complete) {
            const scale = (PROJ_SCALE[p.sprite] || 1) * this.zoom;
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
      const ctx = this.ctx;
      const z = this.zoom;
      for (const f of eng.fx) {
        const k = Math.min(1, f.t / f.dur);
        const fade = 1 - k;
        const who = f.follow && f.follow.dead ? null : f.follow;
        const x = who ? who.x : f.x;
        const sx = this.sx(x);
        const sy = this.groundY + (who ? who.uy : f.uy || 0) * z;
        ctx.save();
        if (f.kind === 'line') {
          ctx.strokeStyle = `rgba(232,255,214,${fade})`;
          ctx.lineWidth = 4 * z;
          ctx.beginPath();
          ctx.moveTo(this.sx(f.x0), sy - 30 * z);
          ctx.lineTo(this.sx(f.x1), sy - 30 * z);
          ctx.stroke();
        } else if (f.kind === 'cone') {
          const len = f.len * z, d = f.dir;
          const gr = ctx.createLinearGradient(sx, 0, sx + d * len, 0);
          gr.addColorStop(0, `rgba(255,140,50,${0.8 * fade})`);
          gr.addColorStop(1, `rgba(255,80,20,0)`);
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 40 * z);
          ctx.lineTo(sx + d * len, sy - 90 * z * (0.4 + k));
          ctx.lineTo(sx + d * len, sy + 10 * z);
          ctx.closePath();
          ctx.fill();
        } else if (f.kind === 'ring') {
          ctx.strokeStyle = f.color;
          ctx.globalAlpha = fade;
          ctx.lineWidth = 3 * z;
          ctx.beginPath();
          ctx.ellipse(sx, this.groundY, f.r * z * (0.3 + k * 0.7), f.r * z * 0.3 * (0.3 + k * 0.7), 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (f.kind === 'shield') {
          ctx.strokeStyle = f.color;
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(f.t * 8);
          ctx.lineWidth = 2 * z;
          ctx.beginPath();
          ctx.arc(sx, sy - 40 * z, 46 * z, 0, Math.PI * 2);
          ctx.stroke();
        } else if (f.kind === 'dash') {
          ctx.strokeStyle = `rgba(255,107,107,${fade})`;
          ctx.lineWidth = 5 * z;
          ctx.beginPath();
          ctx.moveTo(this.sx(f.x0), sy - 30 * z);
          ctx.lineTo(this.sx(f.x1), sy - 30 * z);
          ctx.stroke();
        } else if (f.kind === 'charge') {
          ctx.fillStyle = `rgba(255,227,138,${0.35 * fade})`;
          ctx.beginPath();
          ctx.ellipse(sx, sy - 30 * z, 36 * z, 20 * z, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (f.kind === 'meteor') {
          // 陨石：从左上方斜着砸下来，落地后炸开
          const fall = Math.min(1, k / 0.45);
          const mx = sx - 120 * z * (1 - fall), my = this.groundY - 260 * z * (1 - fall) - 30 * z;
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
            ctx.beginPath();
            ctx.ellipse(sx, this.groundY - 20 * z, (20 + 70 * e) * z, (14 + 40 * e) * z, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,240,180,0.9)';
            ctx.beginPath();
            ctx.ellipse(sx, this.groundY - 20 * z, (10 + 30 * e) * z, (8 + 18 * e) * z, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (f.kind === 'darkwave') {
          // 深渊威压：一圈紫黑色的冲击波扫过整个画面
          const r = (40 + k * this.w * 1.2);
          ctx.strokeStyle = `rgba(200,107,255,${0.9 * fade})`;
          ctx.lineWidth = 18 * z * fade + 2;
          ctx.beginPath();
          ctx.ellipse(sx, this.groundY - 40 * z, r, r * 0.35, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = `rgba(40,0,60,${0.7 * fade})`;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.ellipse(sx, this.groundY - 40 * z, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (f.kind === 'soul') {
          // 灵魂收割：一缕青白色的魂从身上飘起来
          const yy = sy - 40 * z - 120 * z * k;
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#c8f6ff';
          ctx.beginPath();
          ctx.ellipse(sx + Math.sin(k * 12) * 6 * z, yy, 9 * z, 14 * z, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(120,220,255,0.5)';
          ctx.beginPath();
          ctx.ellipse(sx, yy + 18 * z, 5 * z, 12 * z, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (f.kind === 'tint') {
          // 全屏染色闪一下
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = `rgba(${f.color},${0.35 * fade})`;
          ctx.fillRect(0, 0, this.cv.width, this.cv.height);
        } else if (f.kind === 'slash') {
          const len = f.len * z, d = f.dir;
          ctx.strokeStyle = `rgba(255,255,255,${fade})`;
          ctx.lineWidth = 4 * z;
          ctx.beginPath();
          ctx.moveTo(sx + d * 20 * z, sy - 60 * z);
          ctx.lineTo(sx + d * len, sy - 60 * z - 14 * z * k);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    drawPopups(dt) {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      const alive = [];
      for (const p of this.popups) {
        p.t += dt;
        if (p.t >= p.dur) continue;
        alive.push(p);
        if (p.dust) {
          ctx.fillStyle = `rgba(200,168,120,${0.6 * (1 - p.t / p.dur)})`;
          ctx.fillRect(p.px, p.py - p.t * 12, 4, 4);
          continue;
        }
        const k = p.t / p.dur;
        const sx = this.sx(p.x) + p.jx * 0.4;
        const sy = this.groundY - (70 * this.zoom + p.uy * this.zoom) - p.rise * this.zoom * 0.5 - 40 * this.zoom * k - (p.jy || 0) * this.zoom;
        ctx.globalAlpha = Math.max(0, 1 - Math.pow(k, 2.5));
        ctx.font = `800 ${Math.round(p.size * this.zoom)}px ${FONT}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(p.text, sx, sy);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, sx, sy);
      }
      ctx.globalAlpha = 1;
      this.popups = alive;
    }

    // 小地图：兵线、单位、镜头范围
    drawMinimap(canvas, eng) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(120, r.width), h = Math.max(16, r.height);
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(10,14,28,0.7)';
      g.fillRect(0, 0, w, h);
      const mx = (x) => (x / LANE) * w;
      g.fillStyle = '#3ea6ff';
      g.fillRect(0, h / 2 - 2, 6, 4);
      g.fillStyle = '#ff5a5a';
      g.fillRect(w - 6, h / 2 - 2, 6, 4);
      for (const u of eng.units) {
        if (!eng.alive(u)) continue;
        g.fillStyle = SIDE_COLOR[u.side];
        g.fillRect(mx(u.x) - 1.5, h / 2 - 5 + (u.side ? 1 : -1), 3, 6);
      }
      const half = this.halfView();
      const vx = mx(this.cam.x - half), vw = mx(half * 2);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1;
      g.strokeRect(vx + 0.5, 1.5, Math.max(4, vw - 1), h - 3);
    }

  }

  window.Render = { Renderer, LANE };
})();
