// 糯糯战记 · 无头测试（node tools/headless_test.js）
// 1. 机制断言：伤害倍率、状态、元素反应、骨堆、索敌、分离推挤、越界、飞行与巨像穿行、水晶易伤、撒旦、作弊默认关闭
// 2. 技能定点场景：12 个主动技能，外加撒旦三个手动技能
// 3. 规模压力：200 对 200、1000 个单位同屏，每步平均耗时（只跑逻辑，不渲染）
// 4. AI 对 AI：默认 20 局（环境变量 GAMES 可改），不渲染；统计时长、在场峰值、胜负、超时、NaN、灰鼠群占比、雷克斯出场
// 只读游戏源码，不改任何文件。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'src/rules.js',
  'src/units.js',
  'src/special.js',
  'src/hd-sheets.js',
  'src/game/combat.js',
  'src/game/engine.js',
  'src/game/ai.js',
];
const MAX_SECONDS = 900;   // 超过 15 分钟仍未分出胜负，记为超时（死循环嫌疑）
const GAMES = Math.max(1, parseInt(process.env.GAMES, 10) || 20);

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
const DT = Engine.DT;                  // 固定步长（1/30 秒）
const MY = R.map.h / 2;                // 战场中线
const SATAN = W.SPECIAL_UNITS.find((d) => d.id === 'satan');
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
const at = (x, y = MY) => ({ x, y });
const step = (eng, n) => { for (let i = 0; i < n; i++) eng.step(DT); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// 手动释放撒旦技能：接口名以契约为准（manualCast），旧名兜底
const manualCast = (eng, side, idx) => {
  if (C.manualCast) return C.manualCast(eng, side, idx);
  if (C.castManual) return C.castManual(eng, side, idx);
  return eng.manualCast(side, idx);
};

// ---------- 1. 机制断言 ----------
console.log('机制断言');
{
  const eng = new Engine({ seed: 1 });
  const brown = eng.addUnit(1, def('brown'), at(900));   // 重甲
  const rat = eng.addUnit(0, def('rat'), at(880));
  brown.hp = 1000;
  const got = C.damage(eng, rat, brown, 100, 'pierce', { attack: true });
  check('穿刺打重甲 ×0.6', Math.abs(got - 60) < 1e-6, got);
}
{
  const eng = new Engine({ seed: 2 });
  const skel = eng.addUnit(1, def('skeleton'), at(900));
  skel.hp = 1000;
  const bolt = eng.addUnit(0, def('seren'), at(800));
  const got = C.damage(eng, bolt, skel, 100, 'magic', { attack: true, element: 'fire' });
  check('魔法打轻甲 ×1.0 且无反应', Math.abs(got - 100) < 1e-6 && !C.has(skel, 'chill'), got);
}
{
  const eng = new Engine({ seed: 3 });
  const t = eng.addUnit(1, def('rat'), at(900));
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
  const t = eng.addUnit(1, def('bats'), at(900));
  t.hp = 1000;
  C.applyStatus(eng, t, 'chill', { stacks: 3 });   // 冻结
  const before = t.hp;
  const fire = eng.addUnit(0, def('worm'), at(800));
  C.damage(eng, fire, t, 20, 'magic', { attack: true, element: 'fire' });
  const lost = before - t.hp;
  check('火打冻结目标触发融化（额外 60 + 20×3）', lost >= 120 + 20 - 1e-6, lost.toFixed(1));
}
{
  const eng = new Engine({ seed: 5 });
  const t = eng.addUnit(1, def('rat'), at(900));
  t.hp = 1000;
  for (let i = 0; i < 3; i++) C.applyStatus(eng, t, 'poison', { stacks: 1 });
  const before = t.hp;
  const fire = eng.addUnit(0, def('seren'), at(800));
  C.damage(eng, fire, t, 10, 'magic', { attack: true, element: 'fire' });
  check('火打 3 层中毒触发爆燃（移除中毒）', !C.has(t, 'poison') && before - t.hp > 10);
}
{
  const eng = new Engine({ seed: 6 });
  const sk = eng.addUnit(1, def('skeleton'), at(900));
  sk.hp = 1;
  C.damage(eng, eng.addUnit(0, def('rat'), at(880)), sk, 50, 'slash', { attack: true });
  eng.settleDeaths();
  check('骷髅第一次死亡进入骨堆', sk.bones && !sk.dead);
  step(eng, 110);   // 约 3.7 秒
  check('骨堆 3 秒后以 50% 生命站起', !sk.bones && !sk.dead && Math.abs(sk.hp - Math.round(sk.maxHp * 0.5)) < 1e-6, sk.hp);
  sk.hp = 0;
  eng.markDead(sk);
  eng.settleDeaths();
  check('骷髅第二次死亡不再重组', sk.dead);
}
{
  const eng = new Engine({ seed: 7 });
  const bat = eng.addUnit(1, def('bats'), at(900));
  const rat = eng.addUnit(0, def('rat'), at(880));
  check('近战打不到飞行单位（索敌）', eng.findTarget(rat) !== bat);
  const sylvie = eng.addUnit(0, def('sylvie'), at(900 - 200));
  check('远程（射程 250）可以打飞行单位', eng.findTarget(sylvie) === bat);
}
{
  const eng = new Engine({ seed: 8 });
  const titan = eng.addUnit(0, def('titan'), at(900));
  eng.addUnit(1, def('rat'), at(930));
  const tgt = eng.findTarget(titan);
  check('碎城巨人只找水晶', tgt === null || tgt.isCrystal);
}
{
  const eng = new Engine({ seed: 9 });
  const xuan = eng.addUnit(0, def('xuan'), at(900));
  const foe = eng.addUnit(1, def('rat'), at(880));
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
  const rex = eng.addUnit(1, def('rex'), at(1000));
  const yak = eng.addUnit(1, def('yaksha'), at(1050));
  C.applyStatus(eng, yak, 'weaken');
  check('雷克斯光环免疫衰弱', !C.has(yak, 'weaken') && rex.hp > 0);
}
{
  const eng = new Engine({ seed: 11 });
  const lein = eng.addUnit(0, def('lein'), at(900));
  const sk = eng.addUnit(1, def('skeleton'), at(950));
  sk.hp = 1000;
  const before = sk.hp;
  const got = C.damage(eng, lein, sk, 100, 'slash', { attack: true, element: 'holy' });
  check('圣骑士对不死 ×1.5（圣裁）',
    Math.abs(got - 100 * 1.5 * R.damageMatrix.slash.light) < 1e-6 && before - sk.hp === got);
}
{
  const eng = new Engine({ seed: 12 });
  const sp = eng.spawn(0, 'rat');
  const rats = eng.count(0, 'rat');
  check('出兵扣金币、一次 4 只、人口只算一次',
    sp && eng.sides[0].gold < R.economy.startGold && rats === 4 && eng.sides[0].supplyUsed === 1,
    `rats=${rats} supply=${eng.sides[0].supplyUsed}`);
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
  const y = eng.addUnit(1, def('yaksha'), at(700));
  y.skillCd = 0;
  [600, 560, 520].forEach((x) => eng.addUnit(0, def('rat'), at(x)));
  eng.step(DT);
  const casting = !!y.cast;
  C.applyStatus(eng, y, 'stun', { dur: 1 });
  check('武僧的眩晕打断夜叉蓄力，技能进入半冷却',
    casting && !y.cast && Math.abs(y.skillCd - def('yaksha').skill.cd / 2) < 1e-6, `cast=${casting} cd=${y.skillCd}`);
}
{
  // 芙蕾雅打中冲锋中的莱恩，冲锋被打断
  const eng = new Engine({ seed: 15 });
  const lein = eng.addUnit(0, def('lein'), at(300));
  const freya = eng.addUnit(1, def('freya'), at(600));
  lein.charge = { left: 220, hit: new Set() };
  C.damage(eng, freya, lein, 10, 'pierce', { attack: true });
  check('芙蕾雅的反冲锋打断莱恩的冲锋', lein.charge === null);
}

// 2D 新增：推挤、越界、穿行、水晶、撒旦、作弊
{
  // 分离推挤：两个地面单位不会重叠（每一步之后都检查）
  const eng = new Engine({ seed: 40 });
  const a = eng.addUnit(0, def('slime'), at(3000));
  const b = eng.addUnit(0, def('slime'), at(3003, MY + 2));
  let worst = Infinity;
  for (let i = 0; i < 30; i++) {
    eng.step(DT);
    worst = Math.min(worst, dist(a, b) - (a.radius + b.radius));
  }
  check('分离推挤：两个地面单位不会重叠', worst > -0.5, worst.toFixed(2));
  check('空间网格查询包含自己', eng.unitsNear(a.x, a.y, 1).includes(a));
}
{
  // 巨像穿过地面单位：巨像不推挤、也不因为敌人停下
  const eng = new Engine({ seed: 41 });
  const titan = eng.addUnit(0, def('titan'), at(1000));
  const rat = eng.addUnit(1, def('rat'), at(1020));
  step(eng, 90);
  check('巨像穿过地面单位（不推挤、不停下）', titan.x > rat.x + 5,
    `titan ${titan.x.toFixed(0)} / rat ${rat.x.toFixed(0)}`);
}
{
  // 飞行单位越过地面单位：飞行不参与推挤，地面近战打不到它也不会停下来等它
  const eng = new Engine({ seed: 42 });
  const bat = eng.addUnit(0, def('bats'), at(1000));
  const rat = eng.addUnit(1, def('rat'), at(1010));
  step(eng, 60);
  check('飞行单位越过地面单位', bat.x > rat.x + 5, `bat ${bat.x.toFixed(0)} / rat ${rat.x.toFixed(0)}`);
}
{
  // 单位不会离开地图：把两侧的单位往边界外击退，之后检查都在 [r, 边长 - r] 之内
  const eng = new Engine({ seed: 43 });
  const ids = W.UNITS.map((d) => d.id);
  for (let i = 0; i < 30; i++) {
    const side = i % 2;
    const u = eng.addUnit(side, def(ids[i % ids.length]), {
      x: side ? 6 : R.map.w - 6,
      y: i < 15 ? 6 : R.map.h - 6,
    });
    C.knock(eng, u, side ? -1 : 1, 0, 900);
  }
  step(eng, 60);
  const inside = eng.units.every((u) =>
    u.x >= u.radius - 1e-6 && u.x <= eng.W - u.radius + 1e-6 &&
    u.y >= u.radius - 1e-6 && u.y <= eng.H - u.radius + 1e-6);
  check('单位不会离开地图（x、y 都在边界之内）', inside);
}
{
  // 水晶也吃易伤 ×1.2（护甲仍按水晶的重甲算）
  const eng = new Engine({ seed: 44 });
  const crys = eng.crystals[1];
  const src = eng.addUnit(0, def('rat'), at(crys.x - 200));
  const hp0 = crys.hp;
  const plain = C.damage(eng, src, crys, 100, 'slash', { attack: true });
  crys.hp = hp0;
  C.applyStatus(eng, crys, 'vulnerable');
  const hit = C.damage(eng, src, crys, 100, 'slash', { attack: true });
  check('水晶吃易伤 ×1.2', Math.abs(hit / plain - R.statuses.vulnerable.damageTakenMul) < 1e-6,
    (hit / plain).toFixed(3));
}
{
  // 水晶吃攻击方 onHit 的易伤：走真实攻击路径（亡灵君主挨着敌方水晶打），不手动写 st
  const eng = new Engine({ seed: 45 });
  const crys = eng.crystals[1];
  eng.addUnit(0, def('mordred'), at(crys.x - crys.radius - 40));
  step(eng, 90);
  check('亡灵君主挨着敌方水晶打，水晶挂上易伤（真实攻击路径）', C.has(crys, 'vulnerable'), Object.keys(crys.st).join(','));
}
{
  // 无敌期间持续伤害（灼烧）不扣血
  const eng = new Engine({ seed: 46 });
  const u = eng.addUnit(1, def('rat'), at(1000));
  u.invuln = 3;
  C.applyStatus(eng, u, 'burn', { stacks: 3 });
  const hp0 = u.hp;
  step(eng, 30);
  check('无敌期间灼烧不扣血', u.hp === hp0, `${hp0} -> ${u.hp}`);
}
{
  // 击退不越过水晶：敌人在我方水晶右侧，被击退 180 也只停在水晶边上
  const eng = new Engine({ seed: 47 });
  const c = eng.crystals[0];
  const e = eng.addUnit(1, def('rat'), at(c.x + c.radius + 100));
  C.knock(eng, e, -1, 0, 180);
  step(eng, 2);
  check('击退不越过水晶（停在水晶右侧）', e.x >= c.x + c.radius + e.radius - 1e-6, e.x.toFixed(1));
}
{
  // 推挤后地面单位不穿入水晶圆（两个 rex 一起被推，起点在 100–140 px）
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const eng = new Engine({ seed: 9000 + i });
    const c = eng.crystals[0];
    const ang = (i * 0.37) % (Math.PI * 2);
    const d1 = 100 + (i % 7) * 10;
    const a = eng.addUnit(0, def('rex'), at(c.x + Math.cos(ang) * d1, c.y + Math.sin(ang) * d1));
    const b = eng.addUnit(0, def('rex'), at(c.x + Math.cos(ang) * (d1 + 5), c.y + Math.sin(ang) * (d1 + 5)));
    eng.buildGrid();
    eng.separate();
    for (const u of [a, b]) if (dist(u, c) < c.radius + u.radius - 1e-6) bad++;
  }
  check('推挤后地面单位不穿入水晶圆（400 组）', bad === 0, `${bad} 个`);
}
{
  // 深渊威压：眩晕 4 秒，结束后再免疫 2 秒（不会刚醒就被再次眩晕）
  const eng = new Engine({ seed: 51 });
  eng.addUnit(0, SATAN, at(3000));
  const r = eng.addUnit(1, def('rat'), at(3300));
  manualCast(eng, 0, 1);
  check('深渊威压：眩晕 4 秒，之后 2 秒免疫', r.st.stun && r.st.stun.t === 4 &&
    r.imm.stun === 4 + R.statuses.stun.immuneAfter, `stun ${r.st.stun && r.st.stun.t} imm ${r.imm.stun}`);
}
{
  // 双方水晶同一步归零判平局
  const eng = new Engine({ seed: 48 });
  eng.crystals[0].hp = 0;
  eng.crystals[1].hp = 0;
  step(eng, 1);
  check('双方水晶同一步归零判平局', eng.ended && eng.winner === 'draw', eng.winner);
}
{
  // 作弊的伤害倍率对水晶炮塔也生效：电脑伤害 ×0 时，炮塔打不痛玩家单位
  const eng = new Engine({ seed: 49 });
  eng.cheats.dmgMul[1] = 0;
  const c = eng.crystals[1];
  const r = eng.addUnit(0, def('rat'), at(c.x - 200));
  const hp0 = r.hp;
  step(eng, 45);
  check('作弊：电脑伤害 ×0 时炮塔不造成伤害', r.hp === hp0, `${hp0} -> ${r.hp}`);
}
{
  // 作弊的单位无敌挡住灵魂收割的处决
  const eng = new Engine({ seed: 50 });
  eng.cheats.godMode[1] = true;
  eng.addUnit(0, SATAN, at(3000));
  const r = eng.addUnit(1, def('rat'), at(3400));
  r.hp = 1;
  manualCast(eng, 0, 2);
  step(eng, 3);
  check('作弊：单位无敌时灵魂收割不处决', !r.dead && !r.pendingDeath && r.hp === 1, `dead ${r.dead} hp ${r.hp}`);
}
{
  // 撒旦：第一次死亡原地复活，回满血，无敌
  const eng = new Engine({ seed: 45 });
  const s = eng.addUnit(0, SATAN, at(300));
  const foe = eng.addUnit(1, def('sylvie'), at(300 + 200));
  C.damage(eng, foe, s, 1e6, 'magic', { attack: true });
  eng.settleDeaths();
  check('撒旦死亡后原地复活（回满血、无敌、标记已用）',
    !s.dead && s.reviveUsed && s.hp === s.maxHp && s.invuln > 0, `hp=${s.hp} dead=${s.dead}`);
}
{
  // 撒旦免疫眩晕、定身
  const eng = new Engine({ seed: 46 });
  const s = eng.addUnit(0, SATAN, at(300));
  C.applyStatus(eng, s, 'stun', { dur: 1 });
  C.applyStatus(eng, s, 'root', { dur: 1 });
  check('撒旦免疫眩晕与定身', !C.has(s, 'stun') && !C.has(s, 'root'));
}
{
  // 撒旦炼狱光环：200 范围内的敌人受火伤或叠灼烧
  const eng = new Engine({ seed: 47 });
  eng.addUnit(0, SATAN, at(300));
  const foe = eng.addUnit(1, def('brown'), at(360));
  step(eng, 16);   // 约半秒
  check('撒旦炼狱光环：200 范围内的敌人受火伤并叠灼烧', C.has(foe, 'burn') || foe.hp < foe.maxHp);
}
{
  // 撒旦不在电脑兵种池里，电脑召唤不了；玩家可以召唤
  check('撒旦不在电脑兵种池（UNITS 里没有）', !W.UNITS.some((d) => d.id === 'satan'));
  const eng = new Engine({ seed: 48 });
  eng.sides[1].gold = 99999;
  check('撒旦不能被电脑召唤', eng.canSpawn(1, 'satan') === 'no' && eng.spawn(1, 'satan') === false && eng.count(1, 'satan') === 0);
  eng.sides[0].gold = 99999;
  check('玩家可以召唤撒旦', eng.canSpawn(0, 'satan') === 'ok');
}
{
  // 作弊默认全部关闭；水晶血量可以设（作弊菜单用）
  const eng = new Engine({ seed: 49 });
  const ch = eng.cheats;
  const off = ch.infiniteGold === false && ch.noCd === false && ch.noSupply === false &&
    ch.aiOff === false && ch.satanNoCd === false &&
    ch.incomeMul.every((v) => v === 1) && ch.dmgMul.every((v) => v === 1) &&
    ch.invuln.every((v) => v === false) && ch.godMode.every((v) => v === false);
  check('作弊默认全部关闭', off);
  eng.setCrystal(1, 500, 6000);
  check('作弊：水晶血量和上限可设', eng.crystals[1].hp === 500 && eng.crystals[1].maxHp === 6000);
}

