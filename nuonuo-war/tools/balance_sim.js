// 简易平衡模拟：两种兵各花同样的钱，在一条线上对打，统计谁赢、剩多少钱的兵。
// 不模拟主动技能，只模拟：克制倍率、远程/飞行、溅射、群体、中毒/灼烧/寒霜、
// 史莱姆分裂与凝胶、骷髅重组、吸血、钻地、见切、化劲、易伤/衰弱。
// 用法：node tools/balance_sim.js [预算]
global.window = {};
require('../src/rules.js');
require('../src/units.js');
const R = window.RULES, U = window.UNITS;
const BUDGET = Number(process.argv[2] || 600);
const DT = 0.05;

const FRONT = process.argv.includes('--front'); // 双方都带 300 金骷髅前排，测“放进阵容里”的价值
function spawnArmy(def, side) {
  const out = [];
  const base = side === 0 ? 300 : 1000, dir = side === 0 ? -1 : 1;
  if (FRONT) {
    const sk = U.find((u) => u.id === 'skeleton');
    for (let i = 0; i < 6; i++) out.push(makeUnit(sk, side, base + dir * (i * 10), {}, true));
  }
  const n = Math.max(1, Math.round(BUDGET / def.cost));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < def.count; k++) {
      out.push(makeUnit(def, side, base + dir * ((FRONT ? 70 : 0) + i * 20 + k * 6)));
    }
  }
  out.spent = n * def.cost;
  return out;
}

function makeUnit(def, side, x, over = {}, filler = false) {
  return {
    filler, scd: (def.skill ? def.skill.cd * 0.4 : 0), summon: !!over.summon,
    def, side, x, hp: over.hp || def.hp, maxHp: over.hp || def.hp, atk: over.atk || def.atk,
    cd: Math.random() * 0.3, st: {}, split: !!over.small, revived: false, bones: 0, hitsTaken: 0,
    flying: def.tags.includes('flying'), ranged: def.range >= R.rangedThreshold && !def.groundOnly,
    alive: true,
  };
}

function canHit(a, b) {
  if (b.flying && !a.ranged) return false;
  if (b.def.id === 'worm' && b.moving) return false;
  return true;
}

function damage(src, tgt, raw, type, opts = {}) {
  if (!tgt.alive) return 0;
  if (tgt.bones > 0) {
    if (opts.splash || src.def.element === 'holy') tgt.alive = false;
    return 0;
  }
  let mul = R.damageMatrix[type][tgt.def.armor] ?? 1;
  if (opts.ignoreArmor) mul = 1;
  if (tgt.def.id === 'slime' && type === 'pierce') mul *= 0.6;
  if (tgt.def.id === 'slime' && opts.fire) mul *= 1.5;
  if (src.def.id === 'sylvie' && tgt.flying) mul *= 1.5;
  if (src.def.id === 'freya' && tgt.flying) mul *= 2;
  if (src.def.element === 'holy' && tgt.def.tags.includes('undead')) mul *= 1.5;
  if (tgt.st.vulnerable > 0) mul *= 1.2;
  if (type === 'pierce' && tgt.st.wall > 0) mul *= 0.3;
  if (src.aura) mul *= 1.15;
  if (src.st && src.st.weaken > 0) mul *= 0.7;
  if (type === 'pierce' && tgt.def.id === 'zass' && Math.random() < 0.3) return 0;
  if (tgt.def.id === 'xuan' && !opts.dot) { tgt.hitsTaken++; if (tgt.hitsTaken % 4 === 0) return 0; }
  let d = raw * mul;
  if (tgt.shield > 0) { const a = Math.min(tgt.shield, d); tgt.shield -= a; d -= a; }
  if (tgt.invuln > 0) return 0;
  tgt.hp -= d;
  if (tgt.hp <= 0 && tgt.unyield > 0) { tgt.hp = 1; tgt.unyield = 0; tgt.invuln = 1.5; return d; }
  if (src.def.id === 'bats') src.hp = Math.min(src.maxHp, src.hp + d * 0.6);
  if (tgt.hp <= 0) die(tgt);
  return d;
}

let pending = [];
let corpses = [];
function die(u) {
  if (u.def.id === 'skeleton' && !u.revived) { u.revived = true; u.bones = 3; u.hp = 1; return; }
  u.alive = false;
  if (!u.summon) corpses.push({ x: u.x, t: R.economy.corpseSeconds });
  if (u.def.id === 'slime' && !u.split) {
    pending.push(makeUnit(u.def, u.side, u.x - 8, { hp: 110, atk: 7, small: true }));
    pending.push(makeUnit(u.def, u.side, u.x + 8, { hp: 110, atk: 7, small: true }));
  }
  if (u.def.id === 'mushroom') pending.push({ cloud: true, x: u.x, side: u.side });
}

