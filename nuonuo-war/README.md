# 糯糯战记

单机网页横版对战游戏（开发中）。

- `src/heroes.js`：20 位英雄的数据（T0 / T0.5 / T1 / T2 / T3 五个梯队）
- `src/sprite-render.js`：精灵帧动画、武器挂点、攻击/受击动作
- `src/gallery.template.html`：英雄图鉴页面模板
- `tools/build_gallery.py`：把图片和脚本内联成单文件 `dist/gallery.html`

构建：`python3 tools/build_gallery.py`，然后用浏览器打开 `dist/gallery.html`。

素材来源见 `assets/CREDITS.md`。
