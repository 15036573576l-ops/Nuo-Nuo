"""把《糯糯战记》的源码、兵种数据、精灵图内联成一个单文件网页 dist/game.html，双击就能玩。

用法：python3 tools/build_game.py
源码顺序很重要：数据 → 渲染器 → 战斗 → 引擎 → AI → 画面 → 界面。
"""
import base64
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

SCRIPTS = [
    "src/rules.js",
    "src/units.js",
    "src/special.js",
    "src/hd-sheets.js",
    "src/sprite-render.js",
    "src/game/combat.js",
    "src/game/engine.js",
    "src/game/ai.js",
    "src/game/render.js",
    "src/game/ui.js",
    "src/game/cheat-ui.js",
]

sprites = {}
for p in sorted((ROOT / "assets/hd-src").glob("*/*.png")):
    sprites[f"hd/{p.parent.name}/{p.stem}"] = "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()

html = (ROOT / "src/game.template.html").read_text(encoding="utf-8")
html = html.replace("/*SPRITES*/", "window.SPRITES = " + json.dumps(sprites) + ";")

blocks = []
for rel in SCRIPTS:
    code = (ROOT / rel).read_text(encoding="utf-8")
    if "</script" in code.lower():
        raise SystemExit(f"{rel} 里有 </script>，会截断内联脚本")
    blocks.append(f"<script>\n// ---- {rel} ----\n{code}\n</script>")
html = html.replace("<!--SCRIPTS-->", "\n".join(blocks))

out = ROOT / "dist/game.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"{out.relative_to(ROOT)} {out.stat().st_size // 1024} KB, {len(sprites)} sprites")