function addStatus(t, s, stacks = 1) {
  if (t.def.tags.includes('undead') && s === 'poison') return;
  const def = R.statuses[s];
  if (s === 'chill' && t.def.id === 'worm') stacks *= 2;
  if (def.maxStacks) {
    t.st[s] = Math.min(def.maxStacks, (t.st[s] || 0) + stacks);
    t.st[s + 'T'] = def.duration;
    if (s === 'chill' && t.st.chill >= 3 && !(t.st.frozenImm > 0)) { t.st.frozen = 1.5; t.st.frozenImm = 5.5; t.st.chill = 0; }
  } else {
    t.st[s] = def.duration;
  }
}

const NOSKILL = process.argv.includes('--noskill');
function enemiesNear(units, side, x, r) { return units.filter((v) => v.alive && v.side !== side && v.bones <= 0 && Math.abs(v.x - x) <= r); }
function trySkill(u, units, tgt) {
  if (NOSKILL || !u.def.skill || u.scd > 0 || u.filler) return;
  const dir = u.side === 0 ? 1 : -1, id = u.def.id;
  const ahead = (r) => units.filter((v) => v.alive && v.side !== u.side && v.bones <= 0 && (v.x - u.x) * dir >= -10 && Math.abs(v.x - u.x) <= r);
  let used = false;
  if (id === 'sylvie' && ahead(u.def.range).length >= 3) { ahead(1600).forEach((v) => damage(u, v, 70, 'pierce')); used = true; }
  else if (id === 'freya' && tgt) { const t = ahead(u.def.range).filter((v) => canHit(u, v)).sort((a, b) => b.def.cost - a.def.cost)[0]; if (t) { damage(u, t, 80, 'pierce'); t.st.root = 2; t.dashing = 0; used = true; } }
  else if (id === 'brown' && units.filter((v) => v.alive && v.side !== u.side && v.ranged && Math.abs(v.x - u.x) < 300).length >= 2) { units.filter((v) => v.alive && v.side === u.side && (u.x - v.x) * dir >= -5 && Math.abs(u.x - v.x) <= 120).forEach((v) => (v.st.wall = 4)); used = true; }
  else if (id === 'zass') { const t = units.filter((v) => v.alive && v.side !== u.side && v.ranged && Math.abs(v.x - u.x) <= 400).sort((a, b) => a.hp - b.hp)[0]; if (t) { const anti = units.find((v) => v.alive && v.side !== u.side && v.def.id === 'freya' && Math.abs(v.x - t.x) < 160); if (anti) { damage(anti, u, anti.atk * 2, 'pierce'); } else { u.x = t.x + dir * 12; damage(u, t, u.atk * 2, 'slash'); } used = true; } }
  else if (id === 'seren' && tgt && enemiesNear(units, u.side, tgt.x, 120).length >= 4) { storms.push({ x: tgt.x, t: 5, src: u }); used = true; }
  else if (id === 'lein' && ahead(250).length >= 2) {
    const anti = units.find((v) => v.alive && v.side !== u.side && v.def.id === 'freya' && Math.abs(v.x - u.x) < 260);
    if (anti) { damage(anti, u, anti.atk * 2, 'pierce'); } else { ahead(220).forEach((v) => { damage(u, v, 60, 'slash'); if (!v.def.tags.includes('giant')) v.x += dir * 60; }); u.x += dir * 160; u.shield = (u.shield || 0) + 200; }
    used = true; }
  else if (id === 'worm' && ahead(150).length >= 2) { ahead(150).forEach((v) => { damage(u, v, 60, 'magic', { fire: true }); addStatus(v, 'burn', 2); }); used = true; }
  else if (id === 'xuan' && tgt && Math.abs(tgt.x - u.x) <= 40) { const ch = enemiesNear(units, u.side, u.x, 60).find((v) => v.channel > 0) || tgt; damage(u, ch, u.atk, 'slash'); if (!ch.def.tags.includes('giant')) ch.x += dir * 140; if (!(ch.st.stunImm > 0)) { ch.st.stun = ch.def.tags.includes('giant') ? 0.5 : 1; ch.st.stunImm = 3; } ch.channel = 0; used = true; }
  else if (id === 'mordred') { const cs = corpses.filter((c) => Math.abs(c.x - u.x) <= 250); if (cs.length >= 2) { cs.slice(0, 4).forEach((c) => { const sk = U.find((w) => w.id === 'skeleton'); const m = makeUnit(sk, u.side, c.x, { hp: 150, atk: 16, summon: true }); m.revived = true; m.life = 15; pending.push(m); c.t = 0; }); used = true; } }
  else if (id === 'olin' && tgt && enemiesNear(units, u.side, tgt.x, 160).length >= 3) { u.channel = 1; u.channelDo = () => enemiesNear(units, u.side, tgt.x, 160).forEach((v) => { damage(u, v, 80, 'magic'); addStatus(v, 'chill', 3); }); used = true; }
  else if (id === 'yaksha' && ahead(260).length >= 3) { u.channel = 1.5; u.channelDo = () => { let k = 0; ahead(260).forEach((v) => { damage(u, v, 220, 'slash'); if (!v.alive) k++; }); u.scd -= 2 * k; }; used = true; }
  else if (id === 'rex' && units.filter((v) => v.alive && v.side === u.side).length >= 5 && tgt && Math.abs(tgt.x - u.x) < 300) { units.filter((v) => v.alive && v.side === u.side).forEach((v) => { v.shield = (v.shield || 0) + 150; v.unyield = 6; }); used = true; }
  if (used) u.scd = u.def.skill.cd;
}
let storms = [];

