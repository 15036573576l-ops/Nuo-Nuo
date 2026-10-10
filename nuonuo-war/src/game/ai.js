// 糯糯战记 · 电脑对手
// 只通过 eng.canSpawn / eng.spawn 出兵（和玩家一样的接口），不直接改游戏状态。
// 读取场上的敌方单位是允许的，用来判断该克制什么。
(function () {
  const R = window.RULES;
  const UNITS = window.UNITS;

  const LEVELS = {
    easy:   { label: '简单', incomeMul: 0.8,  interval: [1.6, 3.0], smart: false },
    normal: { label: '普通', incomeMul: 1.0,  interval: [0.5, 0.9], smart: true },
    hard:   { label: '困难', incomeMul: 1.15, interval: [0.35, 0.6], smart: true, econ: true },
  };
  // 各梯队最适合登场的时间点（秒）
  const PEAK = { T3: 25, T2: 90, T1: 150, 'T0.5': 210, T0: 270 };
  // 溅射兵种：敌方扎堆时优先考虑
  const SPLASH_IDS = ['goblin', 'seren', 'rex', 'olin', 'worm'];

  // 克制文本匹配：strongVs / weakVs 里写的是兵种名或定位词，用包含关系判断
  function matches(list, def) {
    if (!list) return false;
    return list.some((s) => s.indexOf(def.name) >= 0 || (def.title && s.indexOf(def.title) >= 0));
  }

  function foesByType(eng, side) {
    const map = new Map();
    for (const u of eng.units) {
      if (u.side === side || !eng.alive(u)) continue;
      const e = map.get(u.uid) || { def: u.def, n: 0, flying: u.flying };
      e.n += 1;
      map.set(u.uid, e);
    }
    return [...map.values()];
  }

  class AI {
    constructor(eng, side, level) {
      this.side = side;
      this.level = level;
      this.profile = LEVELS[level] || LEVELS.normal;
      this.timer = 0.5;
      eng.sides[side].incomeMul = this.profile.incomeMul;
    }

    static attach(eng, side, level) {
      const ai = new AI(eng, side, level);
      eng.ais.push(ai);
      return ai;
    }

    tick(eng, dt) {
      this.timer -= dt;
      if (this.timer > 0) return;
      const [lo, hi] = this.profile.interval;
      this.timer = lo + (hi - lo) * eng.rng();
      this.decide(eng);
    }

    decide(eng) {
      if (eng.ended) return;
      if (!this.profile.smart) return this.decideRandom(eng);
      return this.decideSmart(eng);
    }

    // 简单：随机定一个想要的兵种，攒够钱就出；偶尔发呆不出
    // （以前是“随机买一个买得起的”，结果总是买最便宜的灰鼠群）
    decideRandom(eng) {
      if (eng.rng() < 0.4) return;
      const pool = UNITS.filter((d) => d.id !== 'mimic');
      if (!this.goal) this.goal = pool[Math.floor(eng.rng() * pool.length)].id;
      const why = eng.canSpawn(this.side, this.goal);
      if (why === 'ok') {
        eng.spawn(this.side, this.goal);
        this.goal = null;
      } else if (why !== 'gold') {
        this.goal = null;   // 冷却、人口、上限：换一个目标
      }
    }

    // 普通 / 困难：给每个兵种打分，选分最高的；最高分的兵快买得起就攒钱，不乱花
    // 修正（review 问题 1、2）：
    //   - 敌方单位按“价值”而不是“个数”计权，一组 4 只灰鼠不再算成 4 个威胁
    //   - 同兵种降权看累计出兵组数占比，而不是场上在场个数
    //   - 人口越紧张越偏向“每人口价值高”的兵种
    //   - 大招阶段真正轮到 T0，钱或人口不够时攒着，不拿便宜兵凑数（除非水晶告急）
    decideSmart(eng) {
      const side = this.side;
      const S = eng.sides[side];
      const t = eng.time;
      const foes = foesByType(eng, side);
      const foeCount = foes.reduce((a, f) => a + f.n, 0);
      const foeFlyers = foes.filter((f) => f.flying).reduce((a, f) => a + f.n, 0);
      let mRanged = 0, mMelee = 0;
      for (const u of eng.units) {
        if (u.side !== side || !eng.alive(u)) continue;
        if (u.ranged) mRanged++; else mMelee++;
      }
      const groups = {};
      let totalUnits = 0;
      for (const d of UNITS) {
        groups[d.id] = (S.spawned[d.id] || 0) / d.count;
        totalUnits += S.spawned[d.id] || 0;
      }
      const mimics = eng.count(side, 'mimic');
      const income = R.economy.income * S.incomeMul;
      const crowd = S.supplyUsed / R.economy.supplyCap;
      const TIERS = ['T3', 'T2', 'T1', 'T0.5', 'T0'];
      // 敌人离我方水晶多近：用来判断“告急”（平原版：到我方水晶圆心的距离，1100 像素以内算告急）
      const own = eng.crystals[side];
      const danger = eng.units.some((u) => u.side !== side && eng.alive(u) && Math.hypot(u.x - own.x, u.y - own.y) < 1100);

      let scored = UNITS.map((def) => {
        let s = 0;
        // 同兵种出得越多越不想再出：看这个兵种占自己累计出兵个数的比例（灰鼠群一次 4 只，占比涨得快）
        if (totalUnits >= 8) s -= 10 * Math.max(0, (S.spawned[def.id] || 0) / totalUnits - 0.10);
        // 后期偏向高梯队
        s += 0.5 * TIERS.indexOf(def.tier) * Math.min(1, t / 180);
        for (const f of foes) {
          // 威胁权重 = 敌方这个兵种在场的总价值 / 120，最多 3
          const w = Math.min(3, ((f.n / f.def.count) * f.def.cost) / 120);
          if (matches(def.strongVs, f.def)) s += 1.0 * w;      // 我克制它
          if (matches(f.def.weakVs, def)) s += 1.0 * w;        // 它怕我
          if (matches(def.weakVs, f.def)) s -= 0.8 * w;        // 我怕它
          if (matches(f.def.strongVs, def)) s -= 0.8 * w;      // 它克制我
        }
        // 敌方扎堆（超过 40 个单位）时，溅射兵种加分，人越多加得越多
        if (foeCount > 40 && SPLASH_IDS.indexOf(def.id) >= 0) s += 0.8 * Math.min(3, (foeCount - 40) / 40 + 1);
        const fl = Math.min(foeFlyers, 3);
        if (fl) s += (def.range >= R.rangedThreshold && !def.groundOnly ? 0.5 : -0.5) * fl;
        if (def.range >= R.rangedThreshold) s += mRanged < mMelee * 0.7 ? 0.6 : -0.1;
        else s += mMelee < mRanged * 0.8 ? 0.6 : -0.1;
        s += 0.9 * Math.exp(-Math.pow((t - PEAK[def.tier]) / 120, 2));
        // 前两分钟讲究性价比；之后高梯队的大招才是主力，不再因为贵而被压下去
        s -= (def.cost / 600) * (t < 120 ? 1 : 0.2);
        // 人口紧张时偏向每人口价值高的兵种（灰鼠群 50/人口，雷克斯 120/人口）
        s += 1.2 * crowd * ((def.cost / def.supply) - 90) / 90;
        if (def.id === 'mimic') {
          if (this.profile.econ && mimics < 2 && t > 20 && t < 150 && foeCount <= 2) s += 1.5;
          else s -= 1.0;
        }
        s += (eng.rng() - 0.5) * 0.3;
        return { def, s };
      }).sort((a, b) => b.s - a.s);
      // 设计规则：单一兵种占双方总出兵的比例不超过 25%（总出兵 40 个以上才生效），超过的不参与选兵
      // 没有这条规则，灰鼠群（一次 4 只、冷却短）会占掉 30% 以上的出兵，见 docs/QUESTIONS.md
      const share = (id) => (totalUnits >= 40 ? (S.spawned[id] || 0) / totalUnits : 0);
      const allowed = scored.filter((x) => share(x.def.id) <= 0.25);
      if (allowed.length) scored = allowed;

      // 节奏：开局两分钟后，场上没有高梯队（T0.5 / T0）时，优先攒钱拿一个大招
      let order = scored;
      const bigOnField = eng.units.some((u) => u.side === side && eng.alive(u) && (u.def.tier === 'T0.5' || u.def.tier === 'T0'));
      if (t > 120 && !bigOnField) {
        // 大招轮着来：出得少的优先；T0 额外加分，保证王牌真的会登场
        order = scored
          .filter((x) => x.def.tier === 'T0.5' || x.def.tier === 'T0')
          .map((x) => ({ def: x.def, s: x.s - 0.8 * groups[x.def.id] + (x.def.tier === 'T0' ? 0.6 : 0) }))
          .sort((a, b) => b.s - a.s);
      }
      const top = order[0].def;
      const why = eng.canSpawn(side, top.id);
      // 钱差一点就攒：平时等 40 秒以内（覆盖 T0 的 420–480 金），告急时只等 10 秒
      if (why === 'gold' && S.gold + income * (danger ? 10 : 40) >= top.cost) return;
      // 人口差一点：等前线死人腾人口，不用便宜兵把人口塞满（告急时不等）
      if (!danger && why === 'supply' && top.supply <= R.economy.supplyCap * 0.4) return;
      // 退而求其次只在分数接近第一名的兵种里挑；差太多就攒钱。
      // 告急时放宽到 2 分，但不再“什么便宜买什么”——以前守家时会刷出几百只灰鼠群
      const floor = order[0].s - (danger ? 2.0 : 1.0);
      for (const { def, s } of order.concat(order === scored ? [] : scored)) {
        if (s < floor) break;
        if (eng.canSpawn(side, def.id) === 'ok') {
          eng.spawn(side, def.id);
          return;
        }
      }
    }
  }

  window.AI = AI;
  window.AI_LEVELS = LEVELS;
})();
