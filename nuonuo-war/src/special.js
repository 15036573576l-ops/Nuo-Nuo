// 糯糯战记 · 特殊单位：只有玩家能召唤，不进入电脑 AI、平衡模拟和无头测试的兵种池
// 形象来自 chierit 的 Boss: Demon Slime（CC-BY 4.0），见 assets/CREDITS.md
window.SPECIAL_UNITS = [
  {
    id: 'satan', name: '撒旦', title: '深渊魔王', tier: 'EX', sheet: 'satan', role: '魔王',
    playerOnly: true, scale: 1.2, ccImmune: true,
    cost: 666, supply: 5, cooldown: 45, count: 1, maxOnField: 1,
    hp: 20000, armor: 'heavy', atk: 260, aspd: 0.8, dmg: 'magic', range: 80, speed: 42, splash: 130,
    element: 'fire', onHit: [{ status: 'burn', stacks: 3 }, { status: 'weaken' }], tags: ['giant'],
    traits: [
      { name: '魔王之躯', desc: '免疫眩晕、冻结、定身、寒霜、击退，以及易伤、衰弱等所有诅咒。' },
      { name: '炼狱光环', desc: '身边 200 范围内的敌人每 0.5 秒受到 30 点火焰伤害并叠 1 层灼烧。' },
      { name: '横扫', desc: '大砍刀每一下都溅射 130 范围，附带 3 层灼烧和衰弱。' },
      { name: '不灭', desc: '第一次死亡时原地复活，生命回满并无敌 3 秒。' },
    ],
    skill: null,
    // 主动技能由玩家手动释放（技能栏按钮或 J / K / L），撒旦在场时才能用
    manualSkills: [
      { id: 'meteor', key: 'J', name: '地狱火雨', cd: 18, color: '#ff7a3d',
        desc: '全场所有敌军受到 400 点火焰伤害并叠满 3 层灼烧（会触发融化、爆燃），敌方水晶受到 500 点伤害。' },
      { id: 'dread', key: 'K', name: '深渊威压', cd: 24, color: '#c86bff',
        desc: '全场所有敌军被击退 180 并眩晕 4 秒，无视眩晕免疫和巨型减半，打断一切蓄力和冲锋。' },
      { id: 'reap', key: 'L', name: '灵魂收割', cd: 30, color: '#9fe8ff',
        desc: '处决全场生命低于 40% 的敌军。每个灵魂 +25 金币、撒旦回复 5% 生命，最多 8 个灵魂变成你的骷髅战士（存在 20 秒）。' },
    ],
    strongVs: ['一切'], weakVs: ['作弊菜单里的“秒杀”按钮'],
    lore: '它不属于这场战争，它只是被哥哥叫来看热闹的。',
  },
];
