// 糯糯战记 · 特殊单位：只有玩家能自己召唤（撒旦还能被作弊派送给电脑），不进入电脑 AI、平衡模拟和无头测试的兵种池
// 撒旦的形象来自 chierit 的 Boss: Demon Slime（CC-BY 4.0），见 assets/CREDITS.md
window.SPECIAL_UNITS = [
  {
    id: 'satan', name: '撒旦', title: '深渊魔王', tier: 'EX', sheet: 'satan', role: '魔王',
    playerOnly: true, cheatSend: true, scale: 1.2, ccImmune: true,   // 没有数量上限；电脑不能自己买，只能作弊派送
    cost: 666, supply: 5, count: 1,
    hp: 20000, armor: 'heavy', atk: 260, aspd: 0.8, dmg: 'magic', range: 80, speed: 42, splash: 130,
    element: 'fire', onHit: [{ status: 'burn', stacks: 3 }, { status: 'weaken' }], tags: ['giant'],
    traits: [
      { name: '魔王之躯', desc: '免疫眩晕、冻结、定身、寒霜、击退，以及易伤、衰弱等所有诅咒。' },
      { name: '炼狱光环', desc: '身边 200 范围内的敌人每 0.5 秒受到 30 点火焰伤害并叠 1 层灼烧。' },
      { name: '横扫', desc: '大砍刀每一下都溅射 130 范围，附带 3 层灼烧和衰弱。' },
      { name: '不灭', desc: '第一次死亡时原地复活，生命回满并无敌 3 秒。' },
    ],
    skill: null,
    // 主动技能由玩家手动释放（技能栏按钮或 J / K / L），撒旦在场时才能用；电脑那边的撒旦自己会放
    manualSkills: [
      { id: 'meteor', key: 'J', name: '地狱火雨', cd: 18, color: '#ff7a3d',
        desc: '全场所有敌军受到 400 点火焰伤害并叠满 3 层灼烧（会触发融化、爆燃）。不打水晶。' },
      { id: 'dread', key: 'K', name: '深渊威压', cd: 24, color: '#c86bff',
        desc: '全场所有敌军被击退 180 并眩晕 4 秒，无视眩晕免疫和巨型减半，打断一切蓄力和冲锋。对面的撒旦和冰龙压不住。' },
      { id: 'reap', key: 'L', name: '灵魂收割', cd: 30, color: '#9fe8ff',
        desc: '处决全场生命低于 40% 的敌军。每个灵魂 +25 金币、撒旦回复 5% 生命，最多 8 个灵魂变成你的骷髅战士（存在 20 秒）。' },
    ],
    strongVs: ['一切'], weakVs: ['作弊菜单里的“秒杀”按钮'],
    lore: '它不属于这场战争，它只是被哥哥叫来看热闹的。',
  },
  // 冰龙：形象是 assets/frostwing-src 里的“极寒之翼”三维模型渲染出来的。数值是撒旦的 1000 倍
  {
    id: 'frostwing', name: '冰龙', title: '极寒之翼', tier: 'SSSSSSS', sheet: 'frostwing', role: '灭世',
    playerOnly: true, cardClass: 'frost', scale: 1.5, shadowR: 110, cull: 700,
    ccImmune: true, statusImmune: { burn: 1, poison: 1 }, noFlinch: true, revive: '冰晶重生', crystalSwitch: true, breath: true, hunter: true,
    taunt: 2400,       // 嘲讽半径：这个范围里的敌军只打冰龙
    cost: 500000, supply: 0, count: 1,
    hp: 20000000, armor: 'heavy', atk: 260000, aspd: 0.5, dmg: 'magic', range: 420, speed: 110, splash: 260,
    element: 'frost', onHit: [{ status: 'chill', stacks: 3 }], tags: ['giant'],
    traits: [
      { name: '极寒之躯', desc: '走在地上，和别的兵一样能被打到、被挡住。免疫控制、灼烧、中毒、诅咒和击退。' },
      { name: '猎食', desc: '往右走，哪边有敌军就追哪边，头跟着目标转。敌军跑到身后就 4 倍速扑回去拍一爪子，伤害和吐息一样。场上还有敌军时不碰水晶。' },
      { name: '嘲讽', desc: '2400 范围内的敌军和敌方炮塔只打冰龙，够不着的会一路追过来。' },
      { name: '永冻光环', desc: '420 范围内的敌人每 0.5 秒受 30000 冰伤并叠 1 层寒霜。' },
      { name: '冰霜吐息', desc: '普通攻击：落点 260 范围 260000 魔法伤害，叠满 3 层寒霜。' },
      { name: '冰晶重生', desc: '第一次死亡时原地重生，回满血并无敌 3 秒。' },
    ],
    skill: null,
    // 手动技能照着“极寒之翼”的三个动作来：振翼、咆哮、风雪。场上每一头冰龙都会一起放
    manualSkills: [
      { id: 'gust', key: 'B', name: '振翼', cd: 10, color: '#a9c9ff',
        desc: '900 范围内的敌军受 150000 冰伤，被吹飞 420 并冻结 3 秒，巨型也吹得动。' },
      { id: 'roar', key: 'N', name: '咆哮', cd: 16, color: '#7dd8ff',
        desc: '朝前一道贯穿全图的吐息（半宽 260）：800000 伤害并冻结 6 秒，敌方水晶在带上也照打。' },
      { id: 'blizzard', key: 'M', name: '暴风雪', cd: 40, color: '#e4efff',
        desc: '全场暴风雪 8 秒：敌军每 0.5 秒受 60000 伤害并一直冻着，敌方水晶每 0.5 秒 20000；结束时绝对零度，全场敌军再受 5000000。' },
    ],
    strongVs: ['一切', '撒旦也算'], weakVs: ['“冰龙打水晶”开关', '哥哥的金币'],
    lore: '暴风雪之眼里睡着的那一头。五十万金币只够把它叫醒，不够让它听话。',
  },
];
