// 糯糯战记 · 对局引擎：状态、固定步长主循环、经济与出兵、索敌与移动、攻击出手、胜负
// 纯逻辑，不碰 DOM / canvas。渲染和 UI 只读这里的状态，通过 spawn() 下单。
// 坐标：兵线 x ∈ [0, 1600]。side 0 玩家在左、向右走；side 1 电脑在右、向左走。
(function () {
  const R = window.RULES;
  const SH = window.HD_SHEETS;
  const C = window.Combat;
  const DT = 1 / 60;
  const REACH = 12;       // 攻击距离的容差（中心到中心）
  const BLOCK_GAP = 22;   // 地面单位之间的挡路距离
  const LANE = R.lane.length;

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

  class Engine {
    constructor(opts = {}) {
      this.rng = mulberry32(opts.seed == null ? (Math.random() * 2147483647) | 0 : opts.seed);
      this.time = 0;
      this.acc = 0;
      this.speed = 1;
      this.ended = false;
      this.winner = null;
      this.front = [100, LANE - 100];                       // 水晶前沿
      this.crystals = [0, 1].map((s) => ({
        isCrystal: true, side: s, x: this.front[s], hp: R.lane.crystalHp, maxHp: R.lane.crystalHp, cd: 0,
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
    }

    // ---------- 事件与特效（给渲染和界面用） ----------
    emit(ev) {
      this.events.push(ev);
      if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
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
    // 王之威仪：雷克斯 200 范围内的友军伤害 +15%、免疫衰弱
    rexAura(u) {
      for (const e of this.units) {
        if (e.uid === 'rex' && e.side === u.side && this.alive(e) && Math.abs(e.x - u.x) <= 200) return true;
      }
      return false;
    }
    // 盾墙：布朗身后 120 范围内（含布朗自己）的友军受到的穿刺伤害 -70%
    brownShield(tgt) {
      for (const e of this.units) {
        if (e.uid !== 'brown' || e.side !== tgt.side || !(e.shieldWallT > 0) || !this.alive(e)) continue;
        const d = (tgt.x - e.x) * C.DIR(e.side);
        if (d <= 0 && d >= -120) return true;
      }
      return false;
    }

    // 普通索敌：射程内的敌人（远程优先给蝙蝠）；没有就看水晶
    findTarget(u) {
      const foe = 1 - u.side;
      if (u.uid === 'titan') {
        // 碎城巨人眼里只有水晶
        const c = this.crystals[foe];
        return c.hp > 0 && Math.abs(this.front[foe] - u.x) <= u.range + REACH ? c : null;
      }
      let best = null, bestKey = Infinity;
      for (const e of this.units) {
        if (e.side !== foe || !this.targetable(e)) continue;
        if (e.flying && !u.canHitAir) continue;
        const d = Math.abs(e.x - u.x);
        if (d > u.range + REACH) continue;
        const key = (u.uid === 'bats' && !e.ranged ? 1e6 : 0) + d;
        if (key < bestKey) { bestKey = key; best = e; }
      }
      if (best) return best;
      const c = this.crystals[foe];
      if (c.hp > 0 && Math.abs(this.front[foe] - u.x) <= u.range + REACH) return c;
      return null;
    }
    validInRange(u, t) {
      if (t.isCrystal) return t.hp > 0 && Math.abs(this.front[t.side] - u.x) <= u.range + REACH;
      return this.targetable(t) && Math.abs(t.x - u.x) <= u.range + REACH && (!t.flying || u.canHitAir);
    }
    // 蝙蝠飞向最近的远程敌人（不论距离）
    chaseTarget(u) {
      const foe = 1 - u.side;
      let best = null, bd = Infinity;
      for (const e of this.units) {
        if (e.side !== foe || !e.ranged || !this.targetable(e)) continue;
        const d = Math.abs(e.x - u.x);
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
      const base = side === 0 ? this.front[0] + 14 : this.front[1] - 14;
      const back = side === 0 ? -1 : 1;                         // 成群的往自家方向排
      for (let i = 0; i < d.count; i++) {
        this.addUnit(side, d, {
          x: base + back * i * 10 + (this.rng() - 0.5) * 6,
          uy: (this.rng() - 0.5) * 12,
          group,
        });
      }
      this.emit({ t: 'spawn', side, uid });
      return true;
    }

    // 创建单位。summon：召唤物（不占人口、不留尸体）；life：到时间自动消散
    addUnit(side, def, o = {}) {
      const u = {
        id: ++this.uidSeq,
        side,
        dir: C.DIR(side),
        def,
        uid: def.id,
        name: def.name,
        sheet: def.sheet,
        small: !!def.small,
        x: o.x == null ? (side === 0 ? this.front[0] + 14 : this.front[1] - 14) : o.x,
        uy: o.uy == null ? 0 : o.uy,
        hp: def.hp,
        maxHp: def.hp,
        aspd: def.aspd,
        range: def.range,
        atk: def.atk,
        dmgType: def.dmg,
        flying: def.tags.indexOf('flying') >= 0,
        ranged: def.range >= R.rangedThreshold,
        canHitAir: def.range >= R.rangedThreshold && !def.groundOnly,
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
        clock: 0,
        hitT: 99,
        dead: false,
        pendingDeath: false,
        bones: false,
        bonesT: 0,
        reformUsed: false,
        summon: !!o.summon,
        life: o.life == null ? null : o.life,
        group: o.group || null,
      };
      this.units.push(u);
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
    // homing：true 追着目标飞；false 落在发射时的位置（炸弹）
    fireAttack(src, tgt, sprite, onLand, homing = true) {
      const x1 = tgt.x;
      const dist = Math.abs(x1 - src.x);
      const dur = Math.max(0.12, Math.min(0.7, dist / 900));
      this.projectiles.push({
        sprite, side: src.side, el: src.def ? src.def.element : null,
        x0: src.x, x1, h0: src.h0 == null ? 30 : src.h0,
        tgt, homing, t: 0, dur, done: false, onLand,
      });
    }

    // 一次攻击在 release 帧出手：目标失效就重新找，找不到就空挥
    release(u, s) {
      let t = s.target;
      if (!this.validInRange(u, t)) t = this.findTarget(u);
      if (!t) return;
      if (t.isCrystal) {
        if (u.ranged) {
          this.fireAttack(u, t, u.def.projectile || 'orb', () => {
            if (t.hp > 0) C.damage(this, u, t, u.atk, u.dmgType, { attack: true });
          });
        } else {
          C.damage(this, u, t, u.atk, u.dmgType, { attack: true });
        }
        return;
      }
      if (u.ranged) {
        const splash = u.def.splash || 0;
        this.fireAttack(u, t, u.def.projectile || 'orb', () => {
          if (this.targetable(t)) C.hitAttack(this, u, t, splash);
          else if (splash) C.splashAt(this, u, t.x, splash, null, u.dmgType, u.atk, u.def.element);
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

    // 地面单位被前面的敌方地面单位挡住；蝙蝠、飞行、地下、巨碎城不挡也不被挡
    blocked(u, dir) {
      for (const e of this.units) {
        if (e.side === u.side || e.flying || e.burrowed || e.ghost || !this.alive(e)) continue;
        const d = (e.x - u.x) * dir;
        if (d > 0 && d < BLOCK_GAP) return true;
      }
      return false;
    }
    move(u, dt) {
      u.burrowed = false;
      u.moving = false;
      if (u.def.speed <= 0 || C.has(u, 'root')) return;
      let dir = u.dir;
      let v = u.def.speed * C.slowMul(u);
      if (u.uid === 'bats') {
        const c = this.chaseTarget(u);
        if (c && c.x !== u.x) dir = Math.sign(c.x - u.x);
      }
      if (u.uid === 'worm') {       // 移动时钻在地下：不能被攻击，移速 ×1.5
        u.burrowed = true;
        v *= 1.5;
      }
      if (!u.flying && !u.ghost && this.blocked(u, dir)) return;
      u.x = C.clampX(u.x + dir * v * dt);
      u.moving = true;
    }

    // 单个单位一个 tick 的行为
    updateUnit(u, dt) {
      if (u.dead || u.pendingDeath || u.bones) return;
      u.burrowed = false;
      if (u.charge) { C.chargeStep(this, u, dt); return; }
      if (u.cast) { C.castStep(this, u, dt); return; }
      if (u.uid === 'lein') {
        u.cleanseT -= dt;
        if (u.cleanseT <= 0) {
          u.cleanseT = 2;   // 净化光环：清掉身边友军的易伤和衰弱
          for (const f of this.units) {
            if (f.side === u.side && this.alive(f) && Math.abs(f.x - u.x) <= 120) {
              delete f.st.vulnerable;
              delete f.st.weaken;
            }
          }
        }
      }
      if (C.has(u, 'stun') || C.has(u, 'frozen')) return;
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
          if (u.life <= 0) this.markDead(u);
        }
      }

      for (const u of this.units.slice()) this.updateUnit(u, dt);

      for (const p of this.projectiles) {
        if (p.done) continue;
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

      // 水晶炮塔
      for (let s = 0; s < 2; s++) {
        const c = this.crystals[s];
        if (c.hp <= 0) continue;
        c.cd = Math.max(0, c.cd - dt);
        if (c.cd > 0) continue;
        const foe = 1 - s;
        let t = null, bd = Infinity;
        for (const e of this.units) {
          if (e.side !== foe || !this.targetable(e)) continue;
          const d = Math.abs(e.x - this.front[s]);
          if (d <= R.crystal.range && d < bd) { bd = d; t = e; }
        }
        if (t) {
          c.cd = 1 / R.crystal.aspd;
          this.fireAttack({ side: s, x: this.front[s], h0: 80 }, t, 'arrow', () => {
            if (this.targetable(t)) C.damage(this, null, t, R.crystal.atk, R.crystal.dmg, { attack: true });
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
          x: u.x, uy: u.uy, age: 0, deathDur: d,
          life: u.summon ? d + 0.4 : R.economy.corpseSeconds,
        });
        C.onDeath(this, u);
        this.emit({ t: 'death', side: u.side, uid: u.uid, x: u.x });
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

    checkWin() {
      for (let s = 0; s < 2; s++) {
        if (this.crystals[s].hp <= 0) {
          this.ended = true;
          this.winner = 1 - s;
          this.crystals[s].hp = 0;
          this.emit({ t: 'end', winner: this.winner });
          return;
        }
      }
    }
  }

  Engine.DT = DT;
  Engine.LANE = LANE;
  window.Engine = Engine;
})();
