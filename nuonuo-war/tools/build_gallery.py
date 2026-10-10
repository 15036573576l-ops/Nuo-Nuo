"""把精灵图、英雄数据和渲染器内联成一个单文件网页 dist/gallery.html。"""
import base64, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
sprites = {
    p.stem: "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
    for p in sorted((ROOT / "assets/sprites").glob("*.png"))
}
html = (ROOT / "src/gallery.template.html").read_text(encoding="utf-8")
html = html.replace("/*SPRITES*/", "window.SPRITES = " + json.dumps(sprites) + ";")
html = html.replace("/*HEROES*/", (ROOT / "src/heroes.js").read_text(encoding="utf-8"))
html = html.replace("/*RENDER*/", (ROOT / "src/sprite-render.js").read_text(encoding="utf-8"))
out = ROOT / "dist/gallery.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"{out} {out.stat().st_size // 1024} KB, {len(sprites)} sprites")
