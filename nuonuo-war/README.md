# 糯糯战记

单机网页大平原对战游戏（玩家对电脑）。平原 8000×3200，两边各有一个水晶，花金币出兵，兵自己朝敌方水晶推进、遇到敌人自己打，先打爆对方水晶的一方获胜。

## 游戏

- `src/units.js`、`src/rules.js`：20 个兵种的数据和全局规则
- `src/game/`：战斗逻辑（`combat.js`、`engine.js`、`ai.js`）和界面（`render.js`、`ui.js`）
- `src/game.template.html`：页面模板

构建：`python3 tools/build_game.py`，然后用浏览器打开 `dist/game.html`。

测试：`node tools/headless_test.js`（机制断言、技能场景、撒旦、规模压力、AI 对 AI 20 局）。

特殊单位（`src/special.js`，只有玩家能出）：

- 撒旦：`X` 召唤，`J K L` 手动技能。
- 冰龙：`V` 召唤，50 万金币，不占人口、不限数量，数值是撒旦的 1000 倍。`B N M` 手动技能（振翼、咆哮、暴风雪）。
  画面右侧的“冰龙打水晶”按钮（`H`）关掉以后，冰龙的攻击和技能都打不到敌方水晶。

冰龙的图是从三维模型渲染出来的，重新出图：

```
npm i three@0.128.0 playwright
node tools/render_frostwing.js /tmp/frostwing-frames
python3 tools/build_frostwing.py /tmp/frostwing-frames
python3 tools/build_hd.py && python3 tools/build_game.py
```

契约见 `docs/PLANE_SPEC.md`，实现说明见 `docs/IMPLEMENTATION.md`，规则上的取舍见 `docs/QUESTIONS.md`。

## 图鉴

- `src/heroes.js`：20 位英雄的数据（T0 / T0.5 / T1 / T2 / T3 五个梯队）
- `src/gallery.template.html`：英雄图鉴页面模板
- `tools/build_gallery.py`：把图片和脚本内联成单文件 `dist/gallery.html`

构建：`python3 tools/build_gallery.py`，然后用浏览器打开 `dist/gallery.html`。

素材来源见 `assets/CREDITS.md`。
