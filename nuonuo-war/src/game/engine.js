// 糯糯战记 · 对局引擎：二维战场、空间网格、固定步长主循环、经济与出兵、索敌与移动、分离推挤、胜负
// 纯逻辑，不碰 DOM / canvas。渲染和界面只读这里的状态，通过 spawn() 下单。
// 坐标：世界像素 x ∈ [0, map.w]，y ∈ [0, map.h]。side 0 玩家在左、朝右走；side 1 电脑在右、朝左走。
(function () {
  const R = window.RULES;
  const SH = window.HD_SHEETS;
  const C = window.Combat;
  const DT = 1 / 30;
  const CELL = 96;          // 空间网格的格子大小
  const MAX_R = 40;         // 单位半径上限，查询范围要多留这一截
  const REACH = 4;          // 攻击距离的余量（中心到中心）
  const RETARGET = 0.25;    // 追击目标的重新计算间隔（秒）
  const GROUP_GAP = 22;     // 同一组单位在出兵点附近的错开间距

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function animOf(sheet, name) {
    const sh = SH[sheet];
    return sh ? sh.anims[name] : null;
  }
  function deathDur(sheet) {
    const a = animOf(sheet, 'death');
    return a ? a.n / a.fps : 0.8;
  }
  // 单位碰撞半径：max(12, min(40, 身体宽 × 0.45))；巨型单位至少 30
  function unitRadius(def) {
    const sh = SH[def.sheet];
    let r = sh ? Math.max(12, Math.min(MAX_R, sh.bodyW * 0.45)) : 20;
    if (def.tags.indexOf('giant') >= 0) r = Math.max(30, r);
    return r;
  }
  function keyOf(cx, cy) { return (cx + 4096) * 8192 + (cy + 4096); }

  // 相邻格子的方向：右、右下、下、左下（配上它们的反方向正好是 8 邻格），用来每对只访问一次
  const FWD = [1, 0, 1, 1, 0, 1, -1, 1];

  // 空间哈希网格：只存单位引用。每步开始重建；分离推挤前后各重建一次。
  class Grid {
    constructor(cell = CELL) {
      this.cell = cell;
      this.map = new Map();
      this.used = [];           // 本轮有单位的格子（桶），clear 时只清这些
      this.ucx = [];            // 与 used 一一对应的格子坐标
      this.ucy = [];
    }
    clear() {
      for (const b of this.used) b.length = 0;
      this.used.length = 0;
      this.ucx.length = 0;
      this.ucy.length = 0;
    }
    insert(u) {
      const cx = Math.floor(u.x / this.cell), cy = Math.floor(u.y / this.cell);
      const k = keyOf(cx, cy);
      let b = this.map.get(k);
      if (!b) { b = []; this.map.set(k, b); }
      if (b.length === 0) { this.used.push(b); this.ucx.push(cx); this.ucy.push(cy); }
      b.push(u);
    }
    // 所有中心距离 ≤ r 的单位（不过滤阵营和状态）
    near(x, y, r, out = []) {
      const c = this.cell, r2 = r * r;
      const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
      const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const b = this.map.get(keyOf(cx, cy));
          if (!b) continue;
          for (let i = 0; i < b.length; i++) {
            const u = b[i];
            const dx = u.x - x, dy = u.y - y;
            if (dx * dx + dy * dy <= r2) out.push(u);
          }
        }
      }
      return out;
    }
    // 中心落在矩形 [x0, x1] × [y0, y1] 内的单位
    box(x0, x1, y0, y1, out = []) {
      const c = this.cell;
      const cx1 = Math.floor(x1 / c), cy1 = Math.floor(y1 / c);
      for (let cx = Math.floor(x0 / c); cx <= cx1; cx++) {
        for (let cy = Math.floor(y0 / c); cy <= cy1; cy++) {
          const b = this.map.get(keyOf(cx, cy));
          if (!b) continue;
          for (let i = 0; i < b.length; i++) {
            const u = b[i];
            if (u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) out.push(u);
          }
        }
      }
      return out;
    }
  }

  // 参与分离推挤的单位：地面、不是巨像、不在钻地、不是骨堆、活着
  function solid(eng, u) {
    return !u.flying && !u.ghost && !u.burrowed && !u.bones && eng.alive(u);
  }

  class Engine {
    constructor(opts = {}) {
      this.rng = mulberry32(opts.seed == null ? (Math.random() * 2147483647) | 0 : opts.seed);
      this.time = 0;
      this.acc = 0;
      this.speed = 1;
      this.ended = false;
      this.winner = null;
      this.W = R.map.w;
      this.H = R.map.h;
      this.crystals = [0, 1].map((s) => ({
        isCrystal: true, side: s, x: s === 0 ? R.map.inset : R.map.w - R.map.inset, y: R.map.h / 2,
        radius: R.map.crystalRadius, hp: R.map.crystalHp, maxHp: R.map.crystalHp, cd: 0, st: {},
      }));
      this.sides = [0, 1].map(() => ({
        gold: R.economy.startGold, supplyUsed: 0, cdLeft: {}, incomeMul: 1, spawned: {}, manualCd: [0, 0, 0],
      }));
      // 作弊开关：只由界面的作弊菜单修改，默认全关，不影响正常对局和无头测试
      this.cheats = {
        infiniteGold: false, noCd: false, noSupply: false, aiOff: false, satanNoCd: false,
        incomeMul: [1, 1], dmgMul: [1, 1], invuln: [false, false], godMode: [false, false],
      };
      this.units = [];
      this.bodies = [];        // 尸体（corpse=true，会被摩尔德拉起）和召唤物的消散身影（corpse=false）
      this.projectiles = [];
      this.zones = [];
      this.fx = [];
      this.events = [];
      this.pending = [];       // 本 tick 内死亡的单位，统一在 tick 末尾结算
      this.ais = [];
      this.uidSeq = 0;
      this.grid = new Grid(CELL);
      // 每步重建网格时顺便统计：各阵营存活数、正在挥击数，以及远程单位列表（蝙蝠追击用）
      this.stat = { alive: [0, 0], swing: [0, 0] };
      this.rangedBy = [[], []];
      this.pairBuf = [];        // 分离推挤用的重叠对缓冲区（复用，避免每步分配）
    }

    // ---------- 事件与特效（给渲染和界面用） ----------
    emit(ev) {
      this.events.push(ev);
      if (this.events.length > 600) this.events.splice(0, this.events.length - 400);
    }
    drainEvents() {
      const out = this.events;
      this.events = [];
      return out;
    }
    addFx(f) {
      f.t = 0;
      this.fx.push(f);
    }
    addZone(z) {
      this.zones.push(z);
    }

    // ---------- 查询 ----------
    alive(u) {
      return !u.dead && !u.bones && !u.pendingDeath && u.hp > 0;
    }
    targetable(u) {
      return this.alive(u) && !u.burrowed;
    }
    count(side, uid) {
      let n = 0;
      for (const u of this.units) if (u.side === side && u.uid === uid && this.alive(u)) n++;
      return n;
    }
    goalOf(side) {
      return this.crystals[1 - side];
    }
    // 王之威仪：200 范围内同阵营存活的雷克斯
    rexAura(u) {
      return this.unitsNear(u.x, u.y, 200).some((e) => e.uid === 'rex' && e.side === u.side && this.alive(e));
    }
    // 盾墙：布朗身后 120 范围内（含布朗自己）的友军受到的穿刺伤害 -70%
    brownShield(tgt) {
      return this.unitsNear(tgt.x, tgt.y, 200).some((b) => b.uid === 'brown' && b.side === tgt.side &&
        b.shieldWallT > 0 && this.alive(b) && C.shieldCovers(b, tgt));
    }
    // 中心距离 ≤ r 的存活单位或骨堆（任意阵营，空间网格查询）
    unitsNear(x, y, r) {
      const out = this.grid.near(x, y, r);
      let n = 0;
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (this.alive(u) || u.bones) out[n++] = u;
      }
      out.length = n;
      return out;
    }
    // 矩形范围内的存活单位或骨堆（任意阵营）
    unitsBox(x0, x1, y0, y1) {
      const out = this.grid.box(x0, x1, y0, y1);
      let n = 0;
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (this.alive(u) || u.bones) out[n++] = u;
      }
      out.length = n;
      return out;
    }
    // u 的敌方、可攻击、中心距离 ≤ r
    enemiesNear(u, r) {
      return this.unitsNear(u.x, u.y, r).filter((e) => e.side !== u.side && this.targetable(e));
    }
    // 中心距离 ≤ u.range + u.radius + t.radius + 4（+ pad）：t 可以是水晶
    inReach(u, t, pad = 0) {
      const r = u.range + u.radius + t.radius + REACH + pad;
      const dx = t.x - u.x, dy = t.y - u.y;
      return dx * dx + dy * dy <= r * r;
    }
    // 普通索敌：攻击距离内最优的单位（远程优先给蝙蝠）；没有就看水晶。巨像只找水晶
    findTarget(u) {
      const foe = 1 - u.side;
      if (u.ghost) {
        const c = this.crystals[foe];
        return c.hp > 0 && this.inReach(u, c) ? c : null;
      }
      let best = null, bestKey = Infinity;
      for (const e of this.unitsNear(u.x, u.y, u.range + u.radius + MAX_R + REACH)) {
        if (e.side !== foe || !this.targetable(e)) continue;
        if (e.flying && !u.canHitAir) continue;
        if (!this.inReach(u, e)) continue;
        const key = (u.uid === 'bats' && !e.ranged ? 1e6 : 0) + Math.hypot(e.x - u.x, e.y - u.y);
        if (key < bestKey) { bestKey = key; best = e; }
      }
      if (best) return best;
      const c = this.crystals[foe];
      return c.hp > 0 && this.inReach(u, c) ? c : null;
    }
    validInRange(u, t) {
      if (t.isCrystal) return t.hp > 0 && this.inReach(u, t);
      return this.targetable(t) && this.inReach(u, t) && (!t.flying || u.canHitAir);
    }
    // 追击目标：仇恨范围 max(320, range + 200) 内最近的可攻击敌人；蝙蝠是全图最近的远程敌人；巨像和不能动的没有
    chaseTarget(u) {
      if (u.ghost || u.def.speed <= 0) return null;
      const foe = 1 - u.side;
      let best = null, bd = Infinity;
      if (u.uid === 'bats') {
        for (const e of this.rangedBy[foe]) {
          if (!this.targetable(e)) continue;
          const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
          if (d < bd) { bd = d; best = e; }
        }
        return best;
      }
      const aggro = Math.max(320, u.range + 200);
      for (const e of this.unitsNear(u.x, u.y, aggro)) {
        if (e.side !== foe || !this.targetable(e)) continue;
        if (e.flying && !u.canHitAir) continue;
        const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }

    // ---------- 出兵 ----------
    canSpawn(side, uid) {
      const d = C.BY_ID[uid];
      const S = this.sides[side];
      if (!d) return 'no';
      if (this.ended) return 'ended';
      if (d.playerOnly && side !== 0) return 'no';
      const ch = side === 0 ? this.cheats : null;
      if (S.cdLeft[uid] > 0 && !(ch && ch.noCd)) return 'cooldown';
      if (S.gold < d.cost) return 'gold';
      if (S.supplyUsed + d.supply > R.economy.supplyCap && !(ch && ch.noSupply)) return 'supply';
      if (d.maxOnField && this.count(side, uid) >= d.maxOnField) return 'max';
      return 'ok';
    }
    spawn(side, uid) {
      if (this.canSpawn(side, uid) !== 'ok') return false;
      const d = C.BY_ID[uid];
      const S = this.sides[side];
      S.gold -= d.cost;
      S.supplyUsed += d.supply;
      S.cdLeft[uid] = d.cooldown;
      S.spawned[uid] = (S.spawned[uid] || 0) + d.count;
      const group = { supply: d.supply, members: d.count };   // 一次出几个，人口只算一次
      const fp = this.formationPoint(side);
      const back = side === 0 ? -1 : 1;                         // 成群的往自家方向排
      const cols = Math.ceil(Math.sqrt(d.count));
      for (let i = 0; i < d.count; i++) {
        const row = Math.floor(i / cols), col = i % cols;
        this.addUnit(side, d, {
          x: fp.x + back * row * GROUP_GAP,
          y: fp.y + (col - (cols - 1) / 2) * GROUP_GAP,
          group,
        });
      }
      this.emit({ t: 'spawn', side, uid });
      return true;
    }
    // 出兵点：自家水晶内侧 spawnDepth 的纵深，y 以 h/2 为中心展开 spawnSpread
    formationPoint(side) {
      const M = R.map;
      const along = M.inset + M.crystalRadius + 60 + this.rng() * M.spawnDepth;
      return {
        x: side === 0 ? along : M.w - along,
        y: M.h / 2 + (this.rng() - 0.5) * M.spawnSpread,
      };
    }

    // 创建单位。summon：召唤物（不占人口、不留尸体）；life：到时间自动消散；不传 x/y 就用出兵点
    addUnit(side, def, o = {}) {
      const radius = unitRadius(def);
      let x = o.x, y = o.y;
      if (x == null || y == null) {
        const fp = this.formationPoint(side);
        if (x == null) x = fp.x;
        if (y == null) y = fp.y;
      }
      const u = {
        id: ++this.uidSeq,
        side,
        dir: C.DIR(side),
        def,
        uid: def.id,
        name: def.name,
        sheet: def.sheet,
        small: !!def.small,
        tier: def.tier,
        x: 0,
        y: 0,
        radius,
        hp: def.hp,
        maxHp: def.hp,
        aspd: def.aspd,
        range: def.range,
        atk: def.atk,
        dmgType: def.dmg,
        flying: def.tags.indexOf('flying') >= 0,
        ranged: def.range >= R.rangedThreshold,
        canHitAir: def.range >= R.rangedThreshold && !def.groundOnly,
        giant: def.tags.indexOf('giant') >= 0,
        ghost: def.id === 'titan',
        st: {},
        imm: { stun: 0, frozen: 0 },
        invuln: 0,
        hitCount: 0,
        nextHitMul: 0,
        shieldWallT: 0,
        smiteT: 0,
        cleanseT: 0,
        skillCd: def.skill ? def.skill.cd * 0.6 : 0,  // 开局技能冷却进度 40%
        swing: null,
        cast: null,
        charge: null,
        burrowed: false,
        moving: false,
        clock: 0,
        hitT: 99,
        dead: false,
        pendingDeath: false,
        bones: false,
        bonesT: 0,
        reformUsed: false,
        reviveUsed: false,
        auraT: 0,
        summon: !!o.summon,
        life: o.life == null ? null : o.life,
        group: o.group || null,
        chase: null,
        retargetT: this.rng() * RETARGET,
      };
      C.place(u, x, y);
      this.units.push(u);
      this.grid.insert(u);
      if (u.ranged) this.rangedBy[side].push(u);
      return u;
    }

    markDead(u) {
      if (u.pendingDeath || u.dead) return;
      u.pendingDeath = true;
      this.pending.push(u);
    }
    removeUnit(u) {
      u.dead = true;
      const i = this.units.indexOf(u);
      if (i >= 0) this.units.splice(i, 1);
      if (u.group) {
        u.group.members -= 1;
        if (u.group.members <= 0) this.sides[u.side].supplyUsed -= u.group.supply;
      }
    }
    removeBody(b) {
      const i = this.bodies.indexOf(b);
      if (i >= 0) this.bodies.splice(i, 1);
    }

    // ---------- 远程攻击：发射投射物，落地时结算 ----------
    // homing：true 追着目标飞；false 落在发射时的位置（炸弹）。返回投射物对象
    fireAttack(src, tgt, sprite, onLand, homing = true) {
      const dist = Math.hypot(tgt.x - src.x, tgt.y - src.y);
      const dur = Math.max(0.12, Math.min(0.7, dist / 900));
      const p = {
        sprite, side: src.side, el: src.def ? src.def.element : null,
        x0: src.x, y0: src.y, x1: tgt.x, y1: tgt.y, h0: src.h0 == null ? 30 : src.h0,
        tgt, homing, t: 0, dur, done: false, onLand,
      };
      this.projectiles.push(p);
      return p;
    }

    // 一次攻击在 release 帧出手：目标失效就重新找，找不到就空挥
    release(u, s) {
      let t = s.target;
      if (!this.validInRange(u, t)) t = this.findTarget(u);
      if (!t) return;
      if (t.isCrystal) {
        // 水晶和单位一样吃攻击方的 onHit（亡灵君主的易伤等，applyStatus 只让水晶收下易伤）
        const hit = () => {
          if (t.hp <= 0) return;
          if (C.damage(this, u, t, u.atk, u.dmgType, { attack: true }) > 0) {
            for (const h of u.def.onHit) C.applyStatus(this, t, h.status, { stacks: h.stacks });
          }
        };
        if (u.ranged) this.fireAttack(u, t, u.def.projectile || 'orb', hit);
        else hit();
        return;
      }
      if (u.ranged) {
        const splash = u.def.splash || 0;
        const p = this.fireAttack(u, t, u.def.projectile || 'orb', () => {
          // 落点：追踪弹是目标最后的位置，炸弹是发射时的位置
          const ix = p.x1, iy = p.y1;
          if (this.targetable(t) && (!splash || Math.hypot(t.x - ix, t.y - iy) <= splash)) {
            C.hitAttack(this, u, t, splash);
          } else if (splash) {
            C.splashAt(this, u, ix, iy, splash, null, u.dmgType, u.atk, u.def.element);
          }
        }, !splash);
      } else {
        C.hitAttack(this, u, t, u.def.splash || 0);
      }
    }

    startSwing(u, t) {
      const a = animOf(u.sheet, 'attack');
      const period = 1 / (u.aspd * C.slowMul(u));
      const rel = a ? a.release : 0;
      const n = a ? a.n : 1;
      u.swing = { t: 0, period, releaseT: (rel / n) * period, target: t, hit: false };
    }
    swingStep(u, dt) {
      const s = u.swing;
      s.t += dt;
      if (!s.hit && s.t >= s.releaseT) {
        s.hit = true;
        this.release(u, s);
      }
      if (s.t >= s.period) u.swing = null;
    }

    // 移动（第五节）：有追击目标且够不着就朝它走；否则朝敌方水晶走，够得着就停
    move(u, dt) {
      u.burrowed = false;
      u.moving = false;
      if (u.def.speed <= 0 || C.has(u, 'root')) return;
      let tgt = null;
      const c = u.chase;
      if (c && this.targetable(c)) {
        if (this.inReach(u, c)) return;     // 已经够得着，由挥击处理
        tgt = c;
      } else {
        const g = this.goalOf(u.side);
        if (g.hp <= 0 || this.inReach(u, g)) return;
        tgt = g;
      }
      let v = u.def.speed * C.slowMul(u);
      if (u.uid === 'worm') {       // 移动时钻在地下：不能被攻击，移速 ×1.5
        u.burrowed = true;
        v *= 1.5;
      }
      const dx = tgt.x - u.x, dy = tgt.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-6) return;
      const s = Math.min(d, v * dt);
      C.place(u, u.x + (dx / d) * s, u.y + (dy / d) * s);
      u.moving = true;
    }

    // 单个单位一个 tick 的行为
    updateUnit(u, dt) {
      if (u.dead || u.pendingDeath || u.bones) return;
      u.burrowed = false;
      u.moving = false;
      if (u.charge) { C.chargeStep(this, u, dt); return; }
      if (u.cast) { C.castStep(this, u, dt); return; }
      if (u.uid === 'lein') {
        u.cleanseT -= dt;
        if (u.cleanseT <= 0) {
          u.cleanseT = 2;   // 净化光环：清掉身边 120 范围内友军的易伤和衰弱
          for (const f of this.unitsNear(u.x, u.y, 120)) {
            if (f.side === u.side && this.alive(f)) {
              delete f.st.vulnerable;
              delete f.st.weaken;
            }
          }
        }
      }
      if (C.has(u, 'stun') || C.has(u, 'frozen')) return;
      if (u.def.speed > 0) {
        u.retargetT -= dt;
        if (u.retargetT <= 0) {
          u.retargetT = RETARGET;
          u.chase = this.chaseTarget(u);
        }
      }
      if (C.trySkill(this, u) && (u.cast || u.charge)) return;
      if (!u.swing) {
        const t = this.findTarget(u);
        if (t) this.startSwing(u, t);
      }
      if (u.swing) {
        this.swingStep(u, dt);
        return;
      }
      this.move(u, dt);
    }

    // 每步开始（和移动、推挤之后）重建空间网格，并统计存活数、挥击数、远程列表
    buildGrid() {
      const g = this.grid;
      g.clear();
      const st = this.stat;
      st.alive[0] = st.alive[1] = 0;
      st.swing[0] = st.swing[1] = 0;
      this.rangedBy[0].length = 0;
      this.rangedBy[1].length = 0;
      for (const u of this.units) {
        g.insert(u);
        if (!this.alive(u)) continue;
        st.alive[u.side]++;
        if (u.swing) st.swing[u.side]++;
        if (u.ranged) this.rangedBy[u.side].push(u);
      }
    }

    // 分离推挤（第 4.4 节）：地面单位两两重叠各推开一半；所有单位限制在地图内；
    // 地面单位最后再推出水晶圆外（放在单位推挤之后，保证推挤不会把单位推进水晶）
    separate() {
      const g = this.grid;
      // 先在推挤前的网格上找出所有重叠的对，再统一推，避免中途位置变化漏掉。
      // 格子边长 96 大于两个单位半径之和的最大值（80，CELL 不能小于它），重叠的两个单位一定在同格或相邻格里，
      // 所以按格子遍历：同格内两两配对，邻格只看 4 个方向，每对只访问一次，不用对每个单位做查询
      const pairs = this.pairBuf;
      pairs.length = 0;
      const addPair = (a, b) => {
        if (!solid(this, b)) return;
        const m = a.radius + b.radius;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx * dx + dy * dy < m * m) pairs.push(a, b);
      };
      for (let i = 0; i < g.used.length; i++) {
        const cell = g.used[i], cx = g.ucx[i], cy = g.ucy[i];
        for (let p = 0; p < cell.length; p++) {
          const a = cell[p];
          if (!solid(this, a)) continue;
          for (let q = p + 1; q < cell.length; q++) addPair(a, cell[q]);
          for (let o = 0; o < FWD.length; o += 2) {
            const nb = g.map.get(keyOf(cx + FWD[o], cy + FWD[o + 1]));
            if (nb) for (let q = 0; q < nb.length; q++) addPair(a, nb[q]);
          }
        }
      }
      for (let i = 0; i < pairs.length; i += 2) {
        const a = pairs[i], b = pairs[i + 1];
        const m = a.radius + b.radius;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= m) continue;
        let nx, ny;
        if (d < 1e-6) {
          const ang = this.rng() * Math.PI * 2;
          nx = Math.cos(ang);
          ny = Math.sin(ang);
        } else {
          nx = dx / d;
          ny = dy / d;
        }
        const h = (m - d) / 2;
        a.x -= nx * h; a.y -= ny * h;
        b.x += nx * h; b.y += ny * h;
      }
      // 水晶圆：地面单位推到圆边上。水晶只有两个，直接扫全部单位，不用网格
      for (const c of this.crystals) {
        if (c.hp <= 0) continue;
        for (const u of this.units) {
          if (!solid(this, u)) continue;
          const m = c.radius + u.radius;
          const dx = u.x - c.x, dy = u.y - c.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= m) continue;
          let nx, ny;
          if (d < 1e-6) {
            const ang = this.rng() * Math.PI * 2;
            nx = Math.cos(ang);
            ny = Math.sin(ang);
          } else {
            nx = dx / d;
            ny = dy / d;
          }
          u.x = c.x + nx * m;
          u.y = c.y + ny * m;
        }
      }
      for (const u of this.units) C.place(u, u.x, u.y);
    }

    // ---------- 主循环 ----------
    // 真实时间 → 固定步长：每帧最多 12 步，防止卡顿时螺旋
    update(realDt) {
      if (this.ended) return;
      this.acc += Math.min(0.1, realDt) * this.speed;
      let n = 0;
      while (this.acc >= DT && n < 12 && !this.ended) {
        this.step(DT);
        this.acc -= DT;
        n++;
      }
      if (n >= 12) this.acc = 0;
    }

    step(dt) {
      if (this.ended) return;
      this.time += dt;
      this.buildGrid();
      if (!this.cheats.aiOff) for (const ai of this.ais) ai.tick(this, dt);

      // 经济：基础收入 + 贪婪宝箱每个每秒 3 金币
      for (let s = 0; s < 2; s++) {
        const S = this.sides[s];
        let mimics = 0;
        for (const u of this.units) if (u.side === s && u.uid === 'mimic' && this.alive(u)) mimics++;
        S.gold += (R.economy.income * S.incomeMul + 3 * mimics) * this.cheats.incomeMul[s] * dt;
        if (s === 0 && this.cheats.infiniteGold) S.gold = Math.max(S.gold, 999999);
        for (const k of Object.keys(S.cdLeft)) S.cdLeft[k] = Math.max(0, S.cdLeft[k] - dt);
        for (let i = 0; i < 3; i++) S.manualCd[i] = this.cheats.satanNoCd ? 0 : Math.max(0, S.manualCd[i] - dt);
      }

      for (const u of this.units.slice()) {
        if (u.dead) continue;
        C.tickStatuses(this, u, dt);
        if (u.bones) {
          u.bonesT -= dt;
          if (u.bonesT <= 0) C.reform(this, u);
          continue;
        }
        u.clock += dt;
        if (u.skillCd > 0) u.skillCd = Math.max(0, u.skillCd - dt);
        u.shieldWallT = Math.max(0, u.shieldWallT - dt);
        if (u.uid === 'satan' && this.alive(u)) C.satanAura(this, u, dt);
        if (u.life != null) {
          u.life -= dt;
          // 召唤物到时间消散：hp 归零再登记死亡，结算时不会被当成“没死”而留在场上
          if (u.life <= 0) { u.hp = 0; this.markDead(u); }
        }
      }

      for (const u of this.units.slice()) this.updateUnit(u, dt);

      this.buildGrid();      // 移动之后重建，给分离推挤用
      this.separate();
      this.buildGrid();      // 推挤之后重建，给后面的落地、区域、炮塔用

      for (const p of this.projectiles) {
        if (p.done) continue;
        if (p.homing && p.tgt) { p.x1 = p.tgt.x; p.y1 = p.tgt.y; }
        p.t += dt;
        if (p.t >= p.dur) {
          p.done = true;
          p.onLand();
        }
      }
      this.projectiles = this.projectiles.filter((p) => !p.done);

      for (const z of this.zones) {
        z.t -= dt;
        C.zoneTick(this, z, dt);
      }
      this.zones = this.zones.filter((z) => z.t > 0);

      this.fx = this.fx.filter((f) => { f.t += dt; return f.t < f.dur; });

      for (const b of this.bodies) b.age += dt;
      this.bodies = this.bodies.filter((b) => b.age < b.life);

      // 水晶只挂易伤，这里走计时（单位的状态在 tickStatuses 里走）
      for (const c of this.crystals) {
        for (const id of Object.keys(c.st)) {
          c.st[id].t -= dt;
          if (c.st[id].t <= 0) delete c.st[id];
        }
      }

      // 水晶炮塔：攻击距离 = 炮塔射程 + 水晶半径（从水晶圆心算），打最近的敌方可攻击单位（能打飞行）
      for (let s = 0; s < 2; s++) {
        const c = this.crystals[s];
        if (c.hp <= 0) continue;
        c.cd = Math.max(0, c.cd - dt);
        if (c.cd > 0) continue;
        const foe = 1 - s;
        let t = null, bd = Infinity;
        for (const e of this.unitsNear(c.x, c.y, R.crystal.range + c.radius)) {
          if (e.side !== foe || !this.targetable(e)) continue;
          const d = (e.x - c.x) ** 2 + (e.y - c.y) ** 2;
          if (d < bd) { bd = d; t = e; }
        }
        if (t) {
          c.cd = 1 / R.crystal.aspd;
          this.fireAttack({ side: s, x: c.x, y: c.y, h0: 80 }, t, 'arrow', () => {
            // 炮塔没有攻击者，伤害倍率按所属阵营取（作弊的伤害倍率对炮塔也生效）
            if (this.targetable(t)) C.damage(this, null, t, R.crystal.atk, R.crystal.dmg, { attack: true, side: s });
          });
        }
      }

      this.settleDeaths();
      this.checkWin();
    }

    // 结算死亡：骨堆 / 尸体 / 召唤物消散 / 死亡特性
    settleDeaths() {
      const list = this.pending;
      this.pending = [];
      for (const u of list) {
        u.pendingDeath = false;
        if (u.dead || u.hp > 0) continue;
        if (C.tryBones(this, u)) continue;
        this.removeUnit(u);
        const d = deathDur(u.sheet);
        this.bodies.push({
          corpse: !u.summon, side: u.side, uid: u.uid, sheet: u.sheet, small: u.small, scale: u.def.scale || 1,
          x: u.x, y: u.y, age: 0, deathDur: d,
          life: u.summon ? d + 0.4 : R.economy.corpseSeconds,
        });
        C.onDeath(this, u);
        this.emit({ t: 'death', side: u.side, uid: u.uid, x: u.x, y: u.y });
      }
    }

    // 作弊菜单：设置水晶当前血量和上限（上限跟着调大，血条不会溢出）
    setCrystal(side, hp, maxHp) {
      const c = this.crystals[side];
      if (maxHp != null) c.maxHp = Math.max(1, maxHp);
      c.hp = Math.max(1, Math.min(c.maxHp, hp == null ? c.maxHp : hp));
    }
    // 作弊菜单：清空一方场上所有单位（直接移除，不留尸体、不触发死亡特性）
    wipe(side) {
      for (const u of this.units.slice()) if (u.side === side) this.removeUnit(u);
      this.bodies = this.bodies.filter((b) => b.side !== side);
    }

    // 胜负：一方水晶归零就结束，另一方获胜；双方水晶在同一步归零判平局（winner = 'draw'）
    checkWin() {
      const dead = [0, 1].filter((s) => this.crystals[s].hp <= 0);
      if (!dead.length) return;
      this.ended = true;
      this.winner = dead.length === 2 ? 'draw' : 1 - dead[0];
      for (const s of dead) this.crystals[s].hp = 0;
      this.emit({ t: 'end', winner: this.winner });
    }
  }

  Engine.DT = DT;
  Engine.Grid = Grid;
  window.Engine = Engine;
})();
