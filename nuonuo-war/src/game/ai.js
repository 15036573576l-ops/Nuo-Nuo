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

    // 简单：随机买一个买得起的兵，偶尔不买
    decideRandom(eng) {
      if (eng.rng() < 0.4) return;
      const opts = UNITS.filter((d) => eng.canSpawn(this.side, d.id) === 'ok');
      if (!opts.length) return;
      eng.spawn(this.side, opts[Math.floor(eng.rng() * opts.length)].id);
    }

    // 普通 / 困难：给每个兵种打分，选分最高的；最高分的兵快买得起就攒钱，不乱花
    decideSmart(eng) {
      const side = this.side;
      const S = eng.sides[side];
      const t = eng.time;
      const foes = foesByType(eng, side);
      const foeCount = foes.reduce((a, f) => a + f.n, 0);
      const foeFlyers = foes.filter((f) => f.flying).reduce((a, f) => a + f.n, 0);
      let mRanged = 0, mMelee = 0;
      const mine = new Map();
      for (const u of eng.units) {
        if (u.side !== side || !eng.alive(u)) continue;
        if (u.ranged) mRanged++; else mMelee++;
        mine.set(u.uid, (mine.get(u.uid) || 0) + 1);
      }
      const mimics = eng.count(side, 'mimic');
      const income = R.economy.income * S.incomeMul;
      const TIERS = ['T3', 'T2', 'T1', 'T0.5', 'T0'];

      const scored = UNITS.map((def) => {
        let s = 0;
        // 同一兵种场上越多越不想再买，避免一直刷灰鼠
        s -= 0.12 * Math.min(8, mine.get(def.id) || 0);
        // 后期偏向高梯队
        s += 0.5 * TIERS.indexOf(def.tier) * Math.min(1, t / 180);
        for (const f of foes) {
          const n = Math.min(f.n, 3);
          if (matches(def.strongVs, f.def)) s += 1.0 * n;      // 我克制它
          if (matches(f.def.weakVs, def)) s += 1.0 * n;        // 它怕我
          if (matches(def.weakVs, f.def)) s -= 0.8 * n;        // 我怕它
          if (matches(f.def.strongVs, def)) s -= 0.8 * n;      // 它克制我
        }
        const fl = Math.min(foeFlyers, 3);
        if (fl) s += (def.range >= R.rangedThreshold && !def.groundOnly ? 0.5 : -0.5) * fl;
        if (def.range >= R.rangedThreshold) s += mRanged < mMelee * 0.7 ? 0.6 : -0.1;
        else s += mMelee < mRanged * 0.8 ? 0.6 : -0.1;
        s += 0.9 * Math.exp(-Math.pow((t - PEAK[def.tier]) / 120, 2));
        // 前两分钟讲究性价比；之后高梯队的大招才是主力，不再因为贵而被压下去
        s -= (def.cost / 600) * (t < 120 ? 1 : 0.2);
        if (def.id === 'mimic') {
          if (this.profile.econ && mimics < 2 && t > 20 && t < 150 && foeCount <= 2) s += 1.5;
          else s -= 1.0;
        }
        s += (eng.rng() - 0.5) * 0.3;
        return { def, s };
      }).sort((a, b) => b.s - a.s);

      // 节奏：开局两分钟后，场上没有高梯队（T0.5 / T0）时，优先攒钱拿一个大招
      let order = scored;
      const bigOnField = eng.units.some((u) => u.side === side && eng.alive(u) && (u.def.tier === 'T0.5' || u.def.tier === 'T0'));
      if (t > 120 && !bigOnField) {
        // 大招轮着来：已经出过的少想一点，不然会一直只出同一个
        const made = eng.sides[side].spawned;
        order = scored
          .filter((x) => x.def.tier === 'T0.5' || x.def.tier === 'T0')
          .sort((a, b) => (b.s - 0.8 * (made[b.def.id] || 0)) - (a.s - 0.8 * (made[a.def.id] || 0)));
      }
      const top = order[0].def;
      // 最高分的兵钱不够，但按当前收入二十几秒内能攒够：先攒着，不用便宜的兵凑数
      if (eng.canSpawn(side, top.id) === 'gold' && S.gold + income * 25 >= top.cost) return;
      for (const { def } of order) {
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
