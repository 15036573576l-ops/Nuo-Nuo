# 平原战场：接口契约

这份文件是改造的唯一依据。引擎、战斗、AI、画面、界面、测试几路并行改写，名字和字段以这里为准。兵种数值（`units.js`）不动。

## 一、目标

- 战场是二维平面：每个单位有 `x`（左右）和 `y`（上下）。兵线概念取消，兵会朝敌方水晶走，遇到敌人自己打。
- 地图很大：`8000 × 3200` 像素，平原（草地、土路、树丛、石头是背景装饰，不挡路）。
- 支持庞大军团：单方几百个、双方上千个单位同屏。逻辑要用空间网格，画面要有视野裁剪和缩远时的简化显示。
- 人口、金币、冷却、克制、状态、元素反应、技能的规则保持不变，只把“线”换成“面”。

## 二、常量（`src/rules.js`）

删掉 `lane`，换成 `map`；`economy` 数值调整为大规模对局：

```js
map: { w: 8000, h: 3200, inset: 420, crystalRadius: 70, crystalHp: 6000, spawnDepth: 240, spawnSpread: 900 },
economy: { startGold: 300, income: 25, supplyCap: 120, corpseSeconds: 6 },
```

- `map.inset`：水晶圆心离左右边界的距离。玩家水晶在 `(inset, h/2)`，电脑水晶在 `(w - inset, h/2)`。
- `map.spawnDepth`：出兵点离自家水晶边缘向内的纵深范围（出兵点在 `x ∈ [inset + crystalRadius + 60, + spawnDepth]`）。
- `map.spawnSpread`：出兵点在 y 方向的展开宽度，以 `h/2` 为中心。
- `crystal`（炮塔）保持原样：`atk 25, aspd 1, pierce, range 220, canHitAir`。炮塔射程是从水晶圆心算起加上 `crystalRadius`。
- `rangedThreshold` 保持 100。`damageMatrix`、`statuses`、`reactions` 不变。

## 三、坐标、投影、时间

- 世界坐标：`x ∈ [0, map.w]`，`y ∈ [0, map.h]`，单位是像素。
- 逻辑步长：`Engine.DT = 1/30`。一帧里 `update(realDt)` 累积时间，最多 12 步。
- 阵营：`side 0` 玩家，朝右（`dir = +1`）；`side 1` 电脑，朝左（`dir = -1`）。
- 画面投影（斜视 3/4 视角，地面用 `K = 0.6` 压扁）：
  - `sx = (x - cam.x) * zoom + viewW / 2`
  - `sy = (y - cam.y) * zoom * K + viewH / 2`
  - 精灵按脚底锚点画在 `(sx, sy)`，不做透视缩放。地面圆（范围、火雨、冲击环）画成椭圆 `rx = r*zoom`，`ry = r*zoom*K`。
- 小地图是俯视的真实布局：`x / w`、`y / h`。

## 四、引擎（`src/game/engine.js`）

### 4.1 对外的对象和方法

```
class Engine
  constructor({ seed })
  static DT, static Grid
  update(realDt)                      // 真实时间 → 固定步长，尊重 this.speed
  step(dt)                            // 单步，测试用
  rng() → number in [0,1)
  W, H                                // 地图宽高（来自 rules.map）
  time, speed, ended, winner, ais[]
  sides[2] = { gold, supplyUsed, cdLeft: {uid: 秒}, incomeMul, spawned: {uid: 数量} }
  crystals[2] = { isCrystal: true, side, x, y, radius, hp, maxHp, cd }
  units[]                             // 活着的单位（含骨堆）
  bodies[]                            // 尸体和召唤物的消散身影
  projectiles[], zones[], fx[], events[]

  alive(u)                            // 未死亡、非骨堆、hp>0、未待结算
  targetable(u)                       // alive(u) && !u.burrowed
  count(side, uid) → 活着的数量
  goalOf(side) → 敌方水晶
  rexAura(u) → bool                   // 200 px 内同阵营存活雷克斯
  brownShield(tgt) → bool             // 布朗身后 120 px（含布朗），同阵营，盾墙开启
  unitsNear(x, y, r) → unit[]         // 任意阵营、alive 或骨堆的单位（空间网格查询）
  enemiesNear(u, r) → unit[]          // u 的敌方、targetable、中心距离 ≤ r
  inReach(u, t) → bool                // 中心距离 ≤ u.range + u.radius + t.radius + 4（t 可以是水晶）
  findTarget(u) → unit | crystal | null   // 攻击距离内的最优目标（见第六节）
  chaseTarget(u) → unit | null        // 追击目标：仇恨范围内最近的敌人（蝙蝠：全图最近的远程）
  canSpawn(side, uid) → 'ok' | 'gold' | 'supply' | 'cooldown' | 'max' | 'ended' | 'no'
  spawn(side, uid) → bool             // 扣金币、人口、冷却，一次 count 只，人口只算一次
  formationPoint(side) → {x, y}       // 出兵点，组内单位按小网格错开
  addUnit(side, def, {x, y, summon, life, group}) → unit   // 底层创建，不扣费
  fireAttack(src, tgt, spriteKey, onLand, homing = true)   // 发射投射物
  addFx(f) / addZone(z) / emit(ev) / drainEvents()
  markDead(u) / removeUnit(u) / removeBody(b)
```

