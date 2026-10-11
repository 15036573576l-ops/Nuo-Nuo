// 糯糯战记 · 战斗规则：伤害管线、状态系统、元素反应、特性、主动技能和撒旦
// 纯逻辑，不碰 DOM / canvas。数值来自 rules.js 和 units.js；技能 desc 里的数值优先。
// 约定：side 0 = 玩家（朝右走），side 1 = 电脑（朝左走）。位置全部是二维的 (x, y)。
(function () {
  const R = window.RULES;
  const UNITS = window.UNITS;
  const BY_ID = {};
  UNITS.concat(window.SPECIAL_UNITS || []).forEach((d) => { BY_ID[d.id] = d; });
  const CC_IMMUNE = { stun: 1, frozen: 1, root: 1, chill: 1, weaken: 1, vulnerable: 1 };
  const MAX_R = 40;        // 单位半径上限，范围查询要多留这一截
  const DEG = Math.PI / 180;

  const DIR = (side) => (side === 0 ? 1 : -1);
  const hasTag = (u, tag) => u.def.tags.indexOf(tag) >= 0;
  // 水晶没有 st 字段，所以这里先判断有没有
  const st = (u, id) => (u.st && u.st[id] && u.st[id].t > 0 ? u.st[id] : null);
  const has = (u, id) => !!st(u, id);
  const stacksOf = (u, id) => (st(u, id) ? st(u, id).stacks || 0 : 0);

  // 把单位放到 (x, y)，限制在地图内：x ∈ [r, w - r]，y ∈ [r, h - r]
  function place(u, x, y) {
    const r = u.radius;
    u.x = Math.max(r, Math.min(R.map.w - r, x));
    u.y = Math.max(r, Math.min(R.map.h - r, y));
  }

  // 位移扫掠：沿 (dx, dy) 走，撞上水晶圆（水晶半径 + 单位半径）就停在圆边上，不会越过水晶落到另一侧
  // 返回走过的比例 s ∈ [0, 1]；起点已经在圆里的不管（推挤会修正）
  function sweepFrac(eng, u, dx, dy) {
    let s = 1;
    const a = dx * dx + dy * dy;
    if (a <= 0) return s;
    for (const c of eng.crystals) {
      if (c.hp <= 0) continue;
      const R2 = c.radius + u.radius;
      const fx = u.x - c.x, fy = u.y - c.y;
      if (fx * fx + fy * fy < R2 * R2) continue;
      const b = 2 * (fx * dx + fy * dy);
      const k = fx * fx + fy * fy - R2 * R2;
      const disc = b * b - 4 * a * k;
      if (disc < 0) continue;
      const s0 = (-b - Math.sqrt(disc)) / (2 * a);   // 第一次碰到圆的位置
      if (s0 >= 0 && s0 < s) s = s0;
    }
    return s;
  }
  // 按扫掠结果位移；返回 true 表示被水晶挡住了
  function displace(eng, u, dx, dy) {
    const s = sweepFrac(eng, u, dx, dy);
    place(u, u.x + dx * s, u.y + dy * s);
    return s < 1;
  }

  // 水晶用“重甲”算，攻城伤害另算 ×3
  function armorMul(tgt, dmgType) {
    if (tgt.isCrystal) return dmgType === 'siege' ? R.damageMatrix.siege.crystal : R.damageMatrix[dmgType].heavy;
    return R.damageMatrix[dmgType][tgt.def.armor];
  }

  // 召唤物定义（不占人口、不留尸体）
  const SUMMON_SKELETON = Object.assign({}, BY_ID.skeleton, { hp: 150, atk: 16, aspd: 1.0, traits: [], skill: null, cost: 0 });
  const SMALL_SLIME = Object.assign({}, BY_ID.slime, { hp: 110, atk: 7, traits: [], skill: null, cost: 0, small: true });

  // ---------- 几何辅助（全部按攻击方的朝向 (u.dir, 0)） ----------
  const fwd = (u, p) => (p.x - u.x) * u.dir;
  const lat = (u, p) => Math.abs(p.y - u.y);
  // 矩形：朝前 len，半宽 halfW；p 的半径算进去
  function inRect(u, p, len, halfW) {
    const f = fwd(u, p);
    return f > -p.radius && f <= len + p.radius && lat(u, p) <= halfW + p.radius;
  }
  // 扇形：朝前 len，半角 halfDeg（度）
  function inCone(u, p, len, halfDeg) {
    const f = fwd(u, p);
    return f > 0 && f <= len && lat(u, p) <= f * Math.tan(halfDeg * DEG) + p.radius;
  }
  // 盾墙范围：布朗身后 120 px（含布朗自己），横向 ±60，都算上目标的半径
  function shieldCovers(b, p) {
    const back = (b.x - p.x) * b.dir;
    return back > -p.radius && back <= 120 + p.radius && Math.abs(p.y - b.y) <= 60 + p.radius;
  }

  // ---------- 范围查询（全部走空间网格，不扫全表） ----------
  // 圆形：u 的敌方可攻击单位，中心距离 ≤ r
  const foesNear = (eng, u, x, y, r) => eng.unitsNear(x, y, r).filter((e) => e.side !== u.side && eng.targetable(e));
  // 攻击距离内的敌方（用 inReach 判定，pad 是额外的余量）
  const foesReach = (eng, u, pad = 0) => foesNear(eng, u, u.x, u.y, u.range + u.radius + MAX_R + 4 + pad).filter((e) => eng.inReach(u, e, pad));
  // 矩形 / 扇形：先用包围盒从网格里取，再用几何判定
  function foesRect(eng, u, len, halfW) {
    const x0 = u.dir > 0 ? u.x - MAX_R : u.x - len - MAX_R;
    const x1 = u.dir > 0 ? u.x + len + MAX_R : u.x + MAX_R;
    return eng.unitsBox(x0, x1, u.y - halfW - MAX_R, u.y + halfW + MAX_R)
      .filter((e) => e.side !== u.side && eng.targetable(e) && inRect(u, e, len, halfW));
  }
  function foesCone(eng, u, len, halfDeg) {
    const spread = len * Math.tan(halfDeg * DEG) + MAX_R;
    const x0 = u.dir > 0 ? u.x - MAX_R : u.x - len - MAX_R;
    const x1 = u.dir > 0 ? u.x + len + MAX_R : u.x + MAX_R;
    return eng.unitsBox(x0, x1, u.y - spread, u.y + spread)
      .filter((e) => e.side !== u.side && eng.targetable(e) && inCone(u, e, len, halfDeg));
  }
  // 敌群中心：候选中心在攻击距离内，以候选为圆心、r 圆内的敌人最多；够 need 个才返回
  function crowdCenter(eng, u, r, need) {
    let best = null, bn = 0;
    for (const c of foesReach(eng, u)) {
      const n = foesNear(eng, u, c.x, c.y, r).length;
      if (n > bn) { bn = n; best = c; }
    }
    return bn >= need ? best : null;
  }
  const bodiesNear = (eng, u, r) => eng.bodies.filter((b) => b.corpse && Math.hypot(b.x - u.x, b.y - u.y) <= r);

  // ---------- 状态 ----------
  function freeze(eng, u) {
    if (u.imm.frozen > 0 || has(u, 'frozen')) return false;
    const d = R.statuses.frozen.duration;
    u.st.frozen = { t: d };
    delete u.st.chill;
    u.imm.frozen = d + R.statuses.frozen.immuneAfter; // 解冻后再免疫 4 秒
    interrupt(eng, u, 'freeze');
    eng.emit({ t: 'react', x: u.x, y: u.y, text: '冻结', color: '#9fe8ff' });
    return true;
  }

  // 打断：眩晕/冻结取消攻击和冲锋；击退和眩晕都会打断蓄力和施法（夜叉被打断后进入半冷却）
  function interrupt(eng, u, why) {
    if (u.cast) {
      if (u.uid === 'yaksha' && u.def.skill) u.skillCd = u.def.skill.cd / 2;
      eng.emit({ t: 'react', x: u.x, y: u.y, text: '打断', color: '#ffb36b' });
      u.cast = null;
    }
    if (why === 'stun' || why === 'freeze') {
      u.swing = null;
      u.charge = null;
    }
  }

  function applyStatus(eng, u, id, o = {}) {
    if (!u || u.dead || u.bones || u.pendingDeath) return false;
    // 水晶只吃易伤（攻击水晶的单位带易伤，水晶挨打时 ×1.2）；计时在引擎的水晶循环里走
    if (u.isCrystal && id !== 'vulnerable') return false;
    const def = R.statuses[id];
    if (!def) return false;
    if (id === 'poison' && hasTag(u, 'undead')) return false;     // 不死免疫中毒
    if (u.def && u.def.ccImmune && CC_IMMUNE[id]) return false;   // 撒旦：魔王之躯（水晶没有 def）
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

  // 击退：沿单位向量 (nx, ny) 推开。巨型免疫；盾墙期间不会被击退；打断蓄力
  function knock(eng, u, nx, ny, dist) {
    if (u.isCrystal || u.dead || hasTag(u, 'giant') || u.shieldWallT > 0) return;
    displace(eng, u, nx * dist, ny * dist);
    u.hitT = 0;
    interrupt(eng, u, 'knock');
  }

  function slowMul(u) {
    const c = stacksOf(u, 'chill');
    return c ? 1 - R.statuses.chill.slowPerStack * c : 1;
  }

  // 生命扣减的公共入口：不死（不屈）和死亡登记
  function takeHp(eng, u, dmg, quiet) {
    if (u.invuln > 0) return;     // 无敌期间（不灭、不屈的 1.5 秒）扣不动血，持续伤害也一样
    u.hp -= dmg;
    if (!quiet) u.hitT = 0;
    if (u.hp <= 0 && !u.pendingDeath) {
      if (has(u, 'unyielding')) {
        u.hp = 1;
        u.invuln = 1.5;
        delete u.st.unyielding;
        eng.emit({ t: 'react', x: u.x, y: u.y, text: '不屈', color: '#ffe38a' });
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
    if (eng.cheats && eng.cheats.godMode[u.side]) { delete u.st.burn; delete u.st.poison; }
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

    // 伤害来源的阵营：有攻击者取攻击者的，炮塔没有攻击者就用 o.side 指明
    const cheats = eng.cheats;
    const srcSide = src ? src.side : o.side;
    const cheatMul = cheats && srcSide != null ? cheats.dmgMul[srcSide] : 1;
    if (tgt.isCrystal) {
      if (cheats && cheats.invuln[tgt.side]) return 0;
      // 水晶：护甲按水晶规则（重甲，攻城 ×3）；攻击方的衰弱、雷克斯光环和目标的易伤照常生效
      let mul = armorMul(tgt, dmgType) * cheatMul;
      if (src) {
        if (has(src, 'weaken')) mul *= R.statuses.weaken.damageDealtMul;
        if (eng.rexAura(src)) mul *= 1.15;
        if (o.attack && src.nextHitMul) { mul *= src.nextHitMul; src.nextHitMul = 0; }   // 札斯的“下一刀”打在水晶上也消耗
      }
      if (has(tgt, 'vulnerable')) mul *= R.statuses.vulnerable.damageTakenMul; // 和单位同一条易伤修正
      const dmg = base * mul;
      tgt.hp -= dmg;
      eng.emit({ t: 'num', x: tgt.x, y: tgt.y, v: Math.round(dmg), color: '#ffd166' });
      return dmg;
    }
    if (tgt.bones) {
      if (elem === 'holy' || o.splash) shatter(eng, tgt);       // 骨堆只吃圣属性和溅射
      return 0;
    }
    if (tgt.hp <= 0 || tgt.dead || tgt.invuln > 0) return 0;

    if (o.attack && tgt.uid === 'zass' && dmgType === 'pierce' && eng.rng() < 0.3) {
      eng.emit({ t: 'react', x: tgt.x, y: tgt.y, text: '闪避', color: '#cfe8ff' });
      return 0;
    }
    if (o.attack && tgt.uid === 'xuan') {
      tgt.hitCount += 1;
      if (tgt.hitCount % 4 === 0) {
        eng.emit({ t: 'react', x: tgt.x, y: tgt.y, text: '化劲', color: '#c9f5c9' });
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
          eng.emit({ t: 'react', x: tgt.x, y: tgt.y, text: '圣裁', color: '#ffe38a' });
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

    if (cheats && cheats.godMode[tgt.side]) return 0;
    let dmg = base * mul * cheatMul;
    const sh = st(tgt, 'holyShield');
    if (sh && sh.absorb > 0 && dmg > 0) {
      const a = Math.min(sh.absorb, dmg);
      sh.absorb -= a;
      dmg -= a;
    }
    if (dmg <= 0) return 0;

    takeHp(eng, tgt, dmg);
    const hot = armor > 1 || special;
    eng.emit({ t: 'num', x: tgt.x, y: tgt.y, v: Math.round(dmg), color: hot ? '#ffd166' : '#ffffff' });

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
      eng.emit({ t: 'react', x: tgt.x, y: tgt.y, text: '融化', color: '#ffb36b' });
      damage(eng, src, tgt, 60 + 20 * layers, 'magic', { noReaction: true, element: 'fire' });
    }
    const n = stacksOf(tgt, 'poison');
    if (n >= 3) {
      delete tgt.st.poison;
      eng.emit({ t: 'react', x: tgt.x, y: tgt.y, text: '爆燃', color: '#ff7a3d' });
      for (const e of eng.unitsNear(tgt.x, tgt.y, 80)) {
        if (e.side !== tgt.side || !(eng.targetable(e) || e.bones)) continue;
        damage(eng, src, e, 15 * n, 'magic', { noReaction: true, element: 'fire', splash: true });
      }
    }
  }

  // 溅射：以 (x, y) 为圆心，r 范围内的敌方全部受伤（骨堆会被散架）
  function splashAt(eng, src, x, y, r, exclude, dmgType, base, element) {
    for (const e of eng.unitsNear(x, y, r)) {
      if (e.side === src.side || e === exclude) continue;
      if (!(eng.targetable(e) || e.bones)) continue;
      damage(eng, src, e, base, dmgType, { splash: true, element });
    }
  }

  // 普通攻击命中：伤害 → 附加状态 → 吸血 → 溅射
  function hitAttack(eng, u, tgt, splashR) {
    const dealt = damage(eng, u, tgt, u.atk, u.dmgType, { attack: true, element: u.def.element });
    if (dealt > 0) {
      for (const h of u.def.onHit) applyStatus(eng, tgt, h.status, { stacks: h.stacks });
      if (u.uid === 'bats') heal(u, dealt * 0.6);
    }
    if (splashR) splashAt(eng, u, tgt.x, tgt.y, splashR, tgt, u.dmgType, u.atk, u.def.element);
  }

  function shatter(eng, u) {
    u.bones = false;
    eng.removeUnit(u);
    eng.emit({ t: 'react', x: u.x, y: u.y, text: '散架', color: '#e8e0d0' });
  }

  // ---------- 死亡特性 ----------
  // 返回 true 表示没死，进入骨堆（或撒旦原地复活）
  function tryBones(eng, u) {
    if (u.uid === 'satan' && !u.reviveUsed) {
      u.reviveUsed = true;
      u.hp = u.maxHp;
      u.invuln = 3;
      u.st = {};
      eng.addFx({ kind: 'ring', x: u.x, y: u.y, color: '#ff4d2e', r: 260, dur: 0.9 });
      eng.emit({ t: 'react', x: u.x, y: u.y, text: '不灭', color: '#ff7a3d' });
      return true;
    }
    if (u.uid !== 'skeleton' || u.summon || u.reformUsed) return false;
    u.bones = true;
    u.bonesT = 3;
    u.reformUsed = true;
    u.hp = 0;
    u.st = {};
    u.swing = null;
    u.cast = null;
    u.charge = null;
    eng.emit({ t: 'react', x: u.x, y: u.y, text: '白骨重组', color: '#e8e0d0' });
    return true;
  }

  function reform(eng, u) {
    u.bones = false;
    u.hp = Math.round(u.maxHp * 0.5);
    u.st = {};
    u.hitT = 0;
    eng.emit({ t: 'react', x: u.x, y: u.y, text: '站起来', color: '#e8e0d0' });
  }

  function onDeath(eng, u) {
    if (u.uid === 'mushroom') {
      eng.addFx({ kind: 'ring', x: u.x, y: u.y, color: '#8be05c', r: 80, dur: 0.5 });
      for (const e of foesNear(eng, u, u.x, u.y, 80)) applyStatus(eng, e, 'poison', { stacks: 2 });
    }
    if (u.uid === 'slime' && !u.small) {
      eng.addUnit(u.side, SMALL_SLIME, { x: u.x - 12, y: u.y, summon: true });
      eng.addUnit(u.side, SMALL_SLIME, { x: u.x + 12, y: u.y, summon: true });
    }
    if (u.uid === 'mimic') {
      eng.sides[1 - u.side].gold += 75;
      eng.emit({ t: 'react', x: u.x, y: u.y, text: '肥羊 +75', color: '#ffd166' });
    }
  }

  // ---------- 主动技能 ----------
  // when(eng,u) 返回 plan（不满足返回 null）；instant 直接生效；channel 蓄力后 end 生效
  const SKILLS = {
    // 希尔薇 · 穿云箭：朝前整条战线（矩形，半宽 40）上的敌人各受 70 穿刺
    sylvie: {
      when(eng, u) {
        return foesRect(eng, u, R.map.w, 40).length >= 3 ? {} : null;
      },
      instant(eng, u) {
        for (const e of foesRect(eng, u, R.map.w, 40)) damage(eng, u, e, 70, 'pierce', { skill: true });
        eng.addFx({ kind: 'line', x: u.x, y: u.y, x2: u.x + u.dir * R.map.w, y2: u.y, color: '#e8ffd6', dur: 0.35 });
      },
    },
    // 芙蕾雅 · 钉刺投矛：攻击距离内造价最高的敌人，80 伤害 + 定身 2 秒
    freya: {
      when(eng, u) {
        const c = foesReach(eng, u);
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
    // 布朗 · 盾墙：600 范围内 2 个以上敌方远程正在挥击我方（目标在我方）时举盾 4 秒
    brown: {
      when(eng, u) {
        const n = eng.unitsNear(u.x, u.y, 600).filter((e) => e.side !== u.side && e.ranged && eng.alive(e) &&
          e.swing && e.swing.target && e.swing.target.side === u.side).length;
        return n >= 2 ? {} : null;
      },
      instant(eng, u) {
        u.shieldWallT = 4;
        eng.addFx({ kind: 'shield', x: u.x, y: u.y, color: '#d8c9a0', dur: 4, follow: u });
      },
    },
    // 札斯 · 影袭：瞬身到 400 内血最少的敌方远程身后（同一 y），下一刀 ×2
    zass: {
      when(eng, u) {
        const c = foesNear(eng, u, u.x, u.y, 400).filter((e) => e.ranged);
        if (!c.length) return null;
        c.sort((a, b) => a.hp - b.hp);
        return { target: c[0] };
      },
      instant(eng, u, plan) {
        const t = plan.target;
        const fx = u.x, fy = u.y;
        place(u, t.x + u.dir * 24, t.y);
        u.nextHitMul = 2;
        u.swing = null;
        eng.addFx({ kind: 'dash', x: fx, y: fy, x2: u.x, y2: u.y, color: '#ff6b6b', dur: 0.25 });
      },
    },
    // 赛伦 · 烈焰风暴：以敌群中心为圆心、半径 120 降火雨 5 秒，每秒 20 火伤 + 1 层灼烧
    seren: {
      when(eng, u) {
        const c = crowdCenter(eng, u, 120, 4);
        return c ? { x: c.x, y: c.y } : null;
      },
      instant(eng, u, plan) {
        eng.addZone({ kind: 'rain', x: plan.x, y: plan.y, side: u.side, r: 120, t: 5, tick: 1, acc: 0, src: u });
      },
    },
    // 莱恩 · 圣光冲锋：前方矩形（250 长、半宽 36）内 2 个以上敌人时冲 220，沿途击退并造成 60 伤害，结束获得 200 圣盾
    lein: {
      when(eng, u) {
        return foesRect(eng, u, 250, 36).length >= 2 ? {} : null;
      },
      instant(eng, u) {
        u.charge = { left: 220, hit: new Set() };
        u.swing = null;
        eng.addFx({ kind: 'charge', x: u.x, y: u.y, color: '#ffe38a', dur: 0.6, follow: u });
      },
    },
    // 熔岩蠕虫 · 熔岩喷吐：前方 150 锥形（半角 45 度）内 2 个以上敌人时喷，60 火伤 + 2 层灼烧
    worm: {
      when(eng, u) {
        return foesCone(eng, u, 150, 45).length >= 2 ? {} : null;
      },
      instant(eng, u) {
        for (const e of foesCone(eng, u, 150, 45)) {
          damage(eng, u, e, 60, 'magic', { skill: true, element: 'fire' });
          applyStatus(eng, e, 'burn', { stacks: 2 });
        }
        eng.addFx({ kind: 'cone', x: u.x, y: u.y, dir: u.dir, len: 150, halfDeg: 45, dur: 0.4 });
      },
    },
    // 玄 · 震山掌：优先攻击距离 + 60 内正在蓄力的敌人，否则攻击当前目标；击退 140（从玄指向目标）并眩晕 1 秒
    xuan: {
      when(eng, u) {
        const casters = foesReach(eng, u, 60).filter((e) => e.cast || e.charge);
        if (casters.length) return { target: casters[0] };
        const t = eng.findTarget(u);
        return t && !t.isCrystal ? { target: t } : null;
      },
      instant(eng, u, plan) {
        const t = plan.target;
        if (!eng.targetable(t)) return;
        const d = Math.hypot(t.x - u.x, t.y - u.y);
        const nx = d > 1e-6 ? (t.x - u.x) / d : u.dir;
        const ny = d > 1e-6 ? (t.y - u.y) / d : 0;
        knock(eng, t, nx, ny, 140);
        applyStatus(eng, t, 'stun', { dur: 1 });
        eng.addFx({ kind: 'ring', x: t.x, y: t.y, color: '#c9f5c9', r: 40, dur: 0.3 });
      },
    },
    // 摩尔德 · 亡者复苏：250 内 2 具以上尸体，拉起最近的最多 4 名骷髅（150 生命、16 攻击，15 秒）
    mordred: {
      when(eng, u) {
        return bodiesNear(eng, u, 250).length >= 2 ? {} : null;
      },
      instant(eng, u) {
        const list = bodiesNear(eng, u, 250)
          .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))
          .slice(0, 4);
        for (const b of list) {
          eng.removeBody(b);
          eng.addUnit(u.side, SUMMON_SKELETON, { x: b.x, y: b.y, summon: true, life: 15 });
        }
        eng.addFx({ kind: 'ring', x: u.x, y: u.y, color: '#c86bff', r: 250, dur: 0.6 });
      },
    },
    // 奥林 · 冰封领域：蓄力 1 秒，目标圆心 160 范围内 80 魔法伤害并叠满 3 层寒霜（直接冻结 1.5 秒）
    olin: {
      channel: { dur: 1 },
      when(eng, u) {
        const c = crowdCenter(eng, u, 160, 3);
        return c ? { x: c.x, y: c.y } : null;
      },
      end(eng, u, plan) {
        for (const e of foesNear(eng, u, plan.x, plan.y, 160)) {
          damage(eng, u, e, 80, 'magic', { skill: true, element: 'frost' });
          applyStatus(eng, e, 'chill', { stacks: 3 });
        }
        eng.addFx({ kind: 'ring', x: plan.x, y: plan.y, color: '#7dd8ff', r: 160, dur: 0.6 });
      },
    },
    // 夜叉 · 居合·断：蓄力 1.5 秒，前方矩形（260 长、半宽 50）内所有敌人 220 斩击，击杀返还 2 秒冷却
    yaksha: {
      channel: { dur: 1.5 },
      when(eng, u) {
        return foesRect(eng, u, 260, 50).length >= 3 ? {} : null;
      },
      end(eng, u) {
        for (const e of foesRect(eng, u, 260, 50)) {
          damage(eng, u, e, 220, 'slash', { skill: true });
          if (e.hp <= 0) u.skillCd = Math.max(0, u.skillCd - 2);
        }
        eng.addFx({ kind: 'rect', x: u.x, y: u.y, dir: u.dir, len: 260, halfW: 50, dur: 0.35 });
      },
    },
    // 雷克斯 · 王之号令：场上 5 个以上友军且有人在挥击时，全场友军获得 150 圣盾和一次不屈
    rex: {
      when(eng, u) {
        return eng.stat.alive[u.side] >= 5 && eng.stat.swing[u.side] > 0 ? {} : null;
      },
      instant(eng, u) {
        for (const f of eng.units) {
          if (f.side !== u.side || !eng.alive(f)) continue;
          applyStatus(eng, f, 'holyShield', { absorb: 150 });
          applyStatus(eng, f, 'unyielding');
        }
        eng.addFx({ kind: 'ring', x: u.x, y: u.y, color: '#ffe38a', r: 200, dur: 0.6 });
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
    eng.emit({ t: 'skill', side: u.side, uid: u.uid, name: def.name, x: u.x, y: u.y });
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

  // 莱恩的冲锋：沿途每个敌人只吃一次伤害并被击退（沿冲锋方向）
  function chargeStep(eng, u, dt) {
    const c = u.charge;
    const step = Math.min(c.left, 500 * dt);
    // 撞上水晶就停在圆边，冲锋到此结束
    if (displace(eng, u, u.dir * step, 0)) c.left = 0;
    else c.left -= step;
    u.hitT = 0;
    for (const e of foesNear(eng, u, u.x, u.y, 36 + 2 * MAX_R)) {
      if (c.hit.has(e) || !inRect(u, e, 0, 36)) continue;
      c.hit.add(e);
      damage(eng, u, e, 60, 'slash', { skill: true });
      knock(eng, e, u.dir, 0, 50);
    }
    if (c.left <= 0) {
      u.charge = null;
      applyStatus(eng, u, 'holyShield', { absorb: 200 });
    }
  }

  // 区域（火雨）：每个 tick 对圆内的敌方可攻击单位造成伤害并叠灼烧
  function zoneTick(eng, z, dt) {
    z.acc += dt;
    while (z.acc >= z.tick) {
      z.acc -= z.tick;
      for (const e of eng.unitsNear(z.x, z.y, z.r)) {
        if (e.side === z.side || !eng.targetable(e)) continue;
        damage(eng, z.src, e, 20, 'magic', { skill: true, element: 'fire' });
        applyStatus(eng, e, 'burn', { stacks: 1 });
      }
    }
  }

  // ---------- 撒旦：炼狱光环（引擎每 tick 调用）和三个手动技能 ----------
  function satanAura(eng, u, dt) {
    u.auraT = (u.auraT || 0) - dt;
    if (u.auraT > 0) return;
    u.auraT = 0.5;
    for (const e of eng.unitsNear(u.x, u.y, 200)) {
      if (e.side === u.side || !eng.targetable(e)) continue;
      damage(eng, u, e, 30, 'magic', { skill: true, element: 'fire', noReaction: true });
      applyStatus(eng, e, 'burn', { stacks: 1 });
    }
  }

  const SATAN_SUMMON = Object.assign({}, BY_ID.skeleton, { hp: 300, atk: 30, traits: [], skill: null, cost: 0 });

  // 手动技能的效果都是全场范围（平面上没有“线”，全场就是整张地图）
  const MANUAL = {
    // 地狱火雨：全场敌军 400 火伤 + 3 层灼烧，敌方水晶 500 伤害（水晶那一下除掉了护甲倍率）
    meteor(eng, sat) {
      for (const e of eng.units.slice()) {
        if (e.side === sat.side || !eng.alive(e)) continue;
        eng.addFx({ kind: 'meteor', x: e.x, y: e.y, dur: 0.7 });
        damage(eng, sat, e, 400, 'magic', { skill: true, element: 'fire' });
        applyStatus(eng, e, 'burn', { stacks: 3 });
      }
      const c = eng.crystals[1 - sat.side];
      if (c.hp > 0) {
        damage(eng, sat, c, 500 / R.damageMatrix.magic.heavy, 'magic', { skill: true });
        eng.addFx({ kind: 'meteor', x: c.x, y: c.y, dur: 0.7 });
      }
      eng.addFx({ kind: 'tint', color: '255,90,30', dur: 0.5 });
    },
    // 深渊威压：全场敌军沿撒旦指向敌人的方向击退 180，眩晕 4 秒，无视巨型减半，打断蓄力和冲锋
    dread(eng, sat) {
      for (const e of eng.units.slice()) {
        if (e.side === sat.side || e.dead || e.pendingDeath || e.bones) continue;
        e.charge = null;
        interrupt(eng, e, 'stun');
        e.st.stun = { t: 4 };
        e.imm.stun = 4 + R.statuses.stun.immuneAfter;   // 和普通眩晕一样，结束后再免疫 2 秒
        const dx = e.x - sat.x, dy = e.y - sat.y;
        const d = Math.hypot(dx, dy);
        const nx = d > 1e-6 ? dx / d : -e.dir;   // 恰好重合时朝敌方背后推
        const ny = d > 1e-6 ? dy / d : 0;
        displace(eng, e, nx * 180, ny * 180);
        e.hitT = 0;
      }
      eng.addFx({ kind: 'darkwave', x: sat.x, y: sat.y, dur: 0.9 });
      eng.addFx({ kind: 'tint', color: '120,40,180', dur: 0.8 });
    },
    // 灵魂收割：处决全场生命低于 40% 的敌军，每个 +25 金币、撒旦回复 5% 生命，最多 8 个变成骷髅（20 秒）
    reap(eng, sat) {
      let souls = 0;
      for (const e of eng.units.slice()) {
        if (e.side === sat.side || e.dead || e.pendingDeath) continue;
        if (e.bones) { shatter(eng, e); continue; }
        if (e.hp > e.maxHp * 0.4) continue;
        if (eng.cheats && eng.cheats.godMode[e.side]) continue;   // 作弊的单位无敌：处决也不生效
        eng.addFx({ kind: 'soul', x: e.x, y: e.y, dur: 1.1 });
        e.hp = 0;
        e.reformUsed = true;
        e.reviveUsed = true;
        delete e.st.unyielding;
        e.invuln = 0;
        eng.markDead(e);
        if (souls < 8) eng.addUnit(sat.side, SATAN_SUMMON, { x: e.x, y: e.y, summon: true, life: 20 });
        souls++;
      }
      eng.sides[sat.side].gold += 25 * souls;
      heal(sat, sat.maxHp * 0.05 * souls);
      eng.emit({ t: 'react', x: sat.x, y: sat.y, text: `收割 ${souls} 个灵魂`, color: '#9fe8ff' });
      eng.addFx({ kind: 'tint', color: '120,220,255', dur: 0.5 });
    },
  };

  // 玩家手动释放撒旦的技能：返回 'ok' / 'nosatan' / 'cooldown'（序号越界返回 'no'）
  function manualCast(eng, side, idx) {
    const def = BY_ID.satan.manualSkills[idx];
    if (!def) return 'no';
    const sat = eng.units.find((u) => u.side === side && u.uid === 'satan' && eng.alive(u));
    if (!sat) return 'nosatan';
    const cds = eng.sides[side].manualCd;
    if (cds[idx] > 0) return 'cooldown';
    cds[idx] = eng.cheats && eng.cheats.satanNoCd ? 0 : def.cd;
    eng.emit({ t: 'skill', side, uid: 'satan', name: def.name, x: sat.x, y: sat.y });
    MANUAL[def.id](eng, sat);
    return 'ok';
  }

  window.Combat = {
    satanAura,
    manualCast,
    castManual: manualCast,   // 界面端沿用的旧名字
    BY_ID,
    SKILLS,
    DIR,
    hasTag,
    has,
    stacksOf,
    place,
    fwd,
    lat,
    inRect,
    inCone,
    shieldCovers,
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
  };
})();
