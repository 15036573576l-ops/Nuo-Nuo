"""切分高清横版角色条带图，算出帧宽、脚底锚点和身高，生成 src/hd-sheets.js。"""
import json, math, pathlib
from functools import reduce
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/hd-src"

# 每个角色用到的动作：state -> (文件名, 帧率, 出手帧)；fw 是自动推断不准时手填的帧宽
SHEETS = {
    "rat":            {"idle": ("idle", 10), "run": ("run", 14), "attack": ("attack_bite", 14, 3), "hit": ("hurt", 10), "death": ("rat-death", 10)},
    "skeleton":       {"idle": ("Idle", 8), "run": ("Walk", 10), "attack": ("Attack", 14, 6), "hit": ("Take Hit", 10), "death": ("Death", 10)},
    "mushroom":       {"idle": ("Idle", 8), "run": ("Run", 12), "attack": ("Attack", 12, 6), "hit": ("Take Hit", 10), "death": ("Death", 10)},
    "slime":          {"idle": ("idle", 10), "run": ("walk", 10), "attack": ("attack", 14, 6), "hit": ("hurt", 10), "death": ("death", 12)},
    "goblin":         {"idle": ("Idle", 8), "run": ("Run", 12), "attack": ("Attack", 12, 6), "hit": ("Take Hit", 10), "death": ("Death", 10)},
    "huntress_2":     {"idle": ("Idle", 10), "run": ("Run", 12), "attack": ("Attack", 10, 4), "hit": ("Get Hit", 10), "death": ("Death", 10)},
    "huntress":       {"idle": ("Idle", 10), "run": ("Run", 12), "attack": ("Attack3", 12, 4), "hit": ("Take hit", 10), "death": ("Death", 10)},
    "bat":            {"idle": ("fly", 12), "run": ("fly", 14), "attack": ("attack", 14, 6), "hit": ("hurt", 10), "death": ("death", 10)},
    "warrior_3":      {"idle": ("Idle", 10), "run": ("Run", 12), "attack": ("Attack1", 12, 2), "hit": ("Get Hit", 10), "death": ("Death", 10)},
    "mimic":          {"idle": ("Idle_closed", 6), "run": ("walk", 10), "attack": ("attack_1", 12, 4), "hit": ("hurt", 10), "death": ("death", 10)},
    "martial_hero":   {"idle": ("Idle", 10), "run": ("Run", 12), "attack": ("Attack1", 14, 4), "hit": ("Take Hit", 10), "death": ("Death", 10)},
    "evil_wizard":    {"idle": ("Idle", 10), "run": ("Move", 12), "attack": ("Attack", 12, 5), "hit": ("Take Hit", 10), "death": ("Death", 10)},
    "hero_knight":    {"idle": ("Idle", 10), "run": ("Run", 12), "attack": ("Attack1", 12, 3), "hit": ("Take Hit", 10), "death": ("Death", 12)},
    "fire_worm":      {"idle": ("Idle", 10), "run": ("Walk", 10), "attack": ("Attack", 12, 10), "hit": ("Get Hit", 10), "death": ("Death", 10)},
    "martial_hero_3": {"idle": ("Idle", 10), "run": ("Run", 12), "attack": ("Attack1", 14, 3), "hit": ("Take Hit", 10), "death": ("Death", 10)},
    "evil_wizard_2":  {"idle": ("Idle", 10), "run": ("Run", 12), "attack": ("Attack1", 12, 5), "hit": ("Take hit", 10), "death": ("Death", 10)},
    "wizard_pack":    {"fw": 231, "idle": ("Idle", 8), "run": ("Run", 12), "attack": ("Attack1", 12, 5), "hit": ("Hit", 10), "death": ("Death", 10)},
    "martial_hero_2": {"idle": ("Idle", 8), "run": ("Run", 12), "attack": ("Attack1", 12, 3), "hit": ("Take hit", 10), "death": ("Death", 10)},
    "king_1":         {"idle": ("Idle", 8), "run": ("Run", 12), "attack": ("Attack_1", 12, 3), "hit": ("Hit", 10), "death": ("Death", 10)},
    "warrior_1":      {"fw": 184, "idle": ("Idle", 8), "run": ("Run", 10), "attack": ("Attack1", 10, 2), "hit": ("Hit", 10), "death": ("Death", 10)},
}

# 投射物条带：key -> (文件, 帧数)
PROJECTILES = {
    "arrow": ("huntress_2", "Arrow", 1),
    "spear": ("huntress", "Spear move", 12),
    "bomb": ("goblin", "Bomb_sprite", 19),
    "spore": ("mushroom", "Projectile_sprite", 8),
    "fireball": ("fire_worm", "Fireball", 6),
}


def frame_width(widths, h):
    g = reduce(math.gcd, widths)
    # 帧宽是所有条带宽度的公约数，取最接近高度的那个
    cands = [d for d in range(1, g + 1) if g % d == 0 and 0.6 * h <= d <= 2.5 * h]
    return min(cands, key=lambda d: abs(d - h)) if cands else g


out = {}
for key, anims in SHEETS.items():
    anims = dict(anims)
    fw_fixed = anims.pop("fw", None)
    files = {p.stem: p for p in (SRC / key).glob("*.png")}
    used = {st: Image.open(files[a[0]]).convert("RGBA") for st, a in anims.items()}
    h = used["idle"].height
    fw = fw_fixed or frame_width([im.width for im in used.values()], h)
    # 锚点：所有待机帧非透明区域的并集
    idle = used["idle"]
    boxes = [idle.crop((i * fw, 0, (i + 1) * fw, h)).getbbox() for i in range(idle.width // fw)]
    boxes = [b for b in boxes if b]
    x0 = min(b[0] for b in boxes); x1 = max(b[2] for b in boxes)
    y0 = min(b[1] for b in boxes); y1 = max(b[3] for b in boxes)
    meta = {"fw": fw, "fh": h, "cx": (x0 + x1) / 2, "foot": y1, "bodyW": x1 - x0, "bodyH": y1 - y0, "anims": {}}
    for st, a in anims.items():
        meta["anims"][st] = {"src": f"hd/{key}/{a[0]}", "n": used[st].width // fw, "fps": a[1]}
        if len(a) > 2:
            meta["anims"][st]["release"] = a[2]
    out[key] = meta
    print(key, meta["fw"], meta["fh"], "body", meta["bodyW"], meta["bodyH"], {k: v["n"] for k, v in meta["anims"].items()})

proj = {}
for k, (d, f, n) in PROJECTILES.items():
    im = Image.open(SRC / d / f"{f}.png")
    proj[k] = {"src": f"hd/{d}/{f}", "n": n, "fw": im.width // n, "fh": im.height}
    print("proj", k, proj[k])
out["_projectiles"] = proj

js = "// 由 tools/build_hd.py 生成，不要手改\nwindow.HD_SHEETS = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n"
(ROOT / "src/hd-sheets.js").write_text(js, encoding="utf-8")
