// 糯糯战记 全局规则（设计稿 v1）：克制倍率、状态、元素反应、经济、水晶
window.RULES = {
  // 战场是二维平原。inset：水晶圆心离左右边界的距离；出兵点在自家水晶内侧 spawnDepth 的纵深里，
  // y 方向以 h/2 为中心铺开 spawnSpread（几乎整条出兵带，兵不会挤成一条线）
  map: { w: 8000, h: 3200, inset: 420, crystalRadius: 70, crystalHp: 6000, spawnDepth: 240, spawnSpread: 2400 },

  // 水晶自带炮塔，保证没有远程的阵容也不会被飞行单位白打
  crystal: { atk: 25, aspd: 1.0, dmg: 'pierce', range: 220, canHitAir: true },

  // 经济：开局金币少，之后收入和人口上限都随对局时间涨，不封顶（越打越大）
  //   每秒基础收入 = incomeBase + incomeGrowth × 对局秒数（再乘阵营收入倍率，宝箱另加）
  //   人口上限     = supplyBase + supplyGrowth × 对局秒数（向下取整）
  economy: {
    startGold: 300,
    incomeBase: 10,
    incomeGrowth: 0.4,
    supplyBase: 40,
    supplyGrowth: 0.8,
    corpseSeconds: 6,
  },

  // 伤害类型 × 护甲类型 倍率。最大 1.35、最小 0.6：全部是软克制，没有“打不动”
  damageMatrix: {
    slash: { none: 1.0, light: 1.0, heavy: 0.8 },
    pierce: { none: 1.3, light: 1.0, heavy: 0.6 },
    magic: { none: 1.0, light: 1.0, heavy: 1.35 },
    siege: { none: 0.8, light: 0.8, heavy: 1.0, crystal: 3.0 },
  },
  rangedThreshold: 100, // range >= 100 才算远程，才能打飞行单位（groundOnly 例外）

  // 状态：数据驱动，叠层规则写死在这里，引擎只做通用处理
  statuses: {
    burn:       { kind: 'element', element: 'fire',   maxStacks: 3, duration: 4, dps: 10, healMul: 0.5, refresh: 'duration', desc: '每层每秒 10 点伤害，最多 3 层；受到的治疗 -50%。' },
    chill:      { kind: 'element', element: 'frost',  maxStacks: 3, duration: 4, slowPerStack: 0.15, refresh: 'duration', desc: '每层移速和攻速 -15%；叠满 3 层变成冻结。' },
    frozen:     { kind: 'cc',      element: 'frost',  duration: 1.5, immuneAfter: 4, desc: '完全不能行动 1.5 秒；之后 4 秒内不会再被冻结。' },
    poison:     { kind: 'element', element: 'poison', maxStacks: 5, duration: 6, dps: 6, ignoresArmor: true, refresh: 'duration', desc: '每层每秒 6 点伤害，最多 5 层，无视护甲。不死单位免疫。' },
    vulnerable: { kind: 'curse',   duration: 5, damageTakenMul: 1.2, desc: '诅咒·易伤：受到的伤害 +20%。' },
    weaken:     { kind: 'curse',   duration: 5, damageDealtMul: 0.7, desc: '诅咒·衰弱：造成的伤害 -30%。' },
    holyShield: { kind: 'blessing', duration: 6, absorb: 150, desc: '祝福·圣盾：吸收一定伤害。' },
    unyielding: { kind: 'blessing', duration: 6, desc: '祝福·不屈：第一次受到致命伤害时保留 1 点生命并无敌 1.5 秒。' },
    stun:       { kind: 'cc', desc: '眩晕：不能移动和攻击，打断蓄力。巨型单位时间减半。之后 2 秒内免疫眩晕。', immuneAfter: 2 },
    root:       { kind: 'cc', desc: '定身：不能移动，可以攻击。' },
  },

  // 元素反应：消耗状态换爆发，避免无限叠加
  reactions: [
    { id: 'melt', name: '融化', when: '火属性命中带有寒霜或冻结的目标', effect: '移除寒霜/冻结，额外造成 60 + 20×层数 魔法伤害（冻结算 3 层）。' },
    { id: 'ignite', name: '爆燃', when: '火属性命中中毒 3 层以上的目标', effect: '移除中毒，以目标为中心 80 范围内所有敌人受到 15×层数 伤害。' },
    { id: 'smite', name: '圣裁', when: '圣属性命中不死单位或骨堆', effect: '伤害 ×1.5；骨堆直接散架。' },
  ],

  tierSpawnCooldown: { T3: '3-5s', T2: '6-10s', T1: '9-10s', 'T0.5': '12-14s', T0: '20s' },
};
