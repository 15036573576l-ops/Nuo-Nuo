// 糯糯战记 · 对局引擎：二维战场、空间网格、固定步长主循环、经济与出兵、索敌与移动、分离推挤、胜负
// 纯逻辑，不碰 DOM / canvas。渲染和界面只读这里的状态，通过 spawn() 下单。
// 坐标：世界像素 x ∈ [0, map.w]，y ∈ [0, map.h]。side 0 玩家在左、朝右走；side 1 电脑在右、朝左走。
(function () {
  const R = window.RULES;
  const SH = window.HD_SHEETS;
  const C = window.Combat;
  const DT = 1 / 30;
  const CELL = 96;          // 空间网格的格子大小
  const MAX_R = 40;         // 单位半径上限，查询范围要多留这一截
  const REACH = 4;          // 攻击距离的余量（中心到中心）
  const RETARGET = 0.25;    // 追击目标的重新计算间隔（秒）
  const GROUP_GAP_X = 26;   // 同一组单位往后排的间距
  const GROUP_GAP_Y = 40;   // 同一组单位纵向的间距：一组铺开，不挤成一条线
  const MASS_GAP = 26;      // 批量出兵：相邻单位的间距（纵向每行一个，横向每列一排）
  const MASS_DEPTH = 3000;  // 批量出兵：横向最多排多深，人再多就挤紧
  const BATCH_MAX = 50000;  // 批量出兵：每方同时在场的批量兵上限（所有兵种合计）。超出的进待命队列，场上少了再陆续补进来
  const BATCH_ONCE = 10000; // 批量出兵：一次召唤最多多少个（再多要分几次点）
  const ENTER_PER_STEP = 60; // 待命队列每方每步最多进场的个数（陆续进场，不是一下子涌进来）
  const BUDGET_MS = 24;     // 一帧里逻辑最多占用的毫秒数，超了就停，欠的时间留到下一帧（慢放，不卡死）
  const ACC_MAX = 0.25;     // 欠的模拟时间上限（秒）：卡顿之后不快进补回来

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function animOf(sheet, name) {
    const sh = SH[sheet];
    return sh ? sh.anims[name] : null;
  }
  function deathDur(sheet) {
    const a = animOf(sheet, 'death');
    return a ? a.n / a.fps : 0.8;
  }
  // 单位碰撞半径：max(12, min(40, 身体宽 × 0.45))；巨型单位至少 30
  function unitRadius(def) {
    const sh = SH[def.sheet];
    let r = sh ? Math.max(12, Math.min(MAX_R, sh.bodyW * 0.45)) : 20;
    if (def.tags.indexOf('giant') >= 0) r = Math.max(30, r);
    return r;
  }
  // 相邻格子的方向：右、右下、下、左下（配上它们的反方向正好是 8 邻格），用来每对只访问一次
  const FWD = [1, 0, 1, 1, 0, 1, -1, 1];

  // 空间网格：只存单位引用。每步开始重建；分离推挤前后各重建一次。
  // 地图大小是固定的，格子直接放在一个平铺的数组里（下标 = cy * gw + cx），比按坐标查哈希表快得多。
  // 单位不会离开地图（place 会钳住），万一坐标越界就归到最边上那一格
  class Grid {
    constructor(cell = CELL) {
      this.cell = cell;
      this.gw = Math.ceil(R.map.w / cell) + 1;
      this.gh = Math.ceil(R.map.h / cell) + 1;
      this.cells = new Array(this.gw * this.gh);
      for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
      this.used = [];           // 本轮有单位的格子（桶），clear 时只清这些
      this.ucx = [];            // 与 used 一一对应的格子坐标
      this.ucy = [];
    }
    clear() {
      const used = this.used;
      for (let i = 0; i < used.length; i++) used[i].length = 0;
      used.length = 0;
      this.ucx.length = 0;
      this.ucy.length = 0;
    }
    // 格子 (cx, cy) 的桶；出了地图返回 null
    at(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh) return null;
      return this.cells[cy * this.gw + cx];
    }
    insert(u) {
      let cx = Math.floor(u.x / this.cell), cy = Math.floor(u.y / this.cell);
      if (cx < 0) cx = 0; else if (cx >= this.gw) cx = this.gw - 1;
      if (cy < 0) cy = 0; else if (cy >= this.gh) cy = this.gh - 1;
      const b = this.cells[cy * this.gw + cx];
      if (b.length === 0) { this.used.push(b); this.ucx.push(cx); this.ucy.push(cy); }
      b.push(u);
    }
    // 所有中心距离 ≤ r 的单位（不过滤阵营和状态）
    near(x, y, r, out = []) {
      const c = this.cell, r2 = r * r, gw = this.gw, cells = this.cells;
      const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(gw - 1, Math.floor((x + r) / c));
      const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(this.gh - 1, Math.floor((y + r) / c));
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const b = cells[cy * gw + cx];
          for (let i = 0; i < b.length; i++) {
            const u = b[i];
            const dx = u.x - x, dy = u.y - y;
            if (dx * dx + dy * dy <= r2) out.push(u);
          }
        }
      }
      return out;
    }
    // 中心落在矩形 [x0, x1] × [y0, y1] 内的单位
    box(x0, x1, y0, y1, out = []) {
      const c = this.cell, gw = this.gw, cells = this.cells;
      const cx0 = Math.max(0, Math.floor(x0 / c)), cx1 = Math.min(gw - 1, Math.floor(x1 / c));
      const cy0 = Math.max(0, Math.floor(y0 / c)), cy1 = Math.min(this.gh - 1, Math.floor(y1 / c));
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const b = cells[cy * gw + cx];
          for (let i = 0; i < b.length; i++) {
            const u = b[i];
            if (u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) out.push(u);
          }
        }
      }
      return out;
    }
  }

  class Engine {
    constructor(opts = {}) {
      this.rng = mulberry32(opts.seed == null ? (Math.random() * 2147483647) | 0 : opts.seed);
      this.time = 0;
      this.acc = 0;
      this.speed = 1;
      this.ended = false;
      this.winner = null;
      this.W = R.map.w;
      this.H = R.map.h;
      this.crystals = [0, 1].map((s) => ({
        isCrystal: true, side: s, x: s === 0 ? R.map.inset : R.map.w - R.map.inset, y: R.map.h / 2,
        radius: R.map.crystalRadius, hp: R.map.crystalHp, maxHp: R.map.crystalHp, cd: 0, st: {},
      }));
      this.sides = [0, 1].map(() => ({
        gold: R.economy.startGold, supplyUsed: 0, incomeMul: 1, spawned: {}, manualCd: [0, 0, 0], dragonCd: [0, 0, 0],
        pick: null,       // 最后一次选中的兵种：统一派兵时出它
      }));
      this.waveN = 0;     // 已经过了几次统一派兵
      this.dragonCrystal = true;   // 冰龙能不能打水晶（界面上的开关，关掉以后冰龙的任何伤害都打不到水晶）
      // 作弊开关：只由界面的作弊菜单修改，默认全关，不影响正常对局和无头测试
      this.cheats = {
        infiniteGold: false, noSupply: false, aiOff: false, satanNoCd: false, dragonNoCd: false,
        incomeMul: [1, 1], dmgMul: [1, 1], invuln: [false, false], godMode: [false, false],
      };
      this.units = [];
      this.bodies = [];        // 尸体（corpse=true，会被摩尔德拉起）和召唤物的消散身影（corpse=false）
      this.projectiles = [];
      this.zones = [];
      this.fx = [];
      this.events = [];
      this.pending = [];       // 本 tick 内死亡的单位，统一在 tick 末尾结算
      this.ais = [];
      this.uidSeq = 0;
      this.grid = new Grid(CELL);
      // 每个阵营一张网格，只给索敌用：找敌人时只翻对面那张，自家几千人挤在一起也不用一个个跳过
      this.sideGrid = [new Grid(CELL), new Grid(CELL)];
      this.qbuf = [];                   // 索敌查询的复用缓冲区
      this.taunters = [[], []];         // 各阵营带嘲讽的单位（冰龙）
      this.has = [{}, {}];              // 各阵营每个兵种的在场数：rex / brown / mimic / satan 这些要频繁问“有没有”的直接查这里
      this.foeSeen = [-1, -1];          // foeUnitsAlive 的缓存（按步）
      this.foeSeenV = [false, false];
      this.autoT = 0;                   // 电脑的撒旦自动放技能的检查计时
      // 每步重建网格时顺便统计：各阵营存活数、正在挥击数，以及远程单位列表（蝙蝠追击用）
      this.stat = { alive: [0, 0], swing: [0, 0] };
      this.rangedBy = [[], []];
      this.pairBuf = [];        // 分离推挤用的重叠对缓冲区（复用，避免每步分配）
      this.queues = [];         // 批量出兵的待命队列：{ side, uid, left }
    }

    // ---------- 事件与特效（给渲染和界面用） ----------
    emit(ev) {
      // 伤害数字多到画不过来时直接不记（界面同时最多显示一百来个），省下成千上万个小对象
      if (ev.t === 'num' && this.events.length > 240) return;
      this.events.push(ev);
      if (this.events.length > 600) this.events.splice(0, this.events.length - 400);
    }
    drainEvents() {
      const out = this.events;
      this.events = [];
      return out;
    }
    addFx(f) {
      // 特效同时最多 400 个：一个技能打到几千人时，多出来的只算伤害不画（全屏染色那种不受限）
      if (this.fx.length >= 400 && f.kind !== 'tint') return;
      f.t = 0;
      this.fx.push(f);
    }
    addZone(z) {
      this.zones.push(z);
    }

    // ---------- 查询 ----------
    alive(u) {
      return !u.dead && !u.bones && !u.pendingDeath && u.hp > 0;
    }
    targetable(u) {
      return this.alive(u) && !u.burrowed;
    }
    count(side, uid) {
      let n = 0;
      for (const u of this.units) if (u.side === side && u.uid === uid && this.alive(u)) n++;
      return n;
    }
    goalOf(side) {
      return this.crystals[1 - side];
    }
    // 王之威仪：200 范围内同阵营存活的雷克斯
    rexAura(u) {
      if (!this.has[u.side].rex) return false;
      return this.unitsNear(u.x, u.y, 200).some((e) => e.uid === 'rex' && e.side === u.side && this.alive(e));
    }
    // 盾墙：布朗身后 120 范围内（含布朗自己）的友军受到的穿刺伤害 -70%
    brownShield(tgt) {
      if (!this.has[tgt.side].brown) return false;
      return this.unitsNear(tgt.x, tgt.y, 200).some((b) => b.uid === 'brown' && b.side === tgt.side &&
        b.shieldWallT > 0 && this.alive(b) && C.shieldCovers(b, tgt));
    }
    // 中心距离 ≤ r 的存活单位或骨堆（任意阵营，空间网格查询）
    unitsNear(x, y, r) {
      const out = this.grid.near(x, y, r);
      let n = 0;
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (this.alive(u) || u.bones) out[n++] = u;
      }
      out.length = n;
      return out;
    }
    // 矩形范围内的存活单位或骨堆（任意阵营）
    unitsBox(x0, x1, y0, y1) {
      const out = this.grid.box(x0, x1, y0, y1);
      let n = 0;
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (this.alive(u) || u.bones) out[n++] = u;
      }
      out.length = n;
      return out;
    }
    // u 的敌方、可攻击、中心距离 ≤ r
    enemiesNear(u, r) {
      return this.unitsNear(u.x, u.y, r).filter((e) => e.side !== u.side && this.targetable(e));
    }
    // 中心距离 ≤ u.range + u.radius + t.radius + 4（+ pad）：t 可以是水晶
    inReach(u, t, pad = 0) {
      const r = u.range + u.radius + t.radius + REACH + pad;
      const dx = t.x - u.x, dy = t.y - u.y;
      return dx * dx + dy * dy <= r * r;
    }
    // 这个单位现在能不能把水晶当目标（“冰龙打水晶”关着时冰龙不行）
    hitsCrystal(u) {
      return !(u.def.crystalSwitch && !this.dragonCrystal);
    }
    // 普通索敌：攻击距离内最优的单位（远程优先给蝙蝠）；没有就看水晶。巨像只找水晶
    findTarget(u) {
      const foe = 1 - u.side;
      // 被冰龙嘲讽：只打它，够不着就什么都不打（由移动去追）
      const tn = this.tauntOf(u);
      if (tn) return this.inReach(u, tn) ? tn : null;
      if (u.ghost) {
        const c = this.crystals[foe];
        return c.hp > 0 && this.inReach(u, c) ? c : null;
      }
      let best = null, bestKey = Infinity;
      // scanFree：上次找追击目标时最近的敌人还远着，这段时间内不可能有人进攻击距离，直接跳过
      if (!(u.scanFree > this.time)) {
        const buf = this.qbuf;
        buf.length = 0;
        this.sideGrid[foe].near(u.x, u.y, u.range + u.radius + MAX_R + REACH, buf);
        const hunter = u.def.hunter;
        for (let i = 0; i < buf.length; i++) {
          const e = buf[i];
          if (!this.targetable(e)) continue;
          if (e.flying && !u.canHitAir) continue;
          if (!this.inReach(u, e)) continue;
          if (hunter && this.behind(u, e) && !this.slapReach(u, e)) continue;   // 冰龙：身后的敌人要贴上去拍
          const key = (u.uid === 'bats' && !e.ranged ? 1e6 : 0) + Math.hypot(e.x - u.x, e.y - u.y);
          if (key < bestKey) { bestKey = key; best = e; }
        }
      }
      if (best) return best;
      if (u.def.hunter && this.foeUnitsAlive(u.side)) return null;   // 冰龙：场上还有敌军就不碰水晶
      const c = this.crystals[foe];
      return c.hp > 0 && this.hitsCrystal(u) && this.inReach(u, c) ? c : null;
    }
    // 敌方还有没有活着的单位（水晶不算）：冰龙靠它判断要不要去推水晶。每步只数一次
    foeUnitsAlive(side) {
      if (this.foeSeen[side] === this.time) return this.foeSeenV[side];
      const foe = 1 - side;
      let any = false;
      for (const e of this.units) if (e.side === foe && this.targetable(e)) { any = true; break; }
      this.foeSeen[side] = this.time;
      this.foeSeenV[side] = any;
      return any;
    }
    // 冰龙的朝向规则：t 在它前进方向的身后（我方冰龙往右推，身后就是左边）
    behind(u, t) {
      return (t.x - u.x) * C.DIR(u.side) < -30;
    }
    // 拍得到：贴身（两个半径之外再留 60）
    slapReach(u, t) {
      const r = u.radius + t.radius + 60;
      const dx = t.x - u.x, dy = t.y - u.y;
      return dx * dx + dy * dy <= r * r;
    }
    // 嘲讽：敌方冰龙的嘲讽范围内，返回最近的那一头，没有就是 null。每 0.25 秒重新找一次
    tauntOf(u) {
      const list = this.taunters[1 - u.side];
      if (!list.length) return null;
      let t = u.taunt;
      if (this.time >= u.tauntNext || (t && !this.targetable(t))) {
        t = null;
        let bd = Infinity;
        for (let i = 0; i < list.length; i++) {
          const d = list[i];
          if (!this.targetable(d) || (d.flying && !u.canHitAir)) continue;
          const dx = d.x - u.x, dy = d.y - u.y, q = dx * dx + dy * dy, r = d.def.taunt;
          if (q <= r * r && q < bd) { bd = q; t = d; }
        }
        u.taunt = t;
        u.tauntNext = this.time + RETARGET;
      }
      return t;
    }
    validInRange(u, t) {
      if (t.isCrystal) return t.hp > 0 && this.hitsCrystal(u) && this.inReach(u, t);
      if (u.def.hunter && this.behind(u, t) && !this.slapReach(u, t)) return false;
      return this.targetable(t) && this.inReach(u, t) && (!t.flying || u.canHitAir);
    }
    // 追击目标：仇恨范围 max(320, range + 200) 内最近的可攻击敌人；蝙蝠是全图最近的远程敌人；巨像和不能动的没有
    chaseTarget(u) {
      this.chaseD = Infinity;      // 这次找到的目标离多远（没找到是 Infinity），updateUnit 用它算 scanFree
      if (u.def.speed <= 0) return null;
      const tn = this.tauntOf(u);
      if (tn) return tn;           // 被嘲讽：追冰龙（碎城巨人也一样）
      if (u.ghost) return null;
      const foe = 1 - u.side;
      let best = null, bd = Infinity;
      const buf = this.qbuf;
      if (u.def.hunter) {
        // 冰龙猎食：全场最近的敌军单位（不管多远，往左也追），不找水晶。先在近处的网格里找，没有再扫全场
        for (const r of [700, 2600]) {
          buf.length = 0;
          this.sideGrid[foe].near(u.x, u.y, r, buf);
          for (let i = 0; i < buf.length; i++) {
            const e = buf[i];
            if (!this.targetable(e) || (e.flying && !u.canHitAir)) continue;
            const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
            if (d < bd) { bd = d; best = e; }
          }
          if (best) return best;
        }
        for (const e of this.units) {
          if (e.side !== foe || !this.targetable(e)) continue;
          if (e.flying && !u.canHitAir) continue;
          const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
          if (d < bd) { bd = d; best = e; }
        }
        return best;
      }
      if (u.uid === 'bats') {
        for (const e of this.rangedBy[foe]) {
          if (!this.targetable(e)) continue;
          const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
          if (d < bd) { bd = d; best = e; }
        }
        return best;
      }
      const aggro = Math.max(320, u.range + 200);
      buf.length = 0;
      this.sideGrid[foe].near(u.x, u.y, aggro, buf);
      for (let i = 0; i < buf.length; i++) {
        const e = buf[i];
        if (!this.targetable(e)) continue;
        if (e.flying && !u.canHitAir) continue;
        const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      this.chaseD = best ? Math.sqrt(bd) : aggro;
      return best;
    }

    // ---------- 出兵 ----------
    // 基础收入（每秒，不含宝箱和作弊倍率）：随对局时间线性涨，不封顶
    baseIncome(side) {
      return (R.economy.incomeBase + R.economy.incomeGrowth * this.time) * this.sides[side].incomeMul;
    }
    // 人口上限：随对局时间线性涨，不封顶（作弊的“无限人口”另算）
    supplyCap() {
      return Math.floor(R.economy.supplyBase + R.economy.supplyGrowth * this.time);
    }
    // cheat：作弊派送（只有 cheatSend 的兵种能派给电脑）。电脑自己买 playerOnly 的兵种一律不行
    canSpawn(side, uid, cheat = false) {
      const d = C.BY_ID[uid];
      const S = this.sides[side];
      if (!d) return 'no';
      if (this.ended) return 'ended';
      if (d.playerOnly && side !== 0 && !(cheat && d.cheatSend)) return 'no';
      const ch = side === 0 ? this.cheats : null;
      if (S.gold < d.cost) return 'gold';
      if (S.supplyUsed + d.supply > this.supplyCap() && !(ch && ch.noSupply)) return 'supply';
      if (d.maxOnField && this.count(side, uid) >= d.maxOnField) return 'max';
      return 'ok';
    }
    spawn(side, uid, cheat = false) {
      if (this.canSpawn(side, uid, cheat) !== 'ok') return false;
      const d = C.BY_ID[uid];
      const S = this.sides[side];
      S.gold -= d.cost;
      S.supplyUsed += d.supply;
      if (!cheat) S.pick = uid;     // 自己买的才算“选中”，作弊派送的不算
      S.spawned[uid] = (S.spawned[uid] || 0) + d.count;
      const group = { supply: d.supply, members: d.count };   // 一次出几个，人口只算一次
      const fp = this.formationPoint(side);
      const back = side === 0 ? -1 : 1;                         // 成群的往自家方向排
      const cols = Math.ceil(Math.sqrt(d.count));
      for (let i = 0; i < d.count; i++) {
        const row = Math.floor(i / cols), col = i % cols;
        this.addUnit(side, d, {
          x: fp.x + back * row * GROUP_GAP_X,
          y: fp.y + (col - (cols - 1) / 2) * GROUP_GAP_Y,
          group,
        });
      }
      this.emit({ t: 'spawn', side, uid });
      return true;
    }
    // 选中一个兵种（不出兵）：点了卡片但钱不够时界面会调它，到统一派兵时就出这个
    setPick(side, uid) {
      if (C.BY_ID[uid]) this.sides[side].pick = uid;
    }
    // 离下一次统一派兵还有几秒
    waveLeft() {
      const W = R.economy.waveEvery;
      return W - (this.time % W);
    }
    // 统一派兵：把这一方的金币一直换成最后选中的兵种，换到买不起（或者人口满了、到数量上限）为止。返回出了几组
    dispatch(side) {
      const uid = this.sides[side].pick;
      if (!uid) return 0;
      let n = 0;
      while (n < R.economy.waveMax && this.spawn(side, uid)) n++;
      if (n) this.emit({ t: 'wave', side, uid, n });
      return n;
    }
    // 批量出兵（作弊）：不扣金币、人口，一次出 n 个单独的单位（不是“组”）。
    // 每方批量兵合计（含已经在场的，所有兵种加起来）不超过 BATCH_MAX：直接上场的个数 = 上限减去场上已有的，
    // 超出的进待命队列（见 enterQueues），场上少了再陆续进场，不会一次算几十万个单位卡死。
    // 纵向铺满出兵带，每列排满一遍，人越多列越多，横向往场中挤，但不超过 MASS_DEPTH。
    // 批量单位不占人口、不计入 spawned，不影响电脑的出兵比例。撒旦这类一次只能有一个的不批量。返回总个数
    massSpawn(side, uid, n) {
      const d = C.BY_ID[uid];
      if (!d || this.ended || !(n > 0)) return 0;
      if (d.playerOnly && side !== 0 && !d.cheatSend) return 0;
      if (d.maxOnField) return 0;
      n = Math.min(n, BATCH_ONCE);
      const now = Math.min(n, Math.max(0, BATCH_MAX - this.batchOn(side)));
      const M = R.map;
      const band = M.spawnSpread;
      const y0 = M.h / 2 - band / 2;
      const rows = Math.max(1, Math.min(now, Math.floor(band / MASS_GAP)));
      const cols = Math.ceil(now / rows);
      const gx = Math.min(MASS_GAP, MASS_DEPTH / cols);
      const x0 = this.batchFront(side);
      const dir = side === 0 ? 1 : -1;
      for (let i = 0; i < now; i++) {
        const row = i % rows, col = Math.floor(i / rows);
        this.addUnit(side, d, {
          x: x0 + dir * col * gx + (this.rng() - 0.5) * 6,
          y: y0 + (row + 0.5) * (band / rows) + (this.rng() - 0.5) * 6,
          batch: true,
        });
      }
      if (n > now) this.queues.push({ side, uid, left: n - now });
      return n;
    }
    // 批量出兵的起点：自家水晶前沿（和正常出兵的纵深起点一样）
    batchFront(side) {
      const M = R.map;
      return side === 0 ? M.inset + M.crystalRadius + 60 : M.w - (M.inset + M.crystalRadius + 60);
    }
    // 待命队列：每步把队列里的单位放进出兵带（随机落点，一批批涌上来）。每方场上的批量兵合计不超过 BATCH_MAX，
    // 每方每步最多进场 ENTER_PER_STEP 个。队列按先后顺序进场
    enterQueues() {
      const room = [BATCH_MAX - this.batchOn(0), BATCH_MAX - this.batchOn(1)];
      const budget = [ENTER_PER_STEP, ENTER_PER_STEP];
      for (const q of this.queues) {
        const k = Math.min(q.left, Math.max(0, room[q.side]), budget[q.side]);
        if (k <= 0) continue;
        const d = C.BY_ID[q.uid];
        const M = R.map;
        const band = M.spawnSpread;
        const y0 = M.h / 2 - band / 2;
        const x0 = this.batchFront(q.side);
        const dir = q.side === 0 ? 1 : -1;
        for (let i = 0; i < k; i++) {
          this.addUnit(q.side, d, {
            x: x0 + dir * this.rng() * 600,
            y: y0 + this.rng() * band,
            batch: true,
          });
        }
        q.left -= k;
        room[q.side] -= k;
        budget[q.side] -= k;
      }
      this.queues = this.queues.filter((q) => q.left > 0);
    }
    // 一方正在场上的批量兵个数（所有兵种合计）
    batchOn(side) {
      let n = 0;
      for (const u of this.units) if (u.batch && u.side === side && this.alive(u)) n++;
      return n;
    }
    // 待命队列里还有多少个没上场（一方的合计）
    queued(side) {
      let n = 0;
      for (const q of this.queues) if (q.side === side) n += q.left;
      return n;
    }
    // 出兵点：自家水晶内侧 spawnDepth 的纵深，y 以 h/2 为中心铺开 spawnSpread（整条出兵带）
    formationPoint(side) {
      const M = R.map;
      const along = M.inset + M.crystalRadius + 60 + this.rng() * M.spawnDepth;
      return {
        x: side === 0 ? along : M.w - along,
        y: M.h / 2 + (this.rng() - 0.5) * M.spawnSpread,
      };
    }

    // 创建单位。summon：召唤物（不占人口、不留尸体）；life：到时间自动消散；不传 x/y 就用出兵点
    addUnit(side, def, o = {}) {
      const radius = unitRadius(def);
      let x = o.x, y = o.y;
      if (x == null || y == null) {
        const fp = this.formationPoint(side);
        if (x == null) x = fp.x;
        if (y == null) y = fp.y;
      }
      const u = {
        id: ++this.uidSeq,
        side,
        dir: C.DIR(side),
        def,
        uid: def.id,
        name: def.name,
        sheet: def.sheet,
        small: !!def.small,
        tier: def.tier,
        x: 0,
        y: 0,
        radius,
        hp: def.hp,
        maxHp: def.hp,
        aspd: def.aspd,
        range: def.range,
        atk: def.atk,
        dmgType: def.dmg,
        flying: def.tags.indexOf('flying') >= 0,
        ranged: def.range >= R.rangedThreshold,
        canHitAir: def.range >= R.rangedThreshold && !def.groundOnly,
        giant: def.tags.indexOf('giant') >= 0,
        ghost: def.id === 'titan',
        st: {},
        imm: { stun: 0, frozen: 0 },
        invuln: 0,
        hitCount: 0,
        nextHitMul: 0,
        shieldWallT: 0,
        smiteT: 0,
        cleanseT: 0,
        skillCd: def.skill ? def.skill.cd * 0.6 : 0,  // 开局技能冷却进度 40%
        swing: null,
        cast: null,
        charge: null,
        burrowed: false,
        moving: false,
        clock: 0,
        hitT: 99,
        dead: false,
        pendingDeath: false,
        bones: false,
        bonesT: 0,
        reformUsed: false,
        reviveUsed: false,
        auraT: 0,
        summon: !!o.summon,
        batch: !!o.batch,           // 批量出兵（作弊）的单位：计入每方的批量上限，见 batchOn
        life: o.life == null ? null : o.life,
        group: o.group || null,
        chase: null,
        retargetT: this.rng() * RETARGET,
        solid: false,               // 这一步参不参与分离推挤（separate 里每步重算）
        scanFree: 0,                // 这个时刻之前不用扫敌人（见 findTarget）
        taunt: null,                // 正在嘲讽它的冰龙
        tauntNext: 0,
      };
      C.place(u, x, y);
      this.units.push(u);
      this.grid.insert(u);
      this.sideGrid[side].insert(u);
      if (u.ranged) this.rangedBy[side].push(u);
      if (def.taunt) this.taunters[side].push(u);
      this.has[side][u.uid] = (this.has[side][u.uid] || 0) + 1;
      this.foeSeen[1 - side] = -1;
      return u;
    }

    markDead(u) {
      if (u.pendingDeath || u.dead) return;
      u.pendingDeath = true;
      this.pending.push(u);
    }
    removeUnit(u) {
      u.dead = true;
      const i = this.units.indexOf(u);
      if (i >= 0) this.units.splice(i, 1);
      if (u.group) {
        u.group.members -= 1;
        if (u.group.members <= 0) this.sides[u.side].supplyUsed -= u.group.supply;
      }
    }
    removeBody(b) {
      const i = this.bodies.indexOf(b);
      if (i >= 0) this.bodies.splice(i, 1);
    }

    // ---------- 远程攻击：发射投射物，落地时结算 ----------
    // homing：true 追着目标飞；false 落在发射时的位置（炸弹）。返回投射物对象
    fireAttack(src, tgt, sprite, onLand, homing = true) {
      const dist = Math.hypot(tgt.x - src.x, tgt.y - src.y);
      const dur = Math.max(0.12, Math.min(0.7, dist / 900));
      const p = {
        sprite, side: src.side, el: src.def ? src.def.element : null,
        x0: src.x, y0: src.y, x1: tgt.x, y1: tgt.y, h0: src.h0 == null ? 30 : src.h0,
        tgt, homing, t: 0, dur, done: false, onLand,
      };
      this.projectiles.push(p);
      return p;
    }

    // 一次攻击在 release 帧出手：目标失效就重新找，找不到就空挥
    release(u, s) {
      let t = s.target;
      if (!this.validInRange(u, t)) t = this.findTarget(u);
      if (!t) return;
      if (u.def.breath) {
        // 冰龙：身后的敌人贴上去拍一爪子，其余的吐息直接落在目标位置，都不走投射物
        if (s.slap && !t.isCrystal && this.slapReach(u, t)) C.slapHit(this, u, t);
        else C.breathHit(this, u, t);
        return;
      }
      if (t.isCrystal) {
        // 水晶和单位一样吃攻击方的 onHit（亡灵君主的易伤等，applyStatus 只让水晶收下易伤）
        const hit = () => {
          if (t.hp <= 0) return;
          if (C.damage(this, u, t, u.atk, u.dmgType, { attack: true }) > 0) {
            for (const h of u.def.onHit) C.applyStatus(this, t, h.status, { stacks: h.stacks });
          }
        };
        if (u.ranged) this.fireAttack(u, t, u.def.projectile || 'orb', hit);
        else hit();
        return;
      }
      if (u.ranged) {
        const splash = u.def.splash || 0;
        const p = this.fireAttack(u, t, u.def.projectile || 'orb', () => {
          // 落点：追踪弹是目标最后的位置，炸弹是发射时的位置
          const ix = p.x1, iy = p.y1;
          if (this.targetable(t) && (!splash || Math.hypot(t.x - ix, t.y - iy) <= splash)) {
            C.hitAttack(this, u, t, splash);
          } else if (splash) {
            C.splashAt(this, u, ix, iy, splash, null, u.dmgType, u.atk, u.def.element);
          }
        }, !splash);
      } else {
        C.hitAttack(this, u, t, u.def.splash || 0);
      }
    }

    startSwing(u, t) {
      if (u.def.hunter && !t.isCrystal && this.behind(u, t)) {
        // 冰龙拍击：0.7 秒一下，第 0.25 秒落爪，伤害和吐息一样
        u.swing = { t: 0, period: 0.7, releaseT: 0.25, target: t, hit: false, slap: true };
        return;
      }
      const a = animOf(u.sheet, 'attack');
      const period = 1 / (u.aspd * C.slowMul(u));
      const rel = a ? a.release : 0;
      const n = a ? a.n : 1;
      u.swing = { t: 0, period, releaseT: (rel / n) * period, target: t, hit: false };
    }
    swingStep(u, dt) {
      const s = u.swing;
      s.t += dt;
      if (!s.hit && s.t >= s.releaseT) {
        s.hit = true;
        this.release(u, s);
      }
      if (s.t >= s.period) u.swing = null;
    }

    // 移动（第五节）：有追击目标且够不着就朝它走；否则朝敌方水晶走，够得着就停
    move(u, dt) {
      u.burrowed = false;
      u.moving = false;
      if (u.def.speed <= 0 || C.has(u, 'root')) return;
      let tgt = null;
      const c = u.chase;
      let pounce = false;
      if (c && this.targetable(c)) {
        pounce = !!u.def.hunter && this.behind(u, c);
        if (pounce ? this.slapReach(u, c) : this.inReach(u, c)) return;     // 已经够得着，由挥击处理
        tgt = c;
      } else if (u.def.hunter && this.foeUnitsAlive(u.side)) {
        // 冰龙：没有追击目标时先往右（朝敌方那边）走，不扑水晶
        tgt = { x: u.x + (u.side === 0 ? 600 : -600), y: u.y };
      } else {
        const g = this.goalOf(u.side);
        if (g.hp <= 0 || this.inReach(u, g)) return;
        tgt = g;
      }
      let v = u.def.speed * C.slowMul(u);
      if (pounce) v *= 4;           // 冰龙回头扑身后的敌人：4 倍速冲过去
      if (u.uid === 'worm') {       // 移动时钻在地下：不能被攻击，移速 ×1.5
        u.burrowed = true;
        v *= 1.5;
      }
      const dx = tgt.x - u.x, dy = tgt.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-6) return;
      const s = Math.min(d, v * dt);
      C.place(u, u.x + (dx / d) * s, u.y + (dy / d) * s);
      u.moving = true;
    }

    // 单个单位一个 tick 的行为
    updateUnit(u, dt) {
      if (u.dead || u.pendingDeath || u.bones) return;
      u.burrowed = false;
      u.moving = false;
      if (u.charge) { C.chargeStep(this, u, dt); return; }
      if (u.cast) { C.castStep(this, u, dt); return; }
      if (u.uid === 'lein') {
        u.cleanseT -= dt;
        if (u.cleanseT <= 0) {
          u.cleanseT = 2;   // 净化光环：清掉身边 120 范围内友军的易伤和衰弱
          for (const f of this.unitsNear(u.x, u.y, 120)) {
            if (f.side === u.side && this.alive(f)) {
              delete f.st.vulnerable;
              delete f.st.weaken;
            }
          }
        }
      }
      if (C.has(u, 'stun') || C.has(u, 'frozen')) return;
      if (u.def.speed > 0) {
        u.retargetT -= dt;
        if (u.retargetT <= 0) {
          u.retargetT = RETARGET;
          u.chase = this.chaseTarget(u);
          // 最近的敌人离攻击距离还差 150 以上：到下次重新找之前不会有人进得来，这段时间 findTarget 不用扫
          const far = this.chaseD - (u.range + u.radius + MAX_R + REACH);
          u.scanFree = far > 150 && far < Infinity ? this.time + RETARGET + dt : 0;
        }
      }
      if (u.def.hunter) {
        // 冰龙扭头：正在打谁就朝谁，没在打就朝追的那个，都没有就朝前
        const f = u.swing && u.swing.target ? u.swing.target : u.chase;
        if (f && (f.isCrystal || this.targetable(f))) {
          const dx = f.x - u.x;
          if (Math.abs(dx) > 24) u.dir = dx > 0 ? 1 : -1;
        } else if (!u.swing) {
          u.dir = C.DIR(u.side);
        }
      }
      if (C.trySkill(this, u) && (u.cast || u.charge)) return;
      if (!u.swing) {
        const t = this.findTarget(u);
        if (t) this.startSwing(u, t);
      }
      if (u.swing) {
        this.swingStep(u, dt);
        return;
      }
      this.move(u, dt);
    }

    // 每步开始（和移动、推挤之后）重建空间网格，并统计存活数、挥击数、远程列表
    // scan：每步开头那一次还要重建两张阵营网格、嘲讽名单和各兵种在场数（索敌用，移动和推挤之后不用再建）
    buildGrid(scan = true) {
      const g = this.grid;
      g.clear();
      const st = this.stat;
      st.alive[0] = st.alive[1] = 0;
      st.swing[0] = st.swing[1] = 0;
      this.rangedBy[0].length = 0;
      this.rangedBy[1].length = 0;
      const sg = this.sideGrid, tn = this.taunters;
      if (scan) {
        sg[0].clear(); sg[1].clear();
        tn[0].length = 0; tn[1].length = 0;
        this.has[0] = {}; this.has[1] = {};
      }
      const units = this.units;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        g.insert(u);
        if (!this.alive(u)) continue;
        st.alive[u.side]++;
        if (u.swing) st.swing[u.side]++;
        if (u.ranged) this.rangedBy[u.side].push(u);
        if (scan) {
          sg[u.side].insert(u);
          if (u.def.taunt) tn[u.side].push(u);
          const h = this.has[u.side];
          h[u.uid] = (h[u.uid] || 0) + 1;
        }
      }
    }

    // 分离推挤（第 4.4 节）：地面单位两两重叠各推开一半；所有单位限制在地图内；
    // 地面单位最后再推出水晶圆外（放在单位推挤之后，保证推挤不会把单位推进水晶）
    separate() {
      const g = this.grid;
      const units = this.units;
      // 先给每个单位记上“参不参与推挤”，后面配对时不用反复判断
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        u.solid = !u.flying && !u.ghost && !u.burrowed && !u.bones && !u.dead && !u.pendingDeath && u.hp > 0;
      }
      // 先在推挤前的网格上找出所有重叠的对，再统一推，避免中途位置变化漏掉。
      // 格子边长 96 大于两个单位半径之和的最大值（80，CELL 不能小于它），重叠的两个单位一定在同格或相邻格里，
      // 所以按格子遍历：同格内两两配对，邻格只看 4 个方向，每对只访问一次，不用对每个单位做查询
      const pairs = this.pairBuf;
      let pn = 0;
      for (let i = 0; i < g.used.length; i++) {
        const cell = g.used[i], cx = g.ucx[i], cy = g.ucy[i];
        const n = cell.length;
        for (let p = 0; p < n; p++) {
          const a = cell[p];
          if (!a.solid) continue;
          const ax = a.x, ay = a.y, ar = a.radius;
          for (let q = p + 1; q < n; q++) {
            const b = cell[q];
            if (!b.solid) continue;
            const m = ar + b.radius, dx = b.x - ax, dy = b.y - ay;
            if (dx * dx + dy * dy < m * m) { pairs[pn++] = a; pairs[pn++] = b; }
          }
          for (let o = 0; o < 8; o += 2) {
            const nb = g.at(cx + FWD[o], cy + FWD[o + 1]);
            if (!nb) continue;
            for (let q = 0; q < nb.length; q++) {
              const b = nb[q];
              if (!b.solid) continue;
              const m = ar + b.radius, dx = b.x - ax, dy = b.y - ay;
              if (dx * dx + dy * dy < m * m) { pairs[pn++] = a; pairs[pn++] = b; }
            }
          }
        }
      }
      for (let i = 0; i < pn; i += 2) {
        const a = pairs[i], b = pairs[i + 1];
        const m = a.radius + b.radius;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= m) continue;
        let nx, ny;
        if (d < 1e-6) {
          const ang = this.rng() * Math.PI * 2;
          nx = Math.cos(ang);
          ny = Math.sin(ang);
        } else {
          nx = dx / d;
          ny = dy / d;
        }
        const h = (m - d) / 2;
        a.x -= nx * h; a.y -= ny * h;
        b.x += nx * h; b.y += ny * h;
      }
      pairs.length = 0;      // 不留着单位的引用
      // 水晶圆：地面单位推到圆边上。只查水晶周围那几格
      for (const c of this.crystals) {
        if (c.hp <= 0) continue;
        const buf = this.qbuf;
        buf.length = 0;
        g.near(c.x, c.y, c.radius + MAX_R + 60, buf);
        for (let i = 0; i < buf.length; i++) {
          const u = buf[i];
          if (!u.solid) continue;
          const m = c.radius + u.radius;
          const dx = u.x - c.x, dy = u.y - c.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= m) continue;
          let nx, ny;
          if (d < 1e-6) {
            const ang = this.rng() * Math.PI * 2;
            nx = Math.cos(ang);
            ny = Math.sin(ang);
          } else {
            nx = dx / d;
            ny = dy / d;
          }
          u.x = c.x + nx * m;
          u.y = c.y + ny * m;
        }
      }
      // 所有单位钳在地图内
      const W = this.W, H = this.H;
      for (let i = 0; i < units.length; i++) {
        const u = units[i], r = u.radius;
        if (u.x < r) u.x = r; else if (u.x > W - r) u.x = W - r;
        if (u.y < r) u.y = r; else if (u.y > H - r) u.y = H - r;
      }
    }

    // ---------- 主循环 ----------
    // 真实时间 → 固定步长：每帧最多 12 步，并且不超过 BUDGET_MS 毫秒。单位很多时一帧算不完，
    // 就停在这里、欠的时间留到下一帧（游戏变慢，界面不会被卡死）；欠得太多的部分直接丢掉，不快进
    update(realDt) {
      if (this.ended) return;
      this.acc += Math.min(0.1, realDt) * this.speed;
      const t0 = Date.now();
      let n = 0;
      while (this.acc >= DT && n < 12 && !this.ended) {
        this.step(DT);
        this.acc -= DT;
        n++;
        if (Date.now() - t0 > BUDGET_MS) break;
      }
      if (this.acc > ACC_MAX) this.acc = ACC_MAX;
    }

    step(dt) {
      if (this.ended) return;
      this.time += dt;
      this.buildGrid();
      if (!this.cheats.aiOff) for (const ai of this.ais) ai.tick(this, dt);

      // 经济：基础收入 + 贪婪宝箱每个每秒 3 金币
      for (let s = 0; s < 2; s++) {
        const S = this.sides[s];
        const mimics = this.has[s].mimic || 0;
        S.gold += (this.baseIncome(s) + 3 * mimics) * this.cheats.incomeMul[s] * dt;
        if (s === 0 && this.cheats.infiniteGold) S.gold = Math.max(S.gold, 999999);
        // “撒旦技能无冷却”只给我方：电脑的撒旦是自动放技能的，没有冷却就停不下来了
        for (let i = 0; i < 3; i++) S.manualCd[i] = s === 0 && this.cheats.satanNoCd ? 0 : Math.max(0, S.manualCd[i] - dt);
        for (let i = 0; i < 3; i++) S.dragonCd[i] = this.cheats.dragonNoCd ? 0 : Math.max(0, S.dragonCd[i] - dt);
      }

      // 统一派兵：每过 waveEvery 秒双方各来一次（“电脑停止出兵”开着时电脑不派）
      const wave = Math.floor(this.time / R.economy.waveEvery);
      if (wave > this.waveN) {
        this.waveN = wave;
        this.dispatch(0);
        if (!this.cheats.aiOff) this.dispatch(1);
      }

      if (this.queues.length) this.enterQueues();

      // 电脑的撒旦自己放技能（每 0.5 秒看一次条件）
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = 0.5;
        if (this.has[1].satan) C.autoSatan(this, 1);
      }

      for (const u of this.units.slice()) {
        if (u.dead) continue;
        C.tickStatuses(this, u, dt);
        if (u.bones) {
          u.bonesT -= dt;
          if (u.bonesT <= 0) C.reform(this, u);
          continue;
        }
        u.clock += dt;
        if (u.skillCd > 0) u.skillCd = Math.max(0, u.skillCd - dt);
        u.shieldWallT = Math.max(0, u.shieldWallT - dt);
        if (u.uid === 'satan' && this.alive(u)) C.satanAura(this, u, dt);
        if (u.uid === 'frostwing' && this.alive(u)) C.frostAura(this, u, dt);
        if (u.life != null) {
          u.life -= dt;
          // 召唤物到时间消散：hp 归零再登记死亡，结算时不会被当成“没死”而留在场上
          if (u.life <= 0) { u.hp = 0; this.markDead(u); }
        }
      }

      for (const u of this.units.slice()) this.updateUnit(u, dt);

      this.buildGrid(false);      // 移动之后重建，给分离推挤用
      this.separate();
      this.buildGrid(false);      // 推挤之后重建，给后面的落地、区域、炮塔用

      for (const p of this.projectiles) {
        if (p.done) continue;
        if (p.homing && p.tgt) { p.x1 = p.tgt.x; p.y1 = p.tgt.y; }
        p.t += dt;
        if (p.t >= p.dur) {
          p.done = true;
          p.onLand();
        }
      }
      this.projectiles = this.projectiles.filter((p) => !p.done);

      for (const z of this.zones) {
        z.t -= dt;
        C.zoneTick(this, z, dt);
      }
      this.zones = this.zones.filter((z) => z.t > 0);

      this.fx = this.fx.filter((f) => { f.t += dt; return f.t < f.dur; });

      for (const b of this.bodies) b.age += dt;
      this.bodies = this.bodies.filter((b) => b.age < b.life);

      // 水晶只挂易伤，这里走计时（单位的状态在 tickStatuses 里走）
      for (const c of this.crystals) {
        for (const id of Object.keys(c.st)) {
          c.st[id].t -= dt;
          if (c.st[id].t <= 0) delete c.st[id];
        }
      }

      // 水晶炮塔：攻击距离 = 炮塔射程 + 水晶半径（从水晶圆心算），打最近的敌方可攻击单位（能打飞行）
      for (let s = 0; s < 2; s++) {
        const c = this.crystals[s];
        if (c.hp <= 0) continue;
        c.cd = Math.max(0, c.cd - dt);
        if (c.cd > 0) continue;
        const foe = 1 - s;
        let t = null, bd = Infinity;
        for (const e of this.unitsNear(c.x, c.y, R.crystal.range + c.radius)) {
          if (e.side !== foe || !this.targetable(e)) continue;
          // 炮塔也吃嘲讽：射程里有冰龙就先打冰龙
          const d = (e.x - c.x) ** 2 + (e.y - c.y) ** 2 - (e.def.taunt ? 1e12 : 0);
          if (d < bd) { bd = d; t = e; }
        }
        if (t) {
          c.cd = 1 / R.crystal.aspd;
          this.fireAttack({ side: s, x: c.x, y: c.y, h0: 80 }, t, 'arrow', () => {
            // 炮塔没有攻击者，伤害倍率按所属阵营取（作弊的伤害倍率对炮塔也生效）
            if (this.targetable(t)) C.damage(this, null, t, R.crystal.atk, R.crystal.dmg, { attack: true, side: s });
          });
        }
      }

      this.settleDeaths();
      this.checkWin();
    }

    // 结算死亡：骨堆 / 尸体 / 召唤物消散 / 死亡特性
    settleDeaths() {
      const list = this.pending;
      this.pending = [];
      for (const u of list) {
        u.pendingDeath = false;
        if (u.dead || u.hp > 0) continue;
        if (C.tryBones(this, u)) continue;
        this.removeUnit(u);
        const d = deathDur(u.sheet);
        this.bodies.push({
          corpse: !u.summon, side: u.side, uid: u.uid, sheet: u.sheet, small: u.small, scale: u.def.scale || 1,
          x: u.x, y: u.y, age: 0, deathDur: d,
          life: u.summon ? d + 0.4 : R.economy.corpseSeconds,
        });
        C.onDeath(this, u);
        this.emit({ t: 'death', side: u.side, uid: u.uid, x: u.x, y: u.y });
      }
      // 尸体最多留 1500 具，超了把最早的清掉
      if (this.bodies.length > 1500) this.bodies.splice(0, this.bodies.length - 1200);
    }

    // 作弊菜单：设置水晶当前血量和上限（上限跟着调大，血条不会溢出）
    setCrystal(side, hp, maxHp) {
      const c = this.crystals[side];
      if (maxHp != null) c.maxHp = Math.max(1, maxHp);
      c.hp = Math.max(1, Math.min(c.maxHp, hp == null ? c.maxHp : hp));
    }
    // 作弊菜单：清空一方场上所有单位（直接移除，不留尸体、不触发死亡特性）
    wipe(side) {
      for (const u of this.units.slice()) if (u.side === side) this.removeUnit(u);
      this.bodies = this.bodies.filter((b) => b.side !== side);
      this.queues = this.queues.filter((q) => q.side !== side);
    }

    // 胜负：一方水晶归零就结束，另一方获胜；双方水晶在同一步归零判平局（winner = 'draw'）
    checkWin() {
      const dead = [0, 1].filter((s) => this.crystals[s].hp <= 0);
      if (!dead.length) return;
      this.ended = true;
      this.winner = dead.length === 2 ? 'draw' : 1 - dead[0];
      for (const s of dead) this.crystals[s].hp = 0;
      this.emit({ t: 'end', winner: this.winner });
    }
  }

  Engine.DT = DT;
  Engine.Grid = Grid;
  Engine.BATCH_MAX = BATCH_MAX;
  Engine.BATCH_ONCE = BATCH_ONCE;
  window.Engine = Engine;
})();
