// 英雄精灵渲染：帧动画 + 武器挂点 + 程序化攻击/受击动作
// 依赖 window.SPRITES = { 文件名(无扩展名): dataURL }
(function () {
  const IMG = {};
  function img(name) {
    if (!(name in IMG)) {
      const src = window.SPRITES[name];
      if (!src) { IMG[name] = null; return null; }
      const im = new Image();
      im.src = src;
      IMG[name] = im;
    }
    return IMG[name];
  }

  function frames(sprite, kind) {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const im = img(`${sprite}_${kind}_anim_f${i}`) || img(`${sprite}_anim_f${i}`);
      if (im) out.push(im);
    }
    return out;
  }

  // 白色受击闪光用的剪影缓存
  const FLASH = new Map();
  function flashOf(im) {
    if (FLASH.has(im)) return FLASH.get(im);
    if (!im.complete || !im.naturalWidth) return null;
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    FLASH.set(im, c);
    return c;
  }

  function defaultHand(w, h) {
    if (w >= 32) return [22, h - 10];
    if (h <= 16) return [11, 12];
    return [10, h - 8];
  }

  const ease = (p) => 1 - Math.pow(1 - p, 3);

  // 攻击动作曲线：p ∈ [0,1)，返回武器角度（度，0 = 竖直向上，正值向前倾）和身体前冲量（精灵像素）
  function attackPose(kind, p) {
    if (kind === 'bow') {
      const pull = p < 0.45 ? p / 0.45 : p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.2);
      return { angle: 0, lunge: -pull * 1.2, release: p >= 0.45 && p < 0.5, bow: true };
    }
    if (kind === 'magic') {
      const up = p < 0.4 ? ease(p / 0.4) : p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.35);
      return { angle: 20 - up * 35, lunge: 0, lift: up * 3, release: p >= 0.4 && p < 0.45 };
    }
    // melee / claw / throw：后摆蓄力 → 快速前劈 → 回位
    let angle, lunge;
    if (p < 0.4) { angle = 30 - ease(p / 0.4) * 90; lunge = 0; }
    else if (p < 0.55) { const q = (p - 0.4) / 0.15; angle = -60 + q * 175; lunge = q * (kind === 'claw' ? 5 : 2.5); }
    else { const q = (p - 0.55) / 0.45; angle = 115 - ease(q) * 85; lunge = (1 - ease(q)) * (kind === 'claw' ? 5 : 2.5); }
    return { angle, lunge, release: p >= 0.48 && p < 0.53, slash: p >= 0.43 && p < 0.62 ? (p - 0.43) / 0.19 : -1 };
  }

  /**
   * 画一个英雄。(x, y) 是脚底中心点，单位为画布像素；s 是像素放大倍数。
   * state: 'idle' | 'run' | 'attack' | 'hit' | 'death'；t: 秒；face: 1 朝右 / -1 朝左
   * 返回本帧是否到达出手点（用于发射投射物）和武器尖端位置。
   */
  function drawHero(ctx, hero, state, t, x, y, s, face = 1, opt) {
    if (hero.sheet) return drawSheetHero(ctx, hero, state, t, x, y, s, face, opt);
    const kind = state === 'run' ? 'run' : 'idle';
    const fr = frames(hero.sprite, kind);
    if (!fr.length || !fr[0].complete) return {};
    const fps = state === 'run' ? 10 : 6;
    let body = fr[Math.floor(t * fps) % fr.length];
    const w = body.naturalWidth, h = body.naturalHeight;

    let pose = { angle: 30, lunge: 0, lift: 0 };
    let flash = false, knock = 0;
    if (state === 'attack') {
      const period = Math.max(0.6, 1 / hero.aspd);
      pose = attackPose(hero.attack, (t % period) / period);
      body = fr[0];
    } else if (state === 'hit') {
      const p = (t % 1.0);
      flash = p < 0.12;
      knock = p < 0.3 ? -Math.sin((p / 0.3) * Math.PI) * 3 : 0;
      const hitIm = img(`${hero.sprite}_hit_anim_f0`);
      if (hitIm && p < 0.3) body = hitIm;
    } else if (state === 'run') {
      pose.angle = 45;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(face * s, s);
    ctx.translate(-w / 2 + pose.lunge + knock, -h);

    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h - 0.5, w * 0.36, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawBody = () => ctx.drawImage(flash ? (flashOf(body) || body) : body, 0, 0);
    let tip = null;
    const wim = hero.weapon ? img('weapon_' + hero.weapon) : null;
    const hand = hero.hand || defaultHand(w, h);

    // 素材里的武器和身体差不多高，按 0.65 倍挂在手上比例更自然
    const ws = hero.weaponScale || 0.65;
    const isBow = hero.attack === 'bow';
    const drawWeapon = () => {
      if (!wim || !wim.complete) return;
      const ww = wim.naturalWidth, wh = wim.naturalHeight;
      ctx.save();
      ctx.translate(hand[0], hand[1] - (pose.lift || 0));
      if (isBow) {
        ctx.scale(ws, ws);
        ctx.drawImage(wim, -ww / 2, -wh / 2);
        ctx.restore();
        tip = [hand[0] + 2, hand[1]];
        return;
      }
      ctx.rotate((pose.angle * Math.PI) / 180);
      ctx.scale(ws, ws);
      ctx.drawImage(wim, -ww / 2, -wh + 3);
      ctx.restore();
      const a = (pose.angle * Math.PI) / 180;
      const len = (wh - 3) * ws;
      tip = [hand[0] + Math.sin(a) * len, hand[1] - (pose.lift || 0) - Math.cos(a) * len];
    };

    drawBody();
    drawWeapon();

    // 徒手攻击的爪痕
    if (hero.attack === 'claw' && state === 'attack' && pose.slash >= 0) {
      ctx.strokeStyle = `rgba(255,240,200,${1 - pose.slash})`;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(w * 0.75, h * 0.55, 7 + i * 2.5, -1.1 + pose.slash * 0.6, 0.6 + pose.slash * 0.6);
        ctx.stroke();
      }
    }
    // 近战挥砍的刀光
    if (hero.attack === 'melee' && state === 'attack' && pose.slash >= 0 && wim) {
      const r = (wim.naturalHeight - 2) * ws;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - pose.slash)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hand[0], hand[1], r, -Math.PI / 2 - 0.9, -Math.PI / 2 + Math.min(1, pose.slash * 2) * 2.2);
      ctx.stroke();
    }
    ctx.restore();

    // 出手点（世界坐标）
    const src = tip || [hand[0] + 4, hand[1] - 4];
    const wx = x + face * ((src[0] - w / 2 + pose.lunge) * s);
    const wy = y + (src[1] - h) * s;
    return { release: !!pose.release, muzzle: [wx, wy] };
  }

  // ---------- 高清横版条带图角色 ----------
  // 素材自带待机/跑步/攻击/受击帧，按 HD_SHEETS 里的帧宽和脚底锚点来画
  // opt（游戏用，图鉴不传）：
  //   once: true     动画只播一次，停在最后一帧（死亡、受击）
  //   period: 秒     攻击动画按这段时长拉伸播完，出手帧 = release 帧
  //   flash: true    受击白闪
  //   alpha: 0~1     透明度（尸体淡出、地下蠕虫）
  function drawSheetHero(ctx, hero, state, t, x, y, s, face, opt) {
    const sh = window.HD_SHEETS[hero.sheet];
    const o = opt || {};
    const key = state === 'run' ? 'run' : state === 'attack' ? 'attack' : state === 'hit' ? 'hit' : state === 'death' ? 'death' : 'idle';
    let a = sh.anims[key];
    let idx, release = false;
    if (state === 'death' || (o.once && (state === 'hit' || state === 'attack'))) {
      idx = Math.min(a.n - 1, Math.floor(t * a.fps));
    } else if (o.period && state === 'attack') {
      idx = Math.min(a.n - 1, Math.floor((t / o.period) * a.n));
      release = idx === a.release;
    } else if (state === 'attack' || state === 'hit') {
      const dur = a.n / a.fps;
      const period = state === 'attack' ? Math.max(dur, 1 / hero.aspd) : Math.max(dur, 1.0);
      const local = t % period;
      if (local < dur) {
        idx = Math.min(a.n - 1, Math.floor(local * a.fps));
        release = state === 'attack' && idx === a.release;
      } else {
        a = sh.anims.idle;
        idx = Math.floor(t * a.fps) % a.n;
      }
    } else {
      idx = Math.floor(t * a.fps) % a.n;
    }
    const im = img(a.src);
    if (!im || !im.complete) return {};
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(face * s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 0, sh.bodyW * 0.45, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (o.flash) ctx.filter = 'brightness(2.4)';
    ctx.drawImage(im, idx * sh.fw, 0, sh.fw, sh.fh, -sh.cx, -sh.foot, sh.fw, sh.fh);
    ctx.restore();
    const mx = x + face * sh.bodyW * 0.55 * s;
    const my = y - sh.bodyH * 0.55 * s;
    return { release, muzzle: [mx, my] };
  }

  function spriteSize(hero) {
    if (hero.sheet) { const sh = window.HD_SHEETS[hero.sheet]; return [sh.bodyW, sh.bodyH]; }
    const im = frames(hero.sprite, 'idle')[0];
    return im && im.naturalWidth ? [im.naturalWidth, im.naturalHeight] : [16, 28];
  }

  function preload() {
    return Promise.all(Object.keys(window.SPRITES).map((k) => new Promise((res) => {
      const im = img(k);
      if (im.complete) res(); else { im.onload = res; im.onerror = res; }
    })));
  }

  window.SpriteRender = { drawHero, spriteSize, preload, img };
})();
