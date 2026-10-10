// 糯糯战记 · 无头测试（node tools/headless_test.js）
// 1. 机制断言：伤害倍率、冻结、融化、骨堆、化劲、索敌限制等关键规则
// 2. AI 对 AI 50 局（不渲染）：平均时长、各兵种出场次数、胜率，检查 NaN、死循环（超时）和无胜负
// 只读游戏源码，不改任何文件。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'src/rules.js',
  'src/units.js',
  'src/hd-sheets.js',
  'src/game/combat.js',
  'src/game/engine.js',
  'src/game/ai.js',
];
const DT = 1 / 60;
const MAX_SECONDS = 900;   // 超过 15 分钟仍未分出胜负，记为超时（死循环嫌疑）

function load() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.window;
}

const W = load();
const { Engine, AI, Combat: C, RULES: R } = W;
let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` (${detail})` : ''}`);
  }
}
const def = (id) => C.BY_ID[id];

// ---------- 1. 机制断言 ----------
console.log('机制断言');
{
  const eng = new Engine({ seed: 1 });
  const brown = eng.addUnit(1, def('brown'), { x: 900 });   // 重甲
  const rat = eng.addUnit(0, def('rat'), { x: 880 });
  brown.hp = 1000;
  const got = C.damage(eng, rat, brown, 100, 'pierce', { attack: true });
  check('穿刺打重甲 ×0.6', Math.abs(got - 60) < 1e-6, got);
}
{
  const eng = new Engine({ seed: 2 });
  const skel = eng.addUnit(1, def('skeleton'), { x: 900 });
  skel.hp = 1000;
  const bolt = eng.addUnit(0, def('seren'), { x: 800 });
  const got = C.damage(eng, bolt, skel, 100, 'magic', { attack: true, element: 'fire' });
  check('魔法打轻甲 ×1.0 且无反应', Math.abs(got - 100) < 1e-6 && !C.has(skel, 'chill'), got);
}
{
  const eng = new Engine({ seed: 3 });
  const t = eng.addUnit(1, def('rat'), { x: 900 });
  C.applyStatus(eng, t, 'chill', { stacks: 2 });
  C.applyStatus(eng, t, 'chill', { stacks: 2 });
  check('寒霜叠满 3 层变冻结', C.has(t, 'frozen') && !C.has(t, 'chill'));
  C.tickStatuses(eng, t, 1.6);
  check('冻结 1.5 秒后解除', !C.has(t, 'frozen'));
  C.applyStatus(eng, t, 'chill', { stacks: 3 });
  check('解冻后 4 秒内免疫再冻结（只剩 3 层寒霜）', !C.has(t, 'frozen') && C.stacksOf(t, 'chill') === 3);
}
{
  const eng = new Engine({ seed: 4 });
  const t = eng.addUnit(1, def('bats'), { x: 900 });
  t.hp = 1000;
  C.applyStatus(eng, t, 'chill', { stacks: 3 });   // 冻结
  const before = t.hp;
  const fire = eng.addUnit(0, def('worm'), { x: 800 });
  C.damage(eng, fire, t, 20, 'magic', { attack: true, element: 'fire' });
  const lost = before - t.hp;
  check('火打冻结目标触发融化（额外 60 + 20×3）', lost >= 120 + 20 - 1e-6, lost.toFixed(1));
}
{
  const eng = new Engine({ seed: 5 });
  const t = eng.addUnit(1, def('rat'), { x: 900 });
  t.hp = 1000;
  for (let i = 0; i < 3; i++) C.applyStatus(eng, t, 'poison', { stacks: 1 });
  const before = t.hp;
  const fire = eng.addUnit(0, def('seren'), { x: 800 });
  C.damage(eng, fire, t, 10, 'magic', { attack: true, element: 'fire' });
  check('火打 3 层中毒触发爆燃（移除中毒）', !C.has(t, 'poison') && before - t.hp > 10);
}
{
  const eng = new Engine({ seed: 6 });
  const sk = eng.addUnit(1, def('skeleton'), { x: 900 });
  sk.hp = 1;
  C.damage(eng, eng.addUnit(0, def('rat'), { x: 880 }), sk, 50, 'slash', { attack: true });
  eng.settleDeaths();
  check('骷髅第一次死亡进入骨堆', sk.bones && !sk.dead);
  for (let i = 0; i < 200; i++) eng.step(DT);
  check('骨堆 3 秒后以 50% 生命站起', !sk.bones && !sk.dead && Math.abs(sk.hp - Math.round(sk.maxHp * 0.5)) < 1e-6, sk.hp);
  sk.hp = 0;
  eng.markDead(sk);
  eng.settleDeaths();
  check('骷髅第二次死亡不再重组', sk.dead);
}
{
  const eng = new Engine({ seed: 7 });
  const bat = eng.addUnit(1, def('bats'), { x: 900 });
  const rat = eng.addUnit(0, def('rat'), { x: 880 });
  check('近战打不到飞行单位（索敌）', eng.findTarget(rat) !== bat);
  const sylvie = eng.addUnit(0, def('sylvie'), { x: 900 - 200 });
  check('远程（射程 250）可以打飞行单位', eng.validInRange(sylvie, bat));
}
{
  const eng = new Engine({ seed: 8 });
  const titan = eng.addUnit(0, def('titan'), { x: 900 });
  eng.addUnit(1, def('rat'), { x: 1000 });
  const tgt = eng.findTarget(titan);
  check('碎城巨人只找水晶', tgt === null || tgt.isCrystal);
}
{
  const eng = new Engine({ seed: 9 });
  const xuan = eng.addUnit(0, def('xuan'), { x: 900 });
  const foe = eng.addUnit(1, def('rat'), { x: 880 });
  xuan.hp = 100000;
  let blocked = 0;
  for (let i = 0; i < 4; i++) {
    const got = C.damage(eng, foe, xuan, 10, 'slash', { attack: true });
    if (got === 0) blocked++;
  }
  check('玄每第 4 次攻击完全格挡', blocked === 1);
}
{
  const eng = new Engine({ seed: 10 });
  const rex = eng.addUnit(1, def('rex'), { x: 1000 });
  const yak = eng.addUnit(1, def('yaksha'), { x: 1050 });
  check('雷克斯光环免疫衰弱', (C.applyStatus(eng, yak, 'weaken'), !C.has(yak, 'weaken')) && rex.hp > 0);
}
{
  const eng = new Engine({ seed: 11 });
  const lein = eng.addUnit(0, def('lein'), { x: 900 });
  check('圣骑士对不死 ×1.5（圣裁）', (() => {
    const sk = eng.addUnit(1, def('skeleton'), { x: 950 });
    sk.hp = 1000;
    const before = sk.hp;
    const got = C.damage(eng, lein, sk, 100, 'slash', { attack: true, element: 'holy' });
    return Math.abs(got - 100 * 1.5 * R.damageMatrix.slash.light) < 1e-6 && before - sk.hp === got;
  })());
}
{
  const eng = new Engine({ seed: 12 });
  const sp = eng.spawn(0, 'rat');
  const rats = eng.units.filter((x) => x.uid === 'rat').length;
  check('出兵扣金币、一次 4 只、人口只算一次', sp && eng.sides[0].gold < R.economy.startGold && rats === 4 && eng.sides[0].supplyUsed === 1, `rats=${rats} supply=${eng.sides[0].supplyUsed}`);
}
{
  const eng = new Engine({ seed: 13 });
  eng.sides[0].gold = 10000;
  const ok1 = eng.spawn(0, 'titan');
  const again = eng.canSpawn(0, 'titan');
  check('出兵冷却生效', ok1 && again === 'cooldown', again);
}

{
  // 武僧眩晕打断夜叉的蓄力；被打断的夜叉进入半冷却
  const eng = new Engine({ seed: 14 });
  const y = eng.addUnit(1, def('yaksha'), { x: 700 });
  y.skillCd = 0;
  [600, 560, 520].forEach((x) => eng.addUnit(0, def('rat'), { x }));
  eng.step(DT);
  const casting = !!y.cast;
  C.applyStatus(eng, y, 'stun', { dur: 1 });
  check('武僧的眩晕打断夜叉蓄力，技能进入半冷却', casting && !y.cast && Math.abs(y.skillCd - def('yaksha').skill.cd / 2) < 1e-6, `cast=${casting} cd=${y.skillCd}`);
}
{
  // 芙蕾雅打中冲锋中的莱恩，冲锋被打断
  const eng = new Engine({ seed: 15 });
  const lein = eng.addUnit(0, def('lein'), { x: 300 });
  const freya = eng.addUnit(1, def('freya'), { x: 600 });
  lein.charge = { left: 220, hit: new Set() };
  C.damage(eng, freya, lein, 10, 'pierce', { attack: true });
  check('芙蕾雅的反冲锋打断莱恩的冲锋', lein.charge === null);
}

// ---------- 1b. 12 个主动技能：定点场景，确认能放出来、效果对得上 ----------
console.log('\n主动技能（定点场景）');
const SCENES = [
  { uid: 'sylvie', name: '希尔薇 穿云箭：前方 3 个敌人，整条线受 70 穿刺', setup(e) {
    const s = e.addUnit(0, def('sylvie'), { x: 300 }); s.skillCd = 0;
    [700, 750, 800].forEach((x) => e.addUnit(1, def('rat'), { x }));
    return s;
  } },
  { uid: 'freya', name: '芙蕾雅 钉刺投矛：射程内敌人，定身 2 秒', setup(e) {
    const s = e.addUnit(0, def('freya'), { x: 300 }); s.skillCd = 0;
    const t = e.addUnit(1, def('brown'), { x: 440 });   // 血厚，挨了 80 穿刺也不会死（死了就不会被定身）
    return { s, t };
  }, secs: 1, verify: (e, c) => C.has(c.t, 'root') },
  { uid: 'brown', name: '布朗 盾墙：敌方 2 个远程正在攻击', setup(e) {
    const s = e.addUnit(0, def('brown'), { x: 300 }); s.skillCd = 0;
    for (const x of [520, 540]) {
      const r = e.addUnit(1, def('mushroom'), { x });
      r.swing = { t: 0, period: 1, releaseT: 0.9, target: s, hit: false };
    }
    return s;
  }, verify: (e, s) => s.shieldWallT > 0 },
  { uid: 'zass', name: '札斯 影袭：400 内敌方远程，瞬身到身后，下一刀 ×2', setup(e) {
    const s = e.addUnit(0, def('zass'), { x: 300 }); s.skillCd = 0;
    e.addUnit(1, def('seren'), { x: 600 });
    return s;
  }, verify: (e, s) => s.nextHitMul === 2 && s.x > 600 },
  { uid: 'seren', name: '赛伦 烈焰风暴：敌群 4 个以上，落火雨', setup(e) {
    const s = e.addUnit(0, def('seren'), { x: 300 }); s.skillCd = 0;
    [480, 490, 500, 510].forEach((x) => e.addUnit(1, def('rat'), { x }));
    return s;
  }, verify: (e) => e.zones.length === 1 },
  { uid: 'lein', name: '莱恩 圣光冲锋：前方 2 个敌人，冲锋后获得 200 圣盾', setup(e) {
    const s = e.addUnit(0, def('lein'), { x: 300 }); s.skillCd = 0;
    [420, 460].forEach((x) => e.addUnit(1, def('rat'), { x }));
    return s;
  }, secs: 1, verify: (e, s) => s.x > 480 && C.has(s, 'holyShield') },
  { uid: 'worm', name: '熔岩蠕虫 熔岩喷吐：前方 2 个敌人，锥形火伤', setup(e) {
    const s = e.addUnit(0, def('worm'), { x: 300 }); s.skillCd = 0;
    [380, 420].forEach((x) => e.addUnit(1, def('rat'), { x }));
    return s;
  }, verify: (e) => e.units.filter((u) => u.side === 1 && C.has(u, 'burn')).length === 2 },
  { uid: 'xuan', name: '玄 震山掌：击退 140 并眩晕 1 秒', setup(e) {
    const s = e.addUnit(0, def('xuan'), { x: 300 }); s.skillCd = 0;
    const t = e.addUnit(1, def('rat'), { x: 318 });
    return { s, t };
  }, verify: (e, c) => C.has(c.t, 'stun') && c.t.x > 318 },
  { uid: 'mordred', name: '摩尔德 亡者复苏：2 具以上尸体，拉起骷髅', setup(e) {
    const s = e.addUnit(0, def('mordred'), { x: 300 }); s.skillCd = 0;
    for (const x of [340, 360]) e.bodies.push({ corpse: true, side: 1, uid: 'rat', sheet: 'rat', x, uy: 0, age: 0, deathDur: 0.5, life: 6 });
    return s;
  }, verify: (e) => e.units.filter((u) => u.uid === 'skeleton' && u.side === 0 && u.summon).length === 2 && e.bodies.filter((b) => b.corpse).length === 0 },
  { uid: 'olin', name: '奥林 冰封领域：蓄力 1 秒后 3 人以上冻结', setup(e) {
    const s = e.addUnit(0, def('olin'), { x: 300 }); s.skillCd = 0;
    const foes = [420, 430, 440].map((x) => e.addUnit(1, def('skeleton'), { x }));   // 血厚，80 魔法伤害打不死
    return { s, foes };
  }, secs: 1.3, verify: (e, c) => c.foes.every((f) => C.has(f, 'frozen')) },
  { uid: 'yaksha', name: '夜叉 居合·断：蓄力 1.5 秒，前方 3 人以上，220 斩击', setup(e) {
    const s = e.addUnit(0, def('yaksha'), { x: 300 }); s.skillCd = 0;
    const foes = [350, 400, 450].map((x) => e.addUnit(1, def('rat'), { x }));
    return { s, foes };
  }, secs: 1.8, verify: (e, c) => c.foes.every((f) => f.hp < f.maxHp) },
  { uid: 'rex', name: '雷克斯 王之号令：5 个以上友军且交战，全场圣盾 + 不屈', setup(e) {
    const s = e.addUnit(0, def('rex'), { x: 300 }); s.skillCd = 0;
    const friends = [200, 220, 240, 260].map((x) => e.addUnit(0, def('rat'), { x }));
    friends[0].swing = { t: 0, period: 1, releaseT: 0.5, target: s, hit: false };
    return { s, friends };
  }, verify: (e, c) => [c.s, ...c.friends].every((f) => C.has(f, 'holyShield') && C.has(f, 'unyielding')) },
];
for (const sc of SCENES) {
  const eng = new Engine({ seed: 21 });
  const c = sc.setup(eng);
  let fired = false;
  const steps = Math.round((sc.secs || 0.1) / DT);
  for (let i = 0; i < steps; i++) {
    eng.step(DT);
    for (const ev of eng.drainEvents()) if (ev.t === 'skill' && ev.uid === sc.uid) fired = true;
  }
  const ok = fired && (sc.verify ? sc.verify(eng, c) : true);
  check(sc.name, ok, fired ? undefined : '没有触发');
}

// ---------- 2. AI 对 AI 50 局 ----------
console.log('\nAI 对 AI：50 局（不渲染）');
const MATCHUPS = [
  ['normal', 'normal'], ['hard', 'normal'], ['normal', 'hard'], ['easy', 'normal'],
  ['normal', 'easy'], ['hard', 'easy'], ['easy', 'hard'], ['hard', 'hard'], ['easy', 'easy'], ['normal', 'normal'],
];
const GAMES = 50;
const results = [];
const spawnTotals = [{}, {}];
const skillTotals = {};
let nanCount = 0;
let timeouts = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const [l0, l1] = MATCHUPS[g % MATCHUPS.length];
  const eng = new Engine({ seed: 1000 + g });
  AI.attach(eng, 0, l0);
  AI.attach(eng, 1, l1);
  const maxSteps = Math.round(MAX_SECONDS / DT);
  let steps = 0;
  let bad = false;
  while (!eng.ended && steps < maxSteps) {
    eng.step(DT);
    steps++;
    for (const ev of eng.drainEvents()) {
      if (ev.t === 'skill') skillTotals[ev.uid] = (skillTotals[ev.uid] || 0) + 1;
    }
    if (steps % 60 === 0) {
      for (const u of eng.units) {
        if (!Number.isFinite(u.x) || !Number.isFinite(u.hp)) { bad = true; break; }
      }
      if (!Number.isFinite(eng.crystals[0].hp) || !Number.isFinite(eng.crystals[1].hp)) bad = true;
      if (bad) break;
    }
  }
  if (bad) nanCount++;
  if (!eng.ended) timeouts++;
  results.push({ l0, l1, winner: eng.winner, secs: eng.time, ended: eng.ended });
  for (let s = 0; s < 2; s++) {
    for (const [uid, n] of Object.entries(eng.sides[s].spawned)) {
      spawnTotals[s][uid] = (spawnTotals[s][uid] || 0) + n;
    }
  }
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const pairs = new Map();
for (const r of results) {
  const k = `${r.l0} vs ${r.l1}`;
  const p = pairs.get(k) || { n: 0, w0: 0, w1: 0, secs: 0 };
  p.n++;
  if (r.winner === 0) p.w0++;
  if (r.winner === 1) p.w1++;
  p.secs += r.secs;
  pairs.set(k, p);
}
console.log('  对阵                 局数  玩家胜  电脑胜  平均时长');
for (const [k, p] of pairs) {
  console.log(`  ${k.padEnd(20)} ${String(p.n).padStart(4)}  ${String(p.w0).padStart(6)}  ${String(p.w1).padStart(6)}  ${(p.secs / p.n).toFixed(0).padStart(6)} 秒`);
}
const total = results.length;
const avg = results.reduce((a, r) => a + r.secs, 0) / total;
const decided = results.filter((r) => r.ended && r.winner !== null).length;
console.log(`  合计 ${total} 局，平均时长 ${avg.toFixed(0)} 秒，分出胜负 ${decided} 局，超时 ${timeouts} 局，出现 NaN ${nanCount} 局，用时 ${elapsed} 秒`);
console.log('\n各兵种出场次数（50 局合计，玩家 / 电脑）');
const rows = W.UNITS.map((d) => `${d.name} ${spawnTotals[0][d.id] || 0}/${spawnTotals[1][d.id] || 0}`);
for (let i = 0; i < rows.length; i += 4) console.log('  ' + rows.slice(i, i + 4).map((x) => x.padEnd(16)).join(' '));
console.log('\n主动技能触发次数（50 局合计）');
const skillRows = W.UNITS.filter((d) => d.skill).map((d) => `${d.name}·${d.skill.name} ${skillTotals[d.id] || 0}`);
for (let i = 0; i < skillRows.length; i += 3) console.log('  ' + skillRows.slice(i, i + 3).map((x) => x.padEnd(22)).join(' '));
const silent = W.UNITS.filter((d) => d.skill && !skillTotals[d.id]).map((d) => d.name);
console.log(`  从未触发的技能：${silent.length ? silent.join('、') : '无'}`);

const bad = timeouts + nanCount + (total - decided);
console.log('\n机制断言失败 ' + failures + ' 项');
if (failures > 0 || bad > 0) {
  console.log('结果：未通过');
  process.exitCode = 1;
} else {
  console.log('结果：全部通过');
}
