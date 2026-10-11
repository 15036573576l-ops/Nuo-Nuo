// 糯糯战记 兵种数据（设计稿 v1）
// 设计说明见 docs/DESIGN.md；所有规则、状态、克制倍率都在 src/rules.js
//
// 字段约定
//   cost 金币 / supply 人口 / cooldown 同兵种出兵冷却(秒) / count 一次出几个
//   hp 单个生命 / armor: none 无甲 | light 轻甲 | heavy 重甲
//   atk 单次伤害 / aspd 每秒攻击次数 / dmg: slash 斩击 | pierce 穿刺 | magic 魔法 | siege 攻城
//   range 攻击距离(像素，>=100 视为远程，远程可以打飞行单位) / speed 移速(像素/秒) / splash 溅射半径
//   element: fire 火 | frost 冰 | poison 毒 | shadow 暗 | holy 圣 | null
//   onHit: 每次命中附加的状态 / tags: undead 不死 | flying 飞行 | giant 巨型 | swarm 群体 | stationary 驻守
//   traits: 被动特性（不需要释放）/ skill: 主动技能，null 表示没有技能（弱兵种不给技能）
//   skill.when: 自动释放条件，电脑和玩家的兵都按这个条件自己放技能
window.UNITS = [
  // ======================= T3 · 廉价基础兵（无主动技能） =======================
  {
    id: 'rat', name: '灰鼠群', title: '下水道大军', tier: 'T3', sheet: 'rat', role: '蜂拥骚扰',
    cost: 50, supply: 1, cooldown: 4, count: 4,
    hp: 65, armor: 'none', atk: 8, aspd: 1.5, dmg: 'slash', range: 20, speed: 78,
    element: null, onHit: [], tags: ['swarm'],
    traits: [{ name: '鼠潮', desc: '一次出 4 只。被溅射伤害打到会成片倒下。' }],
    skill: null,
    strongVs: ['盾卫', '碎城巨人', '单体输出的远程'], weakVs: ['地精爆破手', '焰术士', '任何溅射'],
    lore: '一只老鼠没人在意，四只老鼠一起咬脚踝就不一样了。',
  },
  {
    id: 'skeleton', name: '骷髅兵', title: '不安分的白骨', tier: 'T3', sheet: 'skeleton', role: '廉价前排',
    cost: 50, supply: 1, cooldown: 3, count: 1,
    hp: 240, armor: 'light', atk: 18, aspd: 1.0, dmg: 'slash', range: 26, speed: 45,
    element: null, onHit: [], tags: ['undead'],
    traits: [{ name: '白骨重组', desc: '第一次死亡时散成骨堆，3 秒后以 50% 生命站起来。骨堆期间被圣属性或溅射打中就彻底散架。' }],
    skill: null,
    strongVs: ['毒菇（不死免疫中毒）', '单体慢速输出'], weakVs: ['圣骑士', '溅射伤害'],
    lore: '挖了埋，埋了挖，它自己都烦了。',
  },
  {
    id: 'mushroom', name: '毒菇', title: '孢子投手', tier: 'T3', sheet: 'mushroom', role: '叠毒远程',
    cost: 60, supply: 1, cooldown: 4, count: 1,
    hp: 280, armor: 'none', atk: 10, aspd: 0.8, dmg: 'magic', range: 140, speed: 40,
    element: 'poison', onHit: [{ status: 'poison', stacks: 1 }], tags: [], projectile: 'spore',
    traits: [{ name: '孢子爆裂', desc: '死亡时炸开毒云，给周围 80 范围内的敌人叠 2 层中毒。' }],
    skill: null,
    strongVs: ['重甲（中毒无视护甲）', '碎城巨人'], weakVs: ['骷髅兵等不死单位', '浪人突袭'],
    lore: '伤害不高，但被它盯上的人都是慢慢倒下的。',
  },
  {
    id: 'slime', name: '史莱姆', title: '一团会分裂的果冻', tier: 'T3', sheet: 'slime', role: '耐打前排',
    cost: 65, supply: 1, cooldown: 4, count: 1,
    hp: 400, armor: 'none', atk: 14, aspd: 0.9, dmg: 'slash', range: 26, speed: 32,
    element: null, onHit: [], tags: [],
    traits: [
      { name: '凝胶', desc: '受到的穿刺伤害 -40%，受到的火属性伤害 +50%。' },
      { name: '分裂', desc: '死亡时分裂成 2 只小史莱姆（生命 110，攻击 7），小史莱姆不会再分裂。' },
    ],
    skill: null,
    strongVs: ['弓箭手', '投矛猎手'], weakVs: ['焰术士', '熔岩蠕虫', '溅射'],
    lore: '砍一刀变两只，所以老兵都说别砍它，烧它。',
  },
  {
    id: 'goblin', name: '地精爆破手', title: '扔炸弹的', tier: 'T3', sheet: 'goblin', role: '溅射/攻城',
    cost: 90, supply: 1, cooldown: 5, count: 1,
    hp: 190, armor: 'light', atk: 28, aspd: 0.55, dmg: 'siege', range: 150, speed: 50, splash: 55,
    element: null, onHit: [], tags: [], projectile: 'bomb', groundOnly: true,
    traits: [{ name: '抛投炸弹', desc: '炸弹落地产生 55 范围溅射。只能打地面单位。攻城伤害对水晶 ×3。' }],
    skill: null,
    strongVs: ['灰鼠群', '骷髅兵骨堆', '扎堆的远程'], weakVs: ['吸血蝠群（打不到天上）', '浪人突袭'],
    lore: '炸弹是自己做的，所以偶尔会早爆一点。',
  },

  // ======================= T2 · 专精兵种（克制关系的主力） =======================
  {
    id: 'sylvie', name: '希尔薇', title: '精灵射手', tier: 'T2', sheet: 'huntress_2', role: '远程/防空',
    cost: 120, supply: 1, cooldown: 6, count: 1,
    hp: 220, armor: 'light', atk: 20, aspd: 1.1, dmg: 'pierce', range: 250, speed: 45,
    element: null, onHit: [], tags: [], projectile: 'arrow',
    traits: [{ name: '鹰眼', desc: '对飞行单位伤害 ×1.5。' }],
    skill: {
      name: '穿云箭', cd: 16, when: '前方直线上有 3 个以上敌人',
      desc: '射出一支贯穿整条战线的箭，对路径上每个敌人造成 70 点穿刺伤害。',
    },
    strongVs: ['吸血蝠群', '浪人', '无甲单位'], weakVs: ['盾卫', '史莱姆', '重甲'],
    lore: '射程是全军最远的，前提是前面有人帮她挡着。',
  },
  {
    id: 'freya', name: '芙蕾雅', title: '投矛猎手', tier: 'T2', sheet: 'huntress', role: '反突进',
    cost: 130, supply: 1, cooldown: 6, count: 1,
    hp: 320, armor: 'light', atk: 34, aspd: 0.7, dmg: 'pierce', range: 160, speed: 48,
    element: null, onHit: [], tags: [], projectile: 'spear',
    traits: [{ name: '反冲锋', desc: '对正在冲锋、突进或飞行的目标伤害 ×2，并打断它的冲锋。' }],
    skill: {
      name: '钉刺投矛', cd: 12, when: '射程内有敌人',
      desc: '向射程内造价最高的敌人投出长矛，造成 80 点伤害并定身 2 秒（定身期间不能移动，可以攻击）。',
    },
    strongVs: ['浪人', '圣骑士冲锋', '吸血蝠群', '碎城巨人（定身拖时间）'], weakVs: ['灰鼠群', '骷髅兵海'],
    lore: '她不追人，她等人冲过来。',
  },
  {
    id: 'bats', name: '吸血蝠群', title: '夜空里的牙', tier: 'T2', sheet: 'bat', role: '飞行切后排',
    cost: 140, supply: 2, cooldown: 7, count: 2,
    hp: 150, armor: 'none', atk: 16, aspd: 1.2, dmg: 'slash', range: 30, speed: 72,
    element: null, onHit: [], tags: ['flying'],
    traits: [
      { name: '飞行', desc: '近战单位打不到它。会越过敌方前排，优先攻击远程单位。' },
      { name: '吸血', desc: '造成伤害的 60% 回复自身生命。' },
    ],
    skill: null,
    strongVs: ['焰术士', '亡灵君主', '地精爆破手', '所有只有近战的阵容'], weakVs: ['希尔薇', '芙蕾雅', '水晶炮塔'],
    lore: '两只一组出门，因为一只不敢。',
  },
  {
    id: 'brown', name: '布朗', title: '盾卫', tier: 'T2', sheet: 'warrior_3', role: '防远程前排',
    cost: 110, supply: 1, cooldown: 6, count: 1,
    hp: 820, armor: 'heavy', atk: 24, aspd: 0.8, dmg: 'slash', range: 30, speed: 36,
    element: null, onHit: [], tags: [],
    traits: [],
    skill: {
      name: '盾墙', cd: 15, when: '有 2 个以上敌方远程单位正在攻击我方',
      desc: '举盾 4 秒：自己和身后 120 范围内的友军受到的穿刺伤害 -70%，期间不会被击退。',
    },
    strongVs: ['希尔薇', '芙蕾雅', '水晶炮塔'], weakVs: ['焰术士', '霜语大法师', '毒菇', '灰鼠群'],
    lore: '盾牌比他本人还宽。',
  },
  {
    id: 'mimic', name: '贪婪宝箱', title: '会咬人的存钱罐', tier: 'T2', sheet: 'mimic', role: '经济',
    cost: 150, supply: 1, cooldown: 10, count: 1, maxOnField: 3,
    hp: 500, armor: 'heavy', atk: 80, aspd: 0.5, dmg: 'slash', range: 40, speed: 0,
    element: null, onHit: [], tags: ['stationary'],
    traits: [
      { name: '生财', desc: '站在自家水晶旁不动，每秒给你 +3 金币（50 秒回本）。最多同时 3 个。' },
      { name: '肥羊', desc: '被敌人打碎时，敌方获得 75 金币。' },
    ],
    skill: null,
    strongVs: ['拖长的对局'], weakVs: ['前期速攻', '碎城巨人'],
    lore: '它喜欢金币，也喜欢伸手来拿金币的人。',
  },
  {
    id: 'zass', name: '札斯', title: '赤巾浪人', tier: 'T2', sheet: 'martial_hero', role: '刺客',
    cost: 160, supply: 2, cooldown: 8, count: 1,
    hp: 460, armor: 'light', atk: 50, aspd: 1.0, dmg: 'slash', range: 30, speed: 60,
    element: null, onHit: [], tags: [],
    traits: [{ name: '见切', desc: '30% 几率闪避穿刺伤害。' }],
    skill: {
      name: '影袭', cd: 16, when: '400 范围内有敌方远程单位',
      desc: '瞬身到 400 范围内生命最低的敌方远程单位身后，第一刀伤害 ×2。',
    },
    strongVs: ['希尔薇', '焰术士', '毒菇', '地精爆破手'], weakVs: ['芙蕾雅（反冲锋）', '盾卫', '武僧'],
    lore: '斗笠压得很低，红头巾是他出刀前唯一能看见的东西。',
  },

  // ======================= T1 · 战术核心 =======================
  {
    id: 'seren', name: '赛伦', title: '焰之术士', tier: 'T1', sheet: 'evil_wizard', role: '范围法师',
    cost: 230, supply: 2, cooldown: 10, count: 1,
    hp: 300, armor: 'none', atk: 24, aspd: 0.7, dmg: 'magic', range: 210, speed: 38, splash: 40,
    element: 'fire', onHit: [{ status: 'burn', stacks: 1 }], tags: [],
    traits: [],
    skill: {
      name: '烈焰风暴', cd: 18, when: '目标附近聚集 4 个以上敌人',
      desc: '在敌群中心降下火雨，120 范围内每秒造成 20 点火焰伤害并叠 1 层灼烧，持续 5 秒。',
    },
    strongVs: ['灰鼠群', '史莱姆', '骷髅兵', '盾卫'], weakVs: ['吸血蝠群', '浪人', '亡灵君主（远程对拼）'],
    lore: '奥林的师弟，手心常年托着一团火，两人从来不在同一片战场。',
  },
  {
    id: 'lein', name: '莱恩', title: '圣骑士', tier: 'T1', sheet: 'hero_knight', role: '突进前排',
    cost: 250, supply: 2, cooldown: 10, count: 1,
    hp: 900, armor: 'heavy', atk: 40, aspd: 0.9, dmg: 'slash', range: 36, speed: 40,
    element: 'holy', onHit: [], tags: [],
    traits: [
      { name: '圣光', desc: '对不死单位伤害 ×1.5，打中骨堆会让它彻底散架。' },
      { name: '净化光环', desc: '每 2 秒清除身边 120 范围内友军身上的所有诅咒（易伤、衰弱、亡者印记）。' },
    ],
    skill: {
      name: '圣光冲锋', cd: 15, when: '前方 250 内有 2 个以上敌人',
      desc: '向前冲锋 220 距离，击退路径上所有敌人并造成 60 点伤害，冲锋结束获得 200 点圣盾。冲锋期间会被芙蕾雅打断。',
    },
    strongVs: ['骷髅兵', '亡灵君主的骷髅', '鬼面夜叉的衰弱'], weakVs: ['芙蕾雅', '霜语大法师', '毒菇'],
    lore: '盔甲擦得能照出人影，敌人说那是最后看到的东西。',
  },
  {
    id: 'worm', name: '熔岩蠕虫', title: '地底来客', tier: 'T1', sheet: 'fire_worm', role: '钻地远程',
    cost: 230, supply: 2, cooldown: 10, count: 1,
    hp: 560, armor: 'light', atk: 28, aspd: 0.8, dmg: 'magic', range: 170, speed: 44,
    element: 'fire', onHit: [{ status: 'burn', stacks: 1 }], tags: [], projectile: 'fireball',
    traits: [
      { name: '钻地', desc: '移动时钻在地下，不能被攻击，移速 ×1.5；攻击时必须钻出地面。' },
      { name: '怕冷', desc: '受到的寒霜层数翻倍。' },
    ],
    skill: {
      name: '熔岩喷吐', cd: 14, when: '前方 150 内有 2 个以上敌人',
      desc: '向前方锥形喷出熔岩，造成 60 点火焰伤害并叠 2 层灼烧。',
    },
    strongVs: ['史莱姆', '毒菇（火+毒爆燃）', '慢速远程'], weakVs: ['霜语大法师', '浪人'],
    lore: '它不在乎前排是谁，它从下面过去。',
  },
  {
    id: 'xuan', name: '玄', title: '武僧', tier: 'T1', sheet: 'martial_hero_3', role: '打断/控制',
    cost: 200, supply: 2, cooldown: 9, count: 1,
    hp: 700, armor: 'light', atk: 34, aspd: 1.3, dmg: 'slash', range: 26, speed: 50,
    element: null, onHit: [], tags: [],
    traits: [{ name: '化劲', desc: '每受到 4 次攻击，第 4 次完全格挡。' }],
    skill: {
      name: '震山掌', cd: 12, when: '附近有正在蓄力/施法的敌人，否则打当前目标',
      desc: '一掌击退目标 140 距离并眩晕 1 秒，会打断蓄力和施法（夜叉的居合、奥林的冰封）。',
    },
    strongVs: ['鬼面夜叉', '霜语大法师', '浪人', '吸血蝠群以外的近战'], weakVs: ['灰鼠群', '焰术士', '飞行单位'],
    lore: '他说拳头不是用来打人的，是用来让人停下的。',
  },

  // ======================= T0.5 · 改变战局的兵种 =======================
  {
    id: 'mordred', name: '摩尔德', title: '亡灵君主', tier: 'T0.5', sheet: 'evil_wizard_2', role: '召唤/诅咒',
    cost: 320, supply: 3, cooldown: 14, count: 1,
    hp: 480, armor: 'none', atk: 45, aspd: 0.8, dmg: 'magic', range: 230, speed: 34,
    element: 'shadow', onHit: [{ status: 'vulnerable' }], tags: [],
    traits: [{ name: '暗蚀', desc: '攻击给目标施加【易伤】诅咒：受到的伤害 +20%，持续 5 秒。' }],
    skill: {
      name: '亡者复苏', cd: 20, when: '250 范围内有 2 具以上尸体',
      desc: '从 250 范围内的尸体中拉起最多 4 名骷髅（生命 150、攻击 16，存在 15 秒，不占人口）。单位死后尸体保留 6 秒。',
    },
    strongVs: ['焰术士的长线拉扯', '混战后期', '重甲（易伤配合集火）'], weakVs: ['圣骑士', '吸血蝠群', '浪人'],
    lore: '兜帽下面什么都没有，只有法杖顶上那团烧不完的紫焰。',
  },
  {
    id: 'olin', name: '奥林', title: '霜语大法师', tier: 'T0.5', sheet: 'wizard_pack', role: '控场法师',
    cost: 300, supply: 3, cooldown: 14, count: 1,
    hp: 420, armor: 'none', atk: 34, aspd: 0.8, dmg: 'magic', range: 240, speed: 36,
    element: 'frost', onHit: [{ status: 'chill', stacks: 1 }], tags: [],
    traits: [],
    skill: {
      name: '冰封领域', cd: 20, when: '目标附近聚集 3 个以上敌人',
      desc: '蓄力 1 秒（可被打断），然后对 160 范围内的敌人造成 80 点魔法伤害并叠满 3 层寒霜，直接冻结 1.5 秒。',
    },
    strongVs: ['碎城巨人', '圣骑士冲锋', '熔岩蠕虫', '一切扎堆推进'], weakVs: ['武僧（打断）', '浪人', '吸血蝠群'],
    lore: '一手法杖一手魔典，胡子是他的避雷针，也是他的骄傲。',
  },
  {
    id: 'yaksha', name: '夜叉', title: '鬼面剑豪', tier: 'T0.5', sheet: 'martial_hero_2', role: '蓄力爆发',
    cost: 300, supply: 3, cooldown: 12, count: 1,
    hp: 600, armor: 'light', atk: 48, aspd: 0.8, dmg: 'slash', range: 36, speed: 45,
    element: 'shadow', onHit: [{ status: 'weaken' }], tags: [],
    traits: [{ name: '鬼面', desc: '攻击给目标施加【衰弱】诅咒：造成的伤害 -30%，持续 5 秒。' }],
    skill: {
      name: '居合·断', cd: 18, when: '前方 260 直线上有 3 个以上敌人',
      desc: '收刀蓄力 1.5 秒（可被眩晕、击退打断，打断后技能进入一半冷却），然后对前方 260 直线上所有敌人造成 220 点伤害。每击杀一个敌人返还 2 秒冷却。',
    },
    strongVs: ['灰鼠群', '远程排成一列', '前排对砍'], weakVs: ['武僧', '芙蕾雅定身', '圣骑士（净化衰弱）'],
    lore: '面具下面是什么，见过的人都没机会说。',
  },

  // ======================= T0 · 王牌 =======================
  {
    id: 'rex', name: '雷克斯', title: '征服王', tier: 'T0', sheet: 'king_1', role: '光环/祝福',
    cost: 480, supply: 4, cooldown: 20, count: 1,
    hp: 1300, armor: 'heavy', atk: 60, aspd: 0.7, dmg: 'slash', range: 46, speed: 32, splash: 50,
    element: 'holy', onHit: [], tags: ['giant'],
    traits: [
      { name: '王之威仪', desc: '200 范围内的友军伤害 +15%，并免疫【衰弱】。' },
      { name: '巨型', desc: '免疫击退，眩晕时间减半。' },
    ],
    skill: {
      name: '王之号令', cd: 30, when: '我方场上 5 个以上单位且正在交战',
      desc: '全场所有友军获得 150 点【圣盾】和一次【不屈】（6 秒内第一次受到致命伤害时保留 1 点生命并无敌 1.5 秒）。',
    },
    strongVs: ['大规模团战', '鬼面夜叉'], weakVs: ['毒菇（中毒无视护甲）', '霜语大法师', '亡灵君主（易伤集火）'],
    lore: '亲自上前线的国王，红色披风是全军冲锋的信号。',
  },
  {
    id: 'titan', name: '格罗姆', title: '碎城巨人', tier: 'T0', sheet: 'warrior_1', role: '直取水晶',
    cost: 420, supply: 4, cooldown: 20, count: 1,
    hp: 2200, armor: 'heavy', atk: 90, aspd: 0.5, dmg: 'siege', range: 40, speed: 26,
    element: null, onHit: [], tags: ['giant'],
    traits: [
      { name: '眼里只有水晶', desc: '无视所有敌方单位，不停下也不还手，一路走到敌方水晶。攻城伤害对水晶 ×3（每 2 秒 270）。' },
      { name: '巨型', desc: '免疫击退，眩晕时间减半。' },
    ],
    skill: null,
    strongVs: ['只会防守的阵容', '贪婪宝箱经济流'], weakVs: ['毒菇', '霜语大法师', '芙蕾雅定身', '亡灵君主易伤'],
    lore: '他不打架，他只是要回家，而你的水晶挡在他家门口。',
  },
];
