// 糯糯战记 · 战斗规则：伤害管线、状态系统、元素反应、特性和主动技能
// 纯逻辑，不碰 DOM / canvas。数值来自 rules.js 和 units.js；技能 desc 里的数值优先。
// 约定：side 0 = 玩家（向右走），side 1 = 电脑（向左走）。
(function () {
  const R = window.RULES;
  const UNITS = window.UNITS;
  const BY_ID = {};
  UNITS.forEach((d) => { BY_ID[d.id] = d; });

  const DIR = (side) => (side === 0 ? 1 : -1);
  const hasTag = (u, tag) => u.def.tags.indexOf(tag) >= 0;
  const st = (u, id) => (u.st[id] && u.st[id].t > 0 ? u.st[id] : null);
  const has = (u, id) => !!st(u, id);
  const stacksOf = (u, id) => (st(u, id) ? st(u, id).stacks || 0 : 0);
  const clampX = (x) => Math.max(30, Math.min(R.lane.length - 30, x));

  // 水晶用“重甲”算，攻城伤害另算 ×3
  function armorMul(tgt, dmgType) {
    if (tgt.isCrystal) return dmgType === 'siege' ? R.damageMatrix.siege.crystal : R.damageMatrix[dmgType].heavy;
    return R.damageMatrix[dmgType][tgt.def.armor];
  }

  // 召唤物定义（不占人口、不留尸体）
  const SUMMON_SKELETON = Object.assign({}, BY_ID.skeleton, { hp: 150, atk: 16, aspd: 1.0, traits: [], skill: null, cost: 0 });
  const SMALL_SLIME = Object.assign({}, BY_ID.slime, { hp: 110, atk: 7, traits: [], skill: null, cost: 0, small: true });

  // ---------- 状态 ----------
  function freeze(eng, u) {
    if (u.imm.frozen > 0 || has(u, 'frozen')) return false;
    const d = R.statuses.frozen.duration;
    u.st.frozen = { t: d };
    delete u.st.chill;
    u.imm.frozen = d + R.statuses.frozen.immuneAfter; // 解冻后再免疫 4 秒
    interrupt(eng, u, 'freeze');
    eng.emit({ t: 'react', x: u.x, uy: u.uy, text: '冻结', color: '#9fe8ff' });
    return true;
  }

  // 打断：眩晕/冻结取消攻击和冲锋；击退和眩晕都会打断蓄力和施法（夜叉被打断后进入半冷却）
  function interrupt(eng, u, why) {
    if (u.cast) {
      if (u.uid === 'yaksha' && u.def.skill) u.skillCd = u.def.skill.cd / 2;
      eng.emit({ t: 'react', x: u.x, uy: u.uy, text: '打断', color: '#ffb36b' });
      u.cast = null;
    }
    if (why === 'stun' || why === 'freeze') {
      u.swing = null;
      u.charge = null;
    }
  }

  function applyStatus(eng, u, id, o = {}) {
    if (!u || u.isCrystal || u.dead || u.bones || u.pendingDeath) return false;
    const def = R.statuses[id];
    if (!def) return false;
    if (id === 'poison' && hasTag(u, 'undead')) return false;     // 不死免疫中毒
    if (id === 'weaken' && eng.rexAura(u)) return false;          // 王之威仪免疫衰弱
    switch (id) {
      case 'burn':
      case 'poison':
      case 'chill': {
        let n = o.stacks || 1;
        if (id === 'chill' && u.uid === 'worm') n *= 2;           // 怕冷：寒霜层数翻倍
        const s = u.st[id] || (u.st[id] = { stacks: 0, t: 0 });
        s.stacks = Math.min(def.maxStacks, s.stacks + n);
        s.t = def.duration;
        if (id === 'chill' && s.stacks >= 3 && !freeze(eng, u)) s.stacks = 3; // 免疫期内只保留 3 层
        return true;
      }
      case 'vulnerable':
      case 'weaken':
        u.st[id] = { t: def.duration };
        return true;
      case 'holyShield': {
        const s = u.st.holyShield || (u.st.holyShield = { absorb: 0, t: 0 });
        s.absorb += o.absorb == null ? 150 : o.absorb;
        s.t = Math.max(s.t, def.duration);
        return true;
      }
      case 'unyielding':
        u.st.unyielding = { t: def.duration };
        return true;
      case 'stun': {
        if (u.imm.stun > 0) return false;
        let d = o.dur == null ? 1 : o.dur;
        if (hasTag(u, 'giant')) d *= 0.5;                          // 巨型眩晕减半
        u.st.stun = { t: Math.max(has(u, 'stun') ? u.st.stun.t : 0, d) };
        u.imm.stun = d + def.immuneAfter;
        interrupt(eng, u, 'stun');
        return true;
      }
      case 'root': {
        const d = o.dur == null ? 2 : o.dur;
        u.st.root = { t: Math.max(has(u, 'root') ? u.st.root.t : 0, d) };
        return true;
      }
      case 'frozen':
        return freeze(eng, u);
      default:
        return false;
    }
  }

  // 击退：巨型免疫；盾墙期间不会被击退；向自家水晶方向推
  function knock(eng, u, dist) {
    if (u.isCrystal || u.dead || hasTag(u, 'giant') || u.shieldWallT > 0) return;
    u.x = clampX(u.x - DIR(u.side) * dist);
    u.hitT = 0;
    interrupt(eng, u, 'knock');
  }

  function slowMul(u) {
    const c = stacksOf(u, 'chill');
    return c ? 1 - R.statuses.chill.slowPerStack * c : 1;
  }

  // 生命扣减的公共入口：不死（不屈）和死亡登记
  function takeHp(eng, u, dmg, quiet) {
    u.hp -= dmg;
    if (!quiet) u.hitT = 0;
    if (u.hp <= 0 && !u.pendingDeath) {
      if (has(u, 'unyielding')) {
        u.hp = 1;
        u.invuln = 1.5;
        delete u.st.unyielding;
        eng.emit({ t: 'react', x: u.x, uy: u.uy, text: '不屈', color: '#ffe38a' });
      } else {
        eng.markDead(u);
      }
    }
  }

  function heal(u, amt) {
    const mul = has(u, 'burn') ? R.statuses.burn.healMul : 1;
    u.hp = Math.min(u.maxHp, u.hp + amt * mul);
  }

  // 每 tick 的状态处理：持续伤害、计时、免疫、无敌
  function tickStatuses(eng, u, dt) {
    if (u.bones) return;
    if (has(u, 'burn')) takeHp(eng, u, R.statuses.burn.dps * stacksOf(u, 'burn') * dt, true);
    if (has(u, 'poison')) takeHp(eng, u, R.statuses.poison.dps * stacksOf(u, 'poison') * dt, true); // 无视护甲
    for (const id of Object.keys(u.st)) {
      u.st[id].t -= dt;
      if (u.st[id].t <= 0) delete u.st[id];
    }
    u.imm.stun = Math.max(0, u.imm.stun - dt);
    u.imm.frozen = Math.max(0, u.imm.frozen - dt);
    u.invuln = Math.max(0, u.invuln - dt);
    u.smiteT = Math.max(0, (u.smiteT || 0) - dt);
    u.hitT += dt;
  }

  // ---------- 伤害管线 ----------
  // 顺序：水晶 → 骨堆 → 闪避/格挡 → 修正 → 圣盾 → 扣血 → 不屈 → 元素反应
  // o: attack 普通攻击 / skill 技能 / splash 溅射 / element 覆盖元素 / noReaction
  function damage(eng, src, tgt, base, dmgType, o = {}) {
    if (!tgt || tgt.dead) return 0;
    const elem = o.element !== undefined ? o.element : src && src.def ? src.def.element : null;

    if (tgt.isCrystal) {
      const dmg = base * armorMul(tgt, dmgType);
      tgt.hp -= dmg;
      eng.emit({ t: 'num', x: tgt.x, uy: 0, v: Math.round(dmg), color: '#ffd166' });
      return dmg;
    }
    if (tgt.bones) {
      if (elem === 'holy' || o.splash) shatter(eng, tgt);       // 骨堆只吃圣属性和溅射
      return 0;
    }
    if (tgt.hp <= 0 || tgt.dead || tgt.invuln > 0) return 0;

    if (o.attack && tgt.uid === 'zass' && dmgType === 'pierce' && eng.rng() < 0.3) {
      eng.emit({ t: 'react', x: tgt.x, uy: tgt.uy, text: '闪避', color: '#cfe8ff' });
      return 0;
    }
    if (o.attack && tgt.uid === 'xuan') {
      tgt.hitCount += 1;
      if (tgt.hitCount % 4 === 0) {
        eng.emit({ t: 'react', x: tgt.x, uy: tgt.uy, text: '化劲', color: '#c9f5c9' });
        return 0;
      }
    }

    const armor = armorMul(tgt, dmgType);
    let mul = armor;
    let special = false;
    if (src) {
      if (has(src, 'weaken')) mul *= R.statuses.weaken.damageDealtMul;
      if (eng.rexAura(src)) mul *= 1.15;
      if (src.uid === 'sylvie' && tgt.flying) { mul *= 1.5; special = true; }
      if (src.uid === 'freya' && (tgt.flying || tgt.charge)) { mul *= 2; special = true; }
      if (src.uid === 'freya' && tgt.charge) tgt.charge = null;     // 反冲锋：打断冲锋
      if (elem === 'holy' && hasTag(tgt, 'undead')) {
        mul *= 1.5;
        special = true;
        if (!(tgt.smiteT > 0)) {
          tgt.smiteT = 0.6;
          eng.emit({ t: 'react', x: tgt.x, uy: tgt.uy, text: '圣裁', color: '#ffe38a' });
        }
      }
      if (o.attack && src.nextHitMul) { mul *= src.nextHitMul; src.nextHitMul = 0; special = true; }
    }
    if (tgt.uid === 'slime') {
      if (dmgType === 'pierce') mul *= 0.6;
      if (elem === 'fire') mul *= 1.5;
    }
    if (has(tgt, 'vulnerable')) mul *= R.statuses.vulnerable.damageTakenMul;
    if (dmgType === 'pierce' && eng.brownShield(tgt)) mul *= 0.3;

    let dmg = base * mul;
    const sh = st(tgt, 'holyShield');
    if (sh && sh.absorb > 0 && dmg > 0) {
      const a = Math.min(sh.absorb, dmg);
      sh.absorb -= a;
      dmg -= a;
    }
    if (dmg <= 0) return 0;

    takeHp(eng, tgt, dmg);
    const hot = armor > 1 || special;
    eng.emit({ t: 'num', x: tgt.x, uy: tgt.uy, v: Math.round(dmg), color: hot ? '#ffd166' : '#ffffff' });

    if (!o.noReaction && elem) reactions(eng, src, tgt, elem);
    return dmg;
  }

  // 元素反应：融化 / 爆燃（圣裁已经在伤害修正里处理）
  function reactions(eng, src, tgt, elem) {
    if (elem !== 'fire') return;
    if (has(tgt, 'chill') || has(tgt, 'frozen')) {
      const layers = has(tgt, 'frozen') ? 3 : stacksOf(tgt, 'chill');
      delete tgt.st.chill;
      delete tgt.st.frozen;
      eng.emit({ t: 'react', x: tgt.x, uy: tgt.uy, text: '融化', color: '#ffb36b' });
      damage(eng, src, tgt, 60 + 20 * layers, 'magic', { noReaction: true, element: 'fire' });
    }
    const n = stacksOf(tgt, 'poison');
    if (n >= 3) {
      delete tgt.st.poison;
      eng.emit({ t: 'react', x: tgt.x, uy: tgt.uy, text: '爆燃', color: '#ff7a3d' });
      for (const e of eng.units.slice()) {
        if (e.side !== tgt.side || !(eng.targetable(e) || e.bones)) continue;
        if (Math.abs(e.x - tgt.x) <= 80) damage(eng, src, e, 15 * n, 'magic', { noReaction: true, element: 'fire', splash: true });
      }
    }
  }

  // 溅射：以 x 为中心，r 范围内的敌方全部受伤（骨堆会被散架）
  function splashAt(eng, src, x, r, exclude, dmgType, base, element) {
    for (const e of eng.units.slice()) {
      if (e.side === src.side || e === exclude) continue;
      if (!(eng.targetable(e) || e.bones)) continue;
      if (Math.abs(e.x - x) <= r) damage(eng, src, e, base, dmgType, { splash: true, element });
    }
  }

  // 普通攻击命中：伤害 → 附加状态 → 吸血 → 溅射
  function hitAttack(eng, u, tgt, splashR) {
    const dealt = damage(eng, u, tgt, u.atk, u.dmgType, { attack: true, element: u.def.element });
    if (dealt > 0) {
      for (const h of u.def.onHit) applyStatus(eng, tgt, h.status, { stacks: h.stacks });
      if (u.uid === 'bats') heal(u, dealt * 0.6);
    }
    if (splashR) splashAt(eng, u, tgt.x, splashR, tgt, u.dmgType, u.atk, u.def.element);
  }

  function shatter(eng, u) {
    u.bones = false;
    eng.removeUnit(u, false);
    eng.emit({ t: 'react', x: u.x, uy: u.uy, text: '散架', color: '#e8e0d0' });
  }

  // ---------- 死亡特性 ----------
  // 返回 true 表示没死，进入骨堆
  function tryBones(eng, u) {
    if (u.uid !== 'skeleton' || u.summon || u.reformUsed) return false;
    u.bones = true;
    u.bonesT = 3;
    u.reformUsed = true;
    u.hp = 0;
    u.st = {};
    u.swing = null;
    u.cast = null;
    u.charge = null;
    eng.emit({ t: 'react', x: u.x, uy: u.uy, text: '白骨重组', color: '#e8e0d0' });
    return true;
  }

  function reform(eng, u) {
    u.bones = false;
    u.hp = Math.round(u.maxHp * 0.5);
    u.st = {};
    u.hitT = 0;
    eng.emit({ t: 'react', x: u.x, uy: u.uy, text: '站起来', color: '#e8e0d0' });
  }

  function onDeath(eng, u) {
    if (u.uid === 'mushroom') {
      eng.addFx({ kind: 'ring', x: u.x, uy: u.uy, color: '#8be05c', r: 80, dur: 0.5 });
      for (const e of eng.units) {
        if (e.side !== u.side && eng.targetable(e) && Math.abs(e.x - u.x) <= 80) applyStatus(eng, e, 'poison', { stacks: 2 });
      }
    }
    if (u.uid === 'slime' && !u.small) {
      eng.addUnit(u.side, SMALL_SLIME, { x: clampX(u.x - 12), uy: u.uy, summon: true });
      eng.addUnit(u.side, SMALL_SLIME, { x: clampX(u.x + 12), uy: u.uy, summon: true });
    }
    if (u.uid === 'mimic') {
      eng.sides[1 - u.side].gold += 75;
      eng.emit({ t: 'react', x: u.x, uy: u.uy, text: '肥羊 +75', color: '#ffd166' });
    }
  }

  // ---------- 主动技能 ----------
  // when(eng,u) 返回 plan（不满足返回 null）；instant 直接生效；channel 蓄力后 end 生效
  const inFront = (u, x, maxD) => {
    const d = (x - u.x) * DIR(u.side);
    return d > 0 && d <= maxD;
  };
  const enemiesIn = (eng, u, pred) => eng.units.filter((e) => e.side !== u.side && eng.targetable(e) && pred(e));
  const LANE = R.lane.length;

  const SKILLS = {
    // 希尔薇 · 穿云箭：整条战线上的敌人各受 70 穿刺
    sylvie: {
      when(eng, u) {
        return enemiesIn(eng, u, (e) => inFront(u, e.x, LANE)).length >= 3 ? {} : null;
      },
      instant(eng, u) {
        for (const e of enemiesIn(eng, u, (e) => inFront(u, e.x, LANE))) damage(eng, u, e, 70, 'pierce', { skill: true });
        eng.addFx({ kind: 'line', x0: u.x, x1: u.x + DIR(u.side) * LANE, uy: u.uy, color: '#e8ffd6', dur: 0.35 });
      },
    },
    // 芙蕾雅 · 钉刺投矛：射程内造价最高的敌人，80 伤害 + 定身 2 秒
    freya: {
      when(eng, u) {
        const c = enemiesIn(eng, u, (e) => Math.abs(e.x - u.x) <= u.range + 12);
        if (!c.length) return null;
        c.sort((a, b) => b.def.cost - a.def.cost);
        return { target: c[0] };
      },
      instant(eng, u, plan) {
        const t = plan.target;
        eng.fireAttack(u, t, 'spear', () => {
          if (!eng.targetable(t)) return;
          damage(eng, u, t, 80, 'pierce', { skill: true });
          applyStatus(eng, t, 'root', { dur: 2 });
        });
      },
    },
    // 布朗 · 盾墙：敌方 2 个以上远程正在攻击时举盾 4 秒
    brown: {
      when(eng, u) {
        const n = eng.units.filter((e) => e.side !== u.side && e.ranged && e.swing && eng.alive(e)).length;
        return n >= 2 ? {} : null;
      },
      instant(eng, u) {
        u.shieldWallT = 4;
        eng.addFx({ kind: 'shield', x: u.x, uy: u.uy, color: '#d8c9a0', dur: 4, follow: u });
      },
    },
    // 札斯 · 影袭：瞬身到 400 内血最少的敌方远程身后，下一刀 ×2
    zass: {
      when(eng, u) {
        const c = enemiesIn(eng, u, (e) => e.ranged && Math.abs(e.x - u.x) <= 400);
        if (!c.length) return null;
        c.sort((a, b) => a.hp - b.hp);
        return { target: c[0] };
      },
      instant(eng, u, plan) {
        const t = plan.target;
        const from = u.x;
        u.x = clampX(t.x + DIR(u.side) * 24);
        u.nextHitMul = 2;
        u.swing = null;
        eng.addFx({ kind: 'dash', x0: from, x1: u.x, uy: u.uy, color: '#ff6b6b', dur: 0.25 });
      },
    },
    // 赛伦 · 烈焰风暴：敌群中心降火雨 5 秒，每秒 20 火伤 + 1 层灼烧
    seren: {
      when(eng, u) {
        const cands = enemiesIn(eng, u, (e) => Math.abs(e.x - u.x) <= u.range + 12);
        let best = null, bn = 0;
        for (const c of cands) {
          const n = enemiesIn(eng, u, (e) => Math.abs(e.x - c.x) <= 120).length;
          if (n > bn) { bn = n; best = c; }
        }
        return bn >= 4 ? { x: best.x } : null;
      },
      instant(eng, u, plan) {
        eng.addZone({ kind: 'rain', x: plan.x, side: u.side, r: 120, t: 5, tick: 1, acc: 0, src: u });
      },
    },
    // 莱恩 · 圣光冲锋：前方 250 内 2 个以上敌人时冲 220，沿途击退并造成 60 伤害，结束获得 200 圣盾
    lein: {
      when(eng, u) {
        return enemiesIn(eng, u, (e) => inFront(u, e.x, 250)).length >= 2 ? {} : null;
      },
      instant(eng, u) {
        u.charge = { left: 220, hit: new Set() };
        u.swing = null;
        eng.addFx({ kind: 'charge', x: u.x, uy: u.uy, color: '#ffe38a', dur: 0.6, follow: u });
      },
    },
    // 熔岩蠕虫 · 熔岩喷吐：前方 150 锥形 60 火伤 + 2 层灼烧，2 个以上敌人时喷
    worm: {
      when(eng, u) {
        return enemiesIn(eng, u, (e) => inFront(u, e.x, 150)).length >= 2 ? {} : null;
      },
      instant(eng, u) {
        for (const e of enemiesIn(eng, u, (e) => inFront(u, e.x, 150))) {
          damage(eng, u, e, 60, 'magic', { skill: true, element: 'fire' });
          applyStatus(eng, e, 'burn', { stacks: 2 });
        }
        eng.addFx({ kind: 'cone', x: u.x, uy: u.uy, dir: u.dir, len: 150, dur: 0.4 });
      },
    },
    // 玄 · 震山掌：优先打附近正在蓄力/施法的敌人，击退 140 并眩晕 1 秒
    xuan: {
      when(eng, u) {
        const casters = enemiesIn(eng, u, (e) => (e.cast || e.charge) && Math.abs(e.x - u.x) <= u.range + 60);
        if (casters.length) return { target: casters[0] };
        const t = eng.findTarget(u);
        return t && !t.isCrystal ? { target: t } : null;
      },
      instant(eng, u, plan) {
        const t = plan.target;
        if (!eng.targetable(t)) return;
        knock(eng, t, 140);
        applyStatus(eng, t, 'stun', { dur: 1 });
        eng.addFx({ kind: 'ring', x: t.x, uy: t.uy, color: '#c9f5c9', r: 40, dur: 0.3 });
      },
    },
    // 摩尔德 · 亡者复苏：250 内 2 具以上尸体，拉起最多 4 名骷髅（150 生命、16 攻击，15 秒）
    mordred: {
      when(eng, u) {
        const n = eng.bodies.filter((b) => b.corpse && Math.abs(b.x - u.x) <= 250).length;
        return n >= 2 ? {} : null;
      },
      instant(eng, u) {
        const list = eng.bodies
          .filter((b) => b.corpse && Math.abs(b.x - u.x) <= 250)
          .sort((a, b) => Math.abs(a.x - u.x) - Math.abs(b.x - u.x))
          .slice(0, 4);
        for (const b of list) {
          eng.removeBody(b);
          eng.addUnit(u.side, SUMMON_SKELETON, { x: b.x, uy: b.uy, summon: true, life: 15 });
        }
        eng.addFx({ kind: 'ring', x: u.x, uy: u.uy, color: '#c86bff', r: 250, dur: 0.6 });
      },
    },
    // 奥林 · 冰封领域：蓄力 1 秒，160 范围内 80 魔法伤害并叠满寒霜（直接冻结 1.5 秒）
    olin: {
      channel: { dur: 1 },
      when(eng, u) {
        const cands = enemiesIn(eng, u, (e) => Math.abs(e.x - u.x) <= u.range + 12);
        let best = null, bn = 0;
        for (const c of cands) {
          const n = enemiesIn(eng, u, (e) => Math.abs(e.x - c.x) <= 160).length;
          if (n > bn) { bn = n; best = c; }
        }
        return bn >= 3 ? { x: best.x } : null;
      },
      end(eng, u, plan) {
        for (const e of enemiesIn(eng, u, (e) => Math.abs(e.x - plan.x) <= 160)) {
          damage(eng, u, e, 80, 'magic', { skill: true, element: 'frost' });
          applyStatus(eng, e, 'chill', { stacks: 3 });
        }
        eng.addFx({ kind: 'ring', x: plan.x, uy: 0, color: '#7dd8ff', r: 160, dur: 0.6 });
      },
    },
    // 夜叉 · 居合·断：蓄力 1.5 秒，前方 260 直线上所有敌人 220 斩击，击杀返还 2 秒冷却
    yaksha: {
      channel: { dur: 1.5 },
      when(eng, u) {
        return enemiesIn(eng, u, (e) => inFront(u, e.x, 260)).length >= 3 ? {} : null;
      },
      end(eng, u) {
        for (const e of enemiesIn(eng, u, (e) => inFront(u, e.x, 260))) {
          damage(eng, u, e, 220, 'slash', { skill: true });
          if (e.hp <= 0) u.skillCd = Math.max(0, u.skillCd - 2);
        }
        eng.addFx({ kind: 'slash', x: u.x, uy: u.uy, dir: u.dir, len: 260, dur: 0.35 });
      },
    },
    // 雷克斯 · 王之号令：场上 5 个以上友军且正在交战时，全场友军获得 150 圣盾和一次不屈
    rex: {
      when(eng, u) {
        const friends = eng.units.filter((e) => e.side === u.side && eng.alive(e));
        if (friends.length < 5 || !friends.some((e) => e.swing)) return null;
        return {};
      },
      instant(eng, u) {
        for (const f of eng.units.filter((e) => e.side === u.side && eng.alive(e))) {
          applyStatus(eng, f, 'holyShield', { absorb: 150 });
          applyStatus(eng, f, 'unyielding');
        }
        eng.addFx({ kind: 'ring', x: u.x, uy: u.uy, color: '#ffe38a', r: 200, dur: 0.6 });
      },
    },
  };

  // 尝试释放技能：冷却好了且满足条件就放（玩家和电脑一样）
  function trySkill(eng, u) {
    const def = u.def.skill;
    const sk = SKILLS[u.uid];
    if (!def || !sk || u.skillCd > 0) return false;
    const plan = sk.when(eng, u);
    if (!plan) return false;
    u.skillCd = def.cd;
    eng.emit({ t: 'skill', side: u.side, uid: u.uid, name: def.name, x: u.x, uy: u.uy });
    if (sk.channel) {
      u.cast = { t: 0, dur: sk.channel.dur, plan };
      return true;
    }
    sk.instant(eng, u, plan);
    return true;
  }

  function castStep(eng, u, dt) {
    const c = u.cast;
    c.t += dt;
    if (c.t < c.dur) return;
    u.cast = null;
    SKILLS[u.uid].end(eng, u, c.plan);
  }

  // 莱恩的冲锋：沿途每个敌人只吃一次伤害并被击退
  function chargeStep(eng, u, dt) {
    const c = u.charge;
    const step = Math.min(c.left, 500 * dt);
    u.x = clampX(u.x + DIR(u.side) * step);
    c.left -= step;
    u.hitT = 0;
    for (const e of enemiesIn(eng, u, (e) => Math.abs(e.x - u.x) <= 18)) {
      if (c.hit.has(e)) continue;
      c.hit.add(e);
      damage(eng, u, e, 60, 'slash', { skill: true });
      knock(eng, e, 50);
    }
    if (c.left <= 0) {
      u.charge = null;
      applyStatus(eng, u, 'holyShield', { absorb: 200 });
    }
  }

  function zoneTick(eng, z, dt) {
    z.acc += dt;
    while (z.acc >= z.tick) {
      z.acc -= z.tick;
      for (const e of eng.units.slice()) {
        if (e.side === z.side || !eng.targetable(e) || Math.abs(e.x - z.x) > z.r) continue;
        damage(eng, z.src, e, 20, 'magic', { skill: true, element: 'fire' });
        applyStatus(eng, e, 'burn', { stacks: 1 });
      }
    }
  }

  window.Combat = {
    BY_ID,
    SKILLS,
    DIR,
    hasTag,
    has,
    stacksOf,
    clampX,
    freeze,
    interrupt,
    applyStatus,
    knock,
    slowMul,
    damage,
    splashAt,
    hitAttack,
    tickStatuses,
    tryBones,
    reform,
    shatter,
    onDeath,
    trySkill,
    castStep,
    chargeStep,
    zoneTick,
    inFront,
  };
})();