`Engine.Grid`：空间哈希网格，`new Grid(cell = 96)`，方法 `clear()`、`insert(u)`、`near(x, y, r) → unit[]`（返回所有格子里中心距离 ≤ r 的单位，不过滤阵营）。每步在开始时重建一次；分离推挤阶段用移动后的位置再重建一次。

### 4.2 单位对象字段

```
id, side, dir (±1), def, uid, name, sheet, small, tier（来自 def）
x, y                 世界坐标
radius               碰撞半径（见 4.4）
hp, maxHp, aspd, range, atk, dmgType, flying, ranged, canHitAir, giant, ghost (titan)
st, imm, invuln, hitCount, nextHitMul, shieldWallT, smiteT, cleanseT
skillCd, swing, cast, charge, burrowed, moving, clock, hitT
dead, pendingDeath, bones, bonesT, reformUsed, summon, life, group
chase                 当前追击目标（可空）
retargetT             下次重新找追击目标的剩余秒数
```

`radius`：`max(12, min(40, sheet.bodyW * 0.45))`；`giant` 单位至少 30。骨堆、冲锋、召唤物同样算。

### 4.3 事件

`emit({ t, x, y, ... })`，所有事件都带世界坐标 `x, y`（替代旧的 `uy`）。类型不变：

- `{t:'num', x, y, v, color}` 伤害数字
- `{t:'react', x, y, text, color}` 反应名、打断、闪避、不屈等
- `{t:'skill', x, y, side, uid, name}` 技能释放
- `{t:'spawn', side, uid}`、`{t:'death', side, uid, x, y}`、`{t:'end', winner}`

### 4.4 碰撞（分离推挤）

- 参与推挤：地面单位，不是 `flying`、不是 `ghost`（巨像）、不是 `burrowed`、不是骨堆。
- 两个单位中心距离 `d < a.radius + b.radius` 就互相推开，各移动重叠量的一半；`d ≈ 0` 时随机方向。阵营相同或不同都推。
- 水晶是静态圆（半径 `crystalRadius`），地面单位被推出水晶圆外。
- 所有单位（包括飞行和巨像）都被限制在地图范围内：`x ∈ [r, w - r]`，`y ∈ [r, h - r]`。
- 推挤在移动之后、死亡结算之前做一次。

### 4.5 一步的顺序

1. AI 的 `tick`（可能调用 `spawn`）
2. 经济：金币 `+ (income × incomeMul + 3 × 贪婪宝箱数) × dt`；出兵冷却递减
3. 每个单位 `tickStatuses`；骨堆计时；技能冷却；盾墙计时；召唤物寿命
4. 重建空间网格
5. 每个单位 `updateUnit`：冲锋 → 蓄力 → 控制（眩晕/冻结）→ 技能 → 攻击周期（找目标、挥击）→ 移动意图（直接改 `x, y`）
6. 分离推挤（4.4），然后重建网格
7. 投射物落地
8. 区域（火雨）、特效、尸体计时
9. 水晶炮塔
10. `settleDeaths`（骨堆、尸体、召唤物消散、死亡特性）
11. `checkWin`

## 五、移动

- 目标点：
  - 有追击目标（`chase`）且不在攻击距离内 → 朝追击目标走
  - 否则朝敌方水晶走（巨像永远朝水晶走）
  - 蝙蝠的追击目标是全图最近的远程敌人，没有就朝水晶飞
- 速度 `def.speed × slowMul(u)`，蠕虫在移动时 `× 1.5` 并且 `burrowed = true`。`root` 不能移动。`speed = 0` 的（贪婪宝箱）不动。
- 停下条件：攻击距离内有可攻击目标（`findTarget` 有结果）时挥击，挥击期间不移动；朝水晶走的单位到达 `inReach(u, 水晶)` 时停。
- 仇恨：`chase` 每 0.25 秒（`retargetT`）重新计算一次，范围 `max(320, u.range + 200)`，取最近的可攻击敌人。
- 没有“挡路”判定，推挤代替了它。