function simulate(A, B) {
  corpses = []; storms = []; pending = [];
  let units = [...spawnArmy(A, 0), ...spawnArmy(B, 1)];
  for (let time = 0; time < 120; time += DT) {
    for (const u of units) {
      if (!u.alive) continue;
      if (u.bones > 0) { u.bones -= DT; if (u.bones <= 0) u.hp = u.maxHp * 0.5; continue; }
      // 状态结算
      for (const k of ['vulnerable', 'weaken', 'frozen', 'frozenImm', 'root', 'stun', 'stunImm', 'wall']) if (u.st[k] > 0) u.st[k] -= DT;
      if (u.invuln > 0) u.invuln -= DT;
      if (u.unyield > 0) u.unyield -= DT;
      if (u.scd > 0) u.scd -= DT;
      if (u.life !== undefined) { u.life -= DT; if (u.life <= 0) { u.alive = false; continue; } }
      u.aura = units.some((v) => v.alive && v.side === u.side && v.def.id === 'rex' && v !== u && Math.abs(v.x - u.x) <= 200);
      if (u.def.id === 'lein' && Math.floor(time / 2) !== Math.floor((time - DT) / 2)) units.filter((v) => v.alive && v.side === u.side && Math.abs(v.x - u.x) <= 120).forEach((v) => { v.st.vulnerable = 0; v.st.weaken = 0; });
      for (const k of ['poison', 'burn', 'chill']) {
        if (u.st[k] > 0) {
          u.st[k + 'T'] -= DT;
          if (k !== 'chill') { u.hp -= R.statuses[k].dps * u.st[k] * DT; if (u.hp <= 0 && u.alive) die(u); }
          if (u.st[k + 'T'] <= 0) u.st[k] = 0;
        }
      }
      if (!u.alive || u.st.frozen > 0 || u.st.stun > 0) { u.channel = 0; continue; }
      if (u.channel > 0) { u.channel -= DT; if (u.channel <= 0 && u.channelDo) { u.channelDo(); u.channelDo = null; } continue; }
      const slow = 1 - 0.15 * (u.st.chill || 0);
      const dir = u.side === 0 ? 1 : -1;
      // 找目标：飞行单位优先打远程
      const foes = units.filter((v) => v.alive && v.side !== u.side && canHit(u, v));
      let tgt = null, best = 1e9;
      for (const v of foes) {
        let d = Math.abs(v.x - u.x);
        if (u.flying && v.ranged) d -= 400;
        if (d < best) { best = d; tgt = v; }
      }
      const dist = tgt ? Math.abs(tgt.x - u.x) : 1e9;
      trySkill(u, units, tgt);
      if (u.channel > 0) continue;
      if (!tgt || dist > u.def.range) {
        if (u.def.speed > 0) {
          u.moving = true;
          const sp = u.def.speed * slow * (u.def.id === 'worm' ? 1.5 : 1);
          const blocked = !u.flying && units.some((v) => v.alive && v.side !== u.side && !v.flying && Math.abs(v.x - u.x) < 18 && Math.sign(v.x - u.x) === dir && v.bones <= 0);
          if (!blocked && !(u.st.root > 0)) u.x += dir * sp * DT;
        }
        continue;
      }
      u.moving = false;
      u.cd -= DT * slow;
      if (u.cd > 0) continue;
      u.cd = 1 / u.def.aspd;
      const hitList = u.def.splash ? units.filter((v) => v.alive && v.side !== u.side && Math.abs(v.x - tgt.x) <= u.def.splash && canHit(u, v)) : [tgt];
      for (const v of hitList) {
        if (v.st.chill && u.def.element === 'fire') { const s = v.st.chill; v.st.chill = 0; damage(u, v, 60 + 20 * s, 'magic'); }
        if (v.st.poison >= 3 && u.def.element === 'fire') { const s = v.st.poison; v.st.poison = 0; units.filter((w) => w.alive && w.side === v.side && Math.abs(w.x - v.x) < 80).forEach((w) => damage(u, w, 15 * s, 'magic', { ignoreArmor: true, dot: true })); }
        damage(u, v, u.atk, u.def.dmg, { splash: !!u.def.splash, fire: u.def.element === 'fire' });
        for (const oh of u.def.onHit) if (R.statuses[oh.status]) addStatus(v, oh.status, oh.stacks || 1);
      }
    }
    for (const st of storms) {
      st.t -= DT;
      const tick = Math.floor(st.t) !== Math.floor(st.t + DT);
      if (tick) enemiesNear(units, st.src.side, st.x, 120).forEach((v) => { damage(st.src, v, 20, 'magic', { fire: true, splash: true }); addStatus(v, 'burn', 1); });
    }
    storms = storms.filter((st) => st.t > 0);
    corpses.forEach((c) => (c.t -= DT));
    corpses = corpses.filter((c) => c.t > 0);
    for (const p of pending) {
      if (p.cloud) units.filter((w) => w.alive && w.side !== p.side && Math.abs(w.x - p.x) < 80).forEach((w) => addStatus(w, 'poison', 2));
      else units.push(p);
    }
    pending = [];
    const a = units.some((u) => u.alive && u.side === 0), b = units.some((u) => u.alive && u.side === 1);
    if (!a || !b) break;
  }
  const left = (s) => units.filter((u) => u.alive && u.side === s && !u.filler && !u.summon).reduce((t, u) => t + (Math.max(0, u.hp) / u.def.hp) * (u.def.cost / u.def.count), 0);
  const spentA = Math.max(1, Math.round(BUDGET / A.cost)) * A.cost, spentB = Math.max(1, Math.round(BUDGET / B.cost)) * B.cost;
  const fA = left(0) / spentA, fB = left(1) / spentB;
  const aliveA = units.some((u) => u.alive && u.side === 0), aliveB = units.some((u) => u.alive && u.side === 1);
  // 赢的一方得 +剩余比例，并按花费差修正：花得多赢了打折，花得少赢了加分
  const score = (aliveA && !aliveB) ? fA + 0.0001 : (aliveB && !aliveA) ? -fB - 0.0001 : fA - fB;
  return Math.round(100 * score * Math.sqrt(spentB / spentA)); // 约 -100..100
}