// ---------- 2. 技能定点场景：2D，放置单位都在攻击距离、矩形、锥形或圆形之内，cd 初始化为 0 ----------
console.log('\n主动技能（定点场景）');
// 技能定点场景统一平移到 x = SX 之后：玩家水晶（x ≈ 420）的炮塔范围 290 盖不到这里，
// 敌方水晶（x ≈ 7580）同理；这样场景里的血量变化只来自被测技能。
const SX = 1000;
const sat = (x, y = MY) => at(x + SX, y);
const SCENES = [
  { uid: 'sylvie', name: '希尔薇 穿云箭：前方 3 个敌人，整条线受 70 穿刺', setup(e) {
    const s = e.addUnit(0, def('sylvie'), sat(300)); s.skillCd = 0;
    [700, 750, 800].forEach((x) => e.addUnit(1, def('rat'), sat(x)));
    return s;
  } },
  { uid: 'freya', name: '芙蕾雅 钉刺投矛：射程内敌人，定身 2 秒', setup(e) {
    const s = e.addUnit(0, def('freya'), sat(300)); s.skillCd = 0;
    const t = e.addUnit(1, def('brown'), sat(440));   // 血厚，挨了 80 穿刺也不会死（死了就不会被定身）
    return { s, t };
  }, secs: 1, verify: (e, c) => C.has(c.t, 'root') },
  { uid: 'brown', name: '布朗 盾墙：敌方 2 个远程正在攻击', setup(e) {
    const s = e.addUnit(0, def('brown'), sat(300)); s.skillCd = 0;
    for (const x of [520, 540]) {
      const r = e.addUnit(1, def('mushroom'), sat(x));
      r.swing = { t: 0, period: 1, releaseT: 0.9, target: s, hit: false };
    }
    return s;
  }, verify: (e, s) => s.shieldWallT > 0 },
  { uid: 'zass', name: '札斯 影袭：400 距离内的敌方远程，瞬身到它身后，下一刀 ×2', setup(e) {
    const s = e.addUnit(0, def('zass'), sat(300)); s.skillCd = 0;
    e.addUnit(1, def('seren'), sat(600));
    return s;
  }, verify: (e, s) => s.nextHitMul === 2 && s.x > SX + 600 && Math.abs(s.y - MY) < 1 },
  { uid: 'seren', name: '赛伦 烈焰风暴：敌群 4 个以上，落火雨', setup(e) {
    const s = e.addUnit(0, def('seren'), sat(300)); s.skillCd = 0;
    [480, 490, 500, 510].forEach((x) => e.addUnit(1, def('rat'), sat(x)));
    return s;
  }, verify: (e) => e.zones.length === 1 },
  { uid: 'lein', name: '莱恩 圣光冲锋：前方 2 个敌人，冲锋后获得 200 圣盾', setup(e) {
    const s = e.addUnit(0, def('lein'), sat(0)); s.skillCd = 0;
    [120, 160].forEach((x) => e.addUnit(1, def('rat'), sat(x)));
    return s;
  }, secs: 1, verify: (e, s) => s.x > SX + 100 && C.has(s, 'holyShield') },
  { uid: 'worm', name: '熔岩蠕虫 熔岩喷吐：前方 2 个敌人，锥形火伤', setup(e) {
    const s = e.addUnit(0, def('worm'), sat(300)); s.skillCd = 0;
    [380, 420].forEach((x) => e.addUnit(1, def('rat'), sat(x)));
    return s;
  }, verify: (e) => e.units.filter((u) => u.side === 1 && C.has(u, 'burn')).length === 2 },
  { uid: 'xuan', name: '玄 震山掌：击退 140 并眩晕 1 秒', setup(e) {
    const s = e.addUnit(0, def('xuan'), sat(300)); s.skillCd = 0;
    const t = e.addUnit(1, def('rat'), sat(318));
    return { s, t };
  }, verify: (e, c) => C.has(c.t, 'stun') && c.t.x > SX + 318 },
  { uid: 'mordred', name: '摩尔德 亡者复苏：2 具以上尸体，拉起骷髅', setup(e) {
    const s = e.addUnit(0, def('mordred'), sat(300)); s.skillCd = 0;
    // 用真正的死亡流程造尸体：标记死亡，再结算
    for (const x of [340, 360]) {
      const r = e.addUnit(1, def('rat'), sat(x));
      r.hp = 0;
      e.markDead(r);
    }
    e.settleDeaths();
    return s;
  }, verify: (e) => e.units.filter((u) => u.uid === 'skeleton' && u.side === 0 && u.summon).length === 2 &&
    e.bodies.filter((b) => b.corpse).length === 0 },
  { uid: 'olin', name: '奥林 冰封领域：蓄力 1 秒后 3 人以上冻结', setup(e) {
    const s = e.addUnit(0, def('olin'), sat(300)); s.skillCd = 0;
    const foes = [420, 430, 440].map((x) => e.addUnit(1, def('skeleton'), sat(x)));   // 血厚，80 魔法伤害打不死
    return { s, foes };
  }, secs: 1.3, verify: (e, c) => c.foes.every((f) => C.has(f, 'frozen')) },
  { uid: 'yaksha', name: '夜叉 居合·断：蓄力 1.5 秒，前方 3 人以上，220 斩击', setup(e) {
    const s = e.addUnit(0, def('yaksha'), sat(300)); s.skillCd = 0;
    const foes = [350, 400, 450].map((x) => e.addUnit(1, def('rat'), sat(x)));
    return { s, foes };
  }, secs: 1.8, verify: (e, c) => c.foes.every((f) => f.hp < f.maxHp) },
  { uid: 'rex', name: '雷克斯 王之号令：5 个以上友军且交战，全场圣盾 + 不屈', setup(e) {
    const s = e.addUnit(0, def('rex'), sat(300)); s.skillCd = 0;
    const friends = [200, 220, 240, 260].map((x) => e.addUnit(0, def('rat'), sat(x)));
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

// 撒旦三个手动技能：不是自动触发，直接调用释放入口
console.log('\n撒旦手动技能（J / K / L）');
{
  const eng = new Engine({ seed: 50 });
  check('没有撒旦时手动释放返回 nosatan', manualCast(eng, 0, 0) === 'nosatan');
}
{
  // J 地狱火雨：全场敌军 400 火伤 + 3 层灼烧，敌方水晶受伤；之后进入冷却
  const eng = new Engine({ seed: 51 });
  eng.addUnit(0, SATAN, at(300));
  const brown = eng.addUnit(1, def('brown'), at(3000));
  const far = eng.addUnit(1, def('titan'), at(6000, MY + 200));   // 血厚，挨了 400 火伤也不会死（死了就不会叠灼烧）
  const crys = eng.crystals[1];
  const hp0 = crys.hp;
  const r1 = manualCast(eng, 0, 0);
  check('地狱火雨（J）：全场敌军 3 层灼烧、受 400 火伤；敌方水晶受伤；进入冷却',
    r1 === 'ok' && C.stacksOf(brown, 'burn') === 3 && brown.hp < brown.maxHp &&
    C.stacksOf(far, 'burn') === 3 && crys.hp < hp0 && eng.sides[0].manualCd[0] > 0,
    `r=${r1} burn=${C.stacksOf(brown, 'burn')} crys=${hp0 - crys.hp}`);
  check('地狱火雨冷却中再次释放返回 cooldown', manualCast(eng, 0, 0) === 'cooldown');
}
{
  // K 深渊威压：全场敌军被击退（远离撒旦）并眩晕 4 秒
  const eng = new Engine({ seed: 52 });
  eng.addUnit(0, SATAN, at(300));
  const rat = eng.addUnit(1, def('rat'), at(800));
  const bigFoe = eng.addUnit(1, def('titan'), at(1200));
  const r = manualCast(eng, 0, 1);
  check('深渊威压（K）：敌军眩晕（含巨型），远离撒旦被击退',
    r === 'ok' && C.has(rat, 'stun') && C.has(bigFoe, 'stun') && rat.x > 800 + 100,
    `r=${r} rat.x=${rat.x.toFixed(0)}`);
}
{
  // L 灵魂收割：处决生命低于 40% 的敌军，每个 +25 金币，撒旦回血，变成玩家的骷髅
  const eng = new Engine({ seed: 53 });
  eng.sides[0].gold = 0;
  const sat = eng.addUnit(0, SATAN, at(300));
  sat.hp = 10000;
  const hp0 = sat.hp;
  const a = eng.addUnit(1, def('rat'), at(800));
  const b = eng.addUnit(1, def('rat'), at(820));
  a.hp = 10;
  b.hp = 10;
  const big = eng.addUnit(1, def('brown'), at(1500));   // 满血，不处决
  const r = manualCast(eng, 0, 2);
  const summons = eng.units.filter((u) => u.side === 0 && u.uid === 'skeleton' && u.summon).length;
  check('灵魂收割（L）：处决低血敌军，+25 金币/个，撒旦回血，变成骷髅',
    r === 'ok' && !eng.alive(a) && !eng.alive(b) && eng.alive(big) && eng.sides[0].gold === 50 &&
    sat.hp > hp0 && summons === 2,
    `r=${r} gold=${eng.sides[0].gold} summons=${summons}`);
}

// ---------- 3. 规模压力（只跑逻辑，不渲染） ----------
console.log('\n规模压力（只跑逻辑，不渲染）');
// perSide：每方的单位数（混合兵种）；limitMs：每步平均耗时上限
function stress(perSide, limitMs) {
  const eng = new Engine({ seed: 60 + perSide });
  const pool = W.UNITS;
  for (let i = 0; i < perSide; i++) {
    for (const side of [0, 1]) {
      const d = pool[Math.floor(eng.rng() * pool.length)];
      const x = side === 0 ? 3400 + eng.rng() * 500 : 4100 + eng.rng() * 500;
      const y = MY + (eng.rng() - 0.5) * 1400;
      eng.addUnit(side, d, { x, y });
    }
  }
  step(eng, 150);      // 预热 5 秒，让两军接触
  const N = 60;
  const t0 = process.hrtime.bigint();
  step(eng, N);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  const live = eng.units.filter((u) => eng.alive(u)).length;
  check(`${perSide} 对 ${perSide}（共 ${perSide * 2} 个，在场 ${live}）：平均每步 ${ms.toFixed(2)} ms，上限 ${limitMs} ms`, ms < limitMs);
}
stress(200, 10);     // 双方各 200
stress(500, 25);     // 双方合计 1000

// ---------- 4. AI 对 AI（不渲染） ----------
console.log(`\nAI 对 AI：${GAMES} 局（不渲染）`);
const MATCHUPS = [
  ['normal', 'normal'], ['hard', 'normal'], ['normal', 'hard'], ['easy', 'normal'],
  ['normal', 'easy'], ['hard', 'easy'], ['easy', 'hard'], ['hard', 'hard'], ['easy', 'easy'], ['normal', 'normal'],
];
const results = [];
const spawnTotals = [{}, {}];
const skillTotals = {};
let nanCount = 0;
let timeouts = 0;
let rexGames = 0;
let peakSum = 0;
let peakMax = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const [l0, l1] = MATCHUPS[g % MATCHUPS.length];
  const eng = new Engine({ seed: 1000 + g });
  AI.attach(eng, 0, l0);
  AI.attach(eng, 1, l1);
  const maxSteps = Math.round(MAX_SECONDS / DT);
  let steps = 0;
  let bad = false;
  let peak = 0;
  while (!eng.ended && steps < maxSteps) {
    eng.step(DT);
    steps++;
    for (const ev of eng.drainEvents()) {
      if (ev.t === 'skill') skillTotals[ev.uid] = (skillTotals[ev.uid] || 0) + 1;
    }
    if (steps % 30 === 0) {
      let live = 0;
      for (const u of eng.units) {
        if (!eng.alive(u)) continue;
        live++;
        if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.hp)) bad = true;
      }
      peak = Math.max(peak, live);
      if (!Number.isFinite(eng.crystals[0].hp) || !Number.isFinite(eng.crystals[1].hp)) bad = true;
      if (bad) break;
    }
  }
  if (bad) nanCount++;
  if (!eng.ended) timeouts++;
  const rexHere = (eng.sides[0].spawned.rex || 0) + (eng.sides[1].spawned.rex || 0);
  if (rexHere > 0) rexGames++;
  peakSum += peak;
  peakMax = Math.max(peakMax, peak);
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
const decided = results.filter((r) => r.ended && (r.winner === 0 || r.winner === 1)).length;
const draws = results.filter((r) => r.winner === 'draw').length;
console.log(`  合计 ${total} 局，平均时长 ${avg.toFixed(0)} 秒，分出胜负 ${decided} 局（${(100 * decided / total).toFixed(0)}%），平局 ${draws} 局，超时 ${timeouts} 局，出现 NaN ${nanCount} 局，用时 ${elapsed} 秒`);
console.log(`  在场单位峰值（双方合计）：单局最高 ${peakMax}，单局平均 ${(peakSum / total).toFixed(0)}`);
const ratSpawn = (spawnTotals[0].rat || 0) + (spawnTotals[1].rat || 0);
const allSpawn = [spawnTotals[0], spawnTotals[1]].reduce((a, m) => a + Object.values(m).reduce((x, y) => x + y, 0), 0);
const ratShare = allSpawn ? ratSpawn / allSpawn : 0;
console.log(`  灰鼠群占双方总出兵 ${(100 * ratShare).toFixed(1)}%（${ratSpawn} / ${allSpawn} 人，按出兵人数计）`);
console.log(`  雷克斯出场：${rexGames} / ${total} 局`);

console.log('\n各兵种出场次数（人数，玩家 / 电脑）');
const rows = W.UNITS.map((d) => `${d.name} ${spawnTotals[0][d.id] || 0}/${spawnTotals[1][d.id] || 0}`);
for (let i = 0; i < rows.length; i += 4) console.log('  ' + rows.slice(i, i + 4).map((x) => x.padEnd(16)).join(' '));
console.log(`\n主动技能触发次数（${total} 局合计）`);
const skillRows = W.UNITS.filter((d) => d.skill).map((d) => `${d.name}·${d.skill.name} ${skillTotals[d.id] || 0}`);
for (let i = 0; i < skillRows.length; i += 3) console.log('  ' + skillRows.slice(i, i + 3).map((x) => x.padEnd(22)).join(' '));
const silent = W.UNITS.filter((d) => d.skill && !skillTotals[d.id]).map((d) => d.name);
console.log(`  从未触发的技能：${silent.length ? silent.join('、') : '无'}`);

// 验收标准：每局都要分出胜负。超时如实记为失败，不因为是“平衡问题”就放过
check(`AI 对战无 NaN（${total} 局）`, nanCount === 0);
check(`AI 对战每局都分出胜负（超时 ${timeouts} / ${total} 局）`, timeouts === 0, `${timeouts} 局超时，前线僵持，见 docs/IMPLEMENTATION.md`);
check(`灰鼠群出兵不超过双方总出兵的 25%（实际 ${(100 * ratShare).toFixed(1)}%）`, ratShare <= 0.25);
check(`雷克斯至少 1 局出场（实际 ${rexGames} 局）`, rexGames >= 1);

console.log(`\n失败 ${failures} 项`);
if (failures > 0) {
  console.log('结果：未通过');
  process.exitCode = 1;
} else {
  console.log('结果：全部通过');
}