## 六、索敌和攻击

- `findTarget(u)`：攻击距离内最优目标。
  - 普通：距离最近的敌方可攻击单位；飞行单位只被 `canHitAir` 的打。
  - 蝙蝠：射程内远程敌人优先，然后才是近战。
  - 巨像（titan）：只找水晶。
  - 没有单位就看水晶（`inReach`）。
- 攻击周期 `period = 1 / (aspd × slowMul)`；`releaseT = release / n × period`；`swing = { t, period, releaseT, target, hit }`。
- 出手（release）时：目标在攻击距离内就结算；否则 `findTarget` 重新找，找不到就空挥。
- 远程（`range ≥ 100`）用投射物：`fireAttack(u, target, def.projectile || 'orb', onLand, homing)`。近战直接结算。溅射（`def.splash`）在目标位置或落点圆形范围内结算。

## 七、投射物

```
projectile = { sprite, side, el, x0, y0, x1, y1, h0, tgt, homing, t, dur, done, onLand }
```

- 飞行时间 `dur = clamp(dist / 900, 0.12, 0.7)`。
- 位置：`x = x0 + (x1 - x0) × k`，`y` 同理，`k = t / dur`。`homing` 时 `x1, y1` 每帧取目标的当前位置。
- 高度：`h = h0 + sin(π k) × arc`，`arc = 36`（炸弹 110）。
- 炸弹（`homing = false`）落在发射时的位置，目标死了也会在落点溅射。
- 落地回调 `onLand()` 里结算伤害。

## 八、战斗（`src/game/combat.js`）

伤害管线、状态系统、元素反应、特性、技能的规则全部沿用原来的实现，只做这些改动：

- `damage(eng, src, tgt, base, dmgType, o)`：`tgt` 可以是水晶（有 `isCrystal`，有 `x, y, radius`）。
- `knock(eng, u, nx, ny, dist)`：沿单位向量 `(nx, ny)` 推开。巨像和盾墙期间免疫。打断蓄力。
  - 玄的震山掌：`(nx, ny)` 是从玄指向目标的单位向量。
  - 莱恩的冲锋击退：`(u.dir, 0)`，即冲锋方向。
- `splashAt(eng, src, x, y, r, exclude, dmgType, base, element)`：圆形范围内的敌方全部受伤，骨堆被溅射会散架。
- 几何辅助（全部按攻击方的朝向 `(u.dir, 0)`）：
  - `fwd(u, p) = (p.x - u.x) * u.dir`，`lat(u, p) = |p.y - u.y|`
  - `inRect(u, p, len, halfW)`：`fwd ∈ (-p.radius, len + p.radius]`，`lat ≤ halfW + p.radius`
  - `inCone(u, p, len, halfDeg)`：`fwd ∈ (0, len]`，`lat ≤ fwd × tan(halfDeg) + p.radius`
- 技能（12 个，效果同 `units.js` 的 desc）：
  - 希尔薇 穿云箭：朝前的矩形 `len = map.w`，`halfW = 40`，≥3 个敌人，每个 70 穿刺
  - 芙蕾雅 钉刺投矛：攻击距离内造价最高的敌人，投矛（`spear`）落地 80 穿刺 + 定身 2 秒
  - 布朗 盾墙：敌方远程正在挥击的 ≥2 个，布朗 4 秒盾墙（身后 120 的友军穿刺 -70%）
  - 札斯 影袭：400 距离内血最少的敌方远程，瞬身到它身后 24 px（同一 y），下一刀 ×2
  - 赛伦 烈焰风暴：以敌群中心为圆心，半径 120 的火雨区域持续 5 秒（每秒 20 火伤 + 1 层灼烧）；候选中心在攻击距离内，圆内 ≥4 个敌人
  - 莱恩 圣光冲锋：朝前冲 220，矩形 `halfW = 36`，沿途每个敌人 60 斩击并击退 50；结束获得 200 圣盾；被芙蕾雅打断
  - 熔岩蠕虫 熔岩喷吐：扇形 `len = 150, halfDeg = 45`，≥2 个敌人，每个 60 火伤 + 2 层灼烧
  - 玄 震山掌：优先攻击距离 + 60 内正在蓄力的敌人，否则攻击距离内的当前目标；击退 140（远离玄）并眩晕 1 秒
  - 摩尔德 亡者复苏：250 距离内 ≥2 具尸体，取最近 4 具，在尸体位置召唤骷髅（150 生命、16 攻击，15 秒，不占人口）
  - 奥林 冰封领域：候选中心在攻击距离内，圆 `r = 160` 内 ≥3 个敌人；蓄力 1 秒；80 魔法冰伤，3 层寒霜（直接冻结）
  - 夜叉 居合·断：朝前矩形 `len = 260, halfW = 50`，≥3 个敌人；蓄力 1.5 秒；220 斩击；击杀返还 2 秒冷却
  - 雷克斯 王之号令：场上 ≥5 个友军且有人在挥击；全体友军 150 圣盾 + 不屈