const pool = U.filter((u) => !u.tags.includes('stationary') && u.id !== 'titan');
const RUNS = 12;
const res = {};
for (const a of pool) {
  res[a.id] = {};
  for (const b of pool) {
    if (a === b) { res[a.id][b.id] = 0; continue; }
    let s = 0;
    for (let i = 0; i < RUNS; i++) s += simulate(a, b) - simulate(b, a) * 0; // A 视角
    res[a.id][b.id] = Math.round(s / RUNS);
  }
}
// 输出：每个兵种平均胜负和最克制/最怕的对手
const name = Object.fromEntries(U.map((u) => [u.id, u.name]));
console.log(`预算 ${BUDGET} 金${FRONT ? '（双方各带 6 个骷髅前排）' : ''}${NOSKILL ? '（不放技能）' : ''}，${RUNS} 次取平均。分数 -100~100，正数 = 赢，越大赢得越轻松。\n`);
const rows = [];
for (const a of pool) {
  const vals = pool.filter((b) => b !== a).map((b) => [b.id, (res[a.id][b.id] - res[b.id][a.id]) / 2]);
  const avg = vals.reduce((t, v) => t + v[1], 0) / vals.length;
  vals.sort((x, y) => y[1] - x[1]);
  const wins = vals.filter((v) => v[1] > 0).length;
  rows.push({ a, avg, wins, best: vals.slice(0, 3), worst: vals.slice(-3).reverse() });
}
rows.sort((x, y) => y.avg - x.avg);
for (const r of rows) {
  const f = (l) => l.map(([id, v]) => `${name[id]}${v > 0 ? '+' : ''}${Math.round(v)}`).join(' ');
  console.log(`${r.a.tier.padEnd(5)} ${r.a.name.padEnd(6, '　')} 胜 ${String(r.wins).padStart(2)}/${pool.length - 1}  平均 ${String(Math.round(r.avg)).padStart(5)} | 克: ${f(r.best)} | 怕: ${f(r.worst)}`);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(res));
