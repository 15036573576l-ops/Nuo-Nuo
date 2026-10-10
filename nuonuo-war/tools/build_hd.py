"""切分高清横版角色条带图，算出帧宽、脚底锚点和身高，生成 src/hd-sheets.js。"""
import json, math, pathlib
from functools import reduce
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/hd-src"

# 每个角色用到的动作：state -> (文件名, 帧率, 出手帧)；fw 是自动推断不准时手填的帧宽
SHEETS = {
    "evil_wizard_2": {"idle": ("Idle", 10), "run": ("Run", 12), "attack": ("Attack1", 12, 5), "hit": ("Take hit", 10)},
    "evil_wizard":   {"idle": ("Idle", 10), "run": ("Move", 12), "attack": ("Attack", 12, 5), "hit": ("Take Hit", 10)},
    "wizard_pack":   {"fw": 231, "idle": ("Idle", 8),  "run": ("Run", 12),  "attack": ("Attack1", 12, 5), "hit": ("Hit", 10)},
    "king_2":        {"fw": 160, "idle": ("Idle", 10), "run": ("Run", 12),  "attack": ("Attack1", 12, 2), "hit": ("Take Hit", 10)},
    "martial_hero":  {"idle": ("Idle", 10), "run": ("Run", 12),  "attack": ("Attack1", 14, 4), "hit": ("Take Hit", 10)},
    "huntress_2":    {"idle": ("Idle", 10), "run": ("Run", 12),  "attack": ("Attack", 10, 4), "hit": ("Get Hit", 10)},
    "hero_knight":   {"idle": ("Idle", 10), "run": ("Run", 12),  "attack": ("Attack1", 12, 3), "hit": ("Take Hit", 10)},
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

js = "// 由 tools/build_hd.py 生成，不要手改\nwindow.HD_SHEETS = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n"
(ROOT / "src/hd-sheets.js").write_text(js, encoding="utf-8")