## 九、特效（`fx`）

`addFx({ kind, x, y, x2, y2, dir, len, halfDeg, halfW, r, color, dur, follow })`，`t` 由引擎递增，到 `dur` 删除。`kind`：

- `line`：`x,y → x2,y2`（穿云箭）
- `cone`：`x,y`，`dir`，`len`，`halfDeg`（蠕虫）
- `rect`：`x,y`，`dir`，`len`，`halfW`（夜叉斩击的刀光）
- `ring`：`x,y`，`r`，`color`（地面椭圆）
- `shield`、`charge`：`follow` 为单位，跟着它画
- `dash`：`x,y → x2,y2`（影袭的残影）

区域：`addZone({ kind:'rain', x, y, side, r, t, tick, acc, src })`。

## 十、水晶炮塔

每个水晶每秒一发：攻击距离 `crystal.range + crystalRadius`，找最近的敌方可攻击单位（可以是飞行单位），投射物 `arrow`，从水晶圆心发出，高度 `h0 = 80`。

## 十一、经济和出兵

- 出兵点 `formationPoint(side)`：`x = inset + crystalRadius + 60 + rng × spawnDepth`（side 1 镜像），`y = h/2 + (rng - 0.5) × spawnSpread`。组内单位按 22 px 的网格错开。
- 人口：一次出的一组只占一份人口，组内全部死亡后释放。
- 冷却、金币、`maxOnField`（贪婪宝箱 3 个）规则不变。
- 战场规模目标：一局 8–12 分钟，单方在场 100–300 个单位，双方上千个单位同屏时也能跑。

## 十二、AI（`src/game/ai.js`）

- 接口不变：`AI.attach(eng, side, level)`，`tick(eng, dt)`，只用 `eng.canSpawn`、`eng.spawn`，读取 `eng.units`、`eng.sides`、`eng.count`。
- 打分逻辑不变（克制、飞行、阵型、时间、花费、刷屏、随机）。
- 新增：敌方场上单位多（>40）时，溅射兵种（地精爆破手、赛伦、雷克斯、奥林、熔岩蠕虫）加分。
- 难度：简单 / 普通 / 困难的收入系数、决策间隔、节奏规则保持不变。

## 十三、画面（`src/game/render.js`）

- 地面：启动时把整张地图烘焙成离屏画布（一半分辨率）：草地渐变、草丛噪点、土路（沿中线一条）、树丛、石头、花。绘制时只取视野范围的源矩形。
- 相机：`cam = { x, y, zoom, follow, manualT }`。`zoom ∈ [0.22, 1.8]`，初始 `0.7`。拖动、滚轮、方向键、WASD、`[` `]` 缩放、小地图点击、触屏双指缩放。
- 跟随：`follow` 时相机平滑移动到“战斗中心”（所有在挥击的单位的平均位置；没有就所有单位的平均位置）。手动操作后 3 秒内暂停跟随。
- 单位：`zoom ≥ 0.5` 时用 `SpriteRender.drawHero`，并且只画视野内、按距离相机中心排序后的前 900 个；`zoom < 0.5` 或超出预算的单位画成阵营色的小圆点（半径 2–4 px）。
- 按 `y` 排序绘制（远的先画）。
- 血条、状态角标、蓄力条、冻结圈、钻地尘土沿用原来的逻辑。
- 投射物、区域、特效按 4.1 的投影画。
- 飘字沿用原来的逻辑，位置用 `x, y` 投影后往上飘。

## 十四、界面（`src/game/ui.js`、`src/game.template.html`）

- HUD：双方水晶血条、金币（+收入）、人口、时间、速度、暂停，另外显示“在场：我方 X / 电脑 Y”。
- 小地图：完整地图，画所有单位（阵营色小点）和相机视野框；点击或拖动跳转。
- 相机控制：拖动、滚轮/`[` `]` 缩放、方向键/WASD 平移、“跟随战斗”开关按钮（画布右侧）、“+”“−”按钮（给触屏）。
- 出兵栏、简介浮窗、结束统计、键盘快捷键（数字键 1–0、Q–P 出兵，空格暂停，Z 倍速）沿用原来的实现。`Q–P` 与 `[` `]` 不冲突。
- 横屏提示沿用原来的实现。

## 十五、测试（`tools/headless_test.js`）

- 机制断言：沿用原来的 20 项（改成 2D 坐标）。新增：分离推挤（两个地面单位不会重叠）、巨像穿过单位、飞行单位越过地面单位、单位不会离开地图。
- 技能定点场景：沿用原来的 12 项（2D 坐标）。
- 规模压力：双方各 200 个单位（混合兵种）对峙，记录每步平均耗时，要求 < 10 ms；1000 个单位 < 25 ms（只统计逻辑，不渲染）。
- AI 对 AI：默认 20 局（可用环境变量 `GAMES` 调整），统计平均时长、在场单位峰值、分出胜负的比例、超时、NaN。

## 十六、不要做的事

- 不改 `assets/` 和 `units.js` 的数值。
- 逻辑（engine、combat、ai）不碰 DOM 和 canvas。
- 不引入依赖。
- 提交信息、代码注释、文档里不写模型名。注释用中文，风格跟现有代码一致。

## 十七、承接远端 bee3ee3（review 之后加的内容）

改写的基线必须是远端最新版本，下面这些功能要保留并移植到平面引擎，不能丢：

1. **作弊菜单**（`src/game/cheat-ui.js`，C 键或右上角“作弊”）。
   - 界面端的设置 `cfg` 跨局保留，每开一局复制进新引擎的 `eng.cheats`。
   - `eng.cheats` 字段：`infiniteGold, noCd, noSupply, aiOff, satanNoCd`（布尔）；`incomeMul[2], dmgMul[2], invuln[2], godMode[2]`（按阵营）。默认全关，不影响无头测试。
   - `eng.setCrystal(side, hp, maxHp)`：水晶血量和上限，上限从 `rules.map.crystalHp` 读。
   - 菜单依赖 `window.GameUI.state.eng`，所以 `ui.js` 的 `GameUI` 全局要保留。
   - 旧代码里 `R.lane.crystalHp` 要改成 `R.map.crystalHp`。
2. **撒旦**（`src/special.js` 的 `SPECIAL_UNITS`，只有玩家能出：`playerOnly`；出兵栏最后一格；X 键）。
   - 属性：2 万血、重甲、魔法溅射 130、`ccImmune`、`scale: 1.2`、`tags: ['giant']`。
   - 被动：免疫眩晕、冻结、定身、寒霜、击退、易伤、衰弱；炼狱光环（200 范围每 0.5 秒 30 火伤 + 1 层灼烧，`satanAura`）；横扫（每下溅射 + 3 层灼烧 + 衰弱）；不灭（第一次死亡原地复活，回满血，无敌 3 秒，`reviveUsed`）。
   - 手动技能（`manualSkills`，J / K / L，冷却放在 `sides[s].manualCd[3]`，`satanNoCd` 时冷却为 0）：
     - 地狱火雨：全场敌军 400 火伤 + 3 层灼烧，敌方水晶 500 伤害。
     - 深渊威压：全场敌军击退 180（远离撒旦）+ 眩晕 4 秒，无视巨型减半，打断蓄力和冲锋。
     - 灵魂收割：处决全场生命 < 40% 的敌军，每个 +25 金币，撒旦回复 5% 生命，最多 8 个变成玩家的骷髅（20 秒）。
   - 手动释放入口 `manualCast(eng, side, idx)` 返回 `'ok' | 'nosatan' | 'cooldown'`，撒旦不在场返回 `'nosatan'`。
   - 撒旦的特殊效果走 combat.js 里的 `satanAura`、`manualCast`，不要塞进普通技能表。
3. **水晶的伤害修正**（review 问题 3）：水晶也吃易伤 ×1.2、衰弱（攻击方）、雷克斯光环 ×1.15，护甲倍率仍按水晶规则（重甲，攻城 ×3）。
4. **AI 的两个问题必须修**（review 问题 1、2）：
   - 灰鼠群刷屏：打分改成“每人口的价值”，同兵种降权按累计出兵次数（`sides[s].spawned`），而不是场上在场个数；克制匹配里“怕灰鼠群”不能让灰鼠群一直高分。
   - 雷克斯从不出场：节奏规则要真正轮到 T0，攒钱窗口覆盖 T0 的花费。
   - 验收：AI 对战 20 局里灰鼠群出兵不超过双方总出兵的 25%；雷克斯至少在 1 局里出场。
5. review 问题 4（骷髅骨堆期间不受控制效果）可以保留现状，写进 QUESTIONS.md。
6. 远端的 `docs/REVIEW.md` 是本轮改造的验收依据之一，改写完成后要逐条对照。
