"""把 tools/render_frostwing.js 渲染出的逐帧图合成冰龙的条带图（带透明通道的 WebP），放进 assets/hd-src/frostwing/。

用法：python3 tools/build_frostwing.py <逐帧图目录>
每帧三张图：成品画面、实体剪影（.s）、含翼膜的剪影（.a）。透明度 = 剪影 + 画面里发光的部分（吐息、冰尘）。
"""
import pathlib, sys
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path(sys.argv[1])
OUT = ROOT / "assets/hd-src/frostwing"
CROP_W = 1088          # 渲染图左边这一段留下（龙头前面给吐息留位置），右边尾巴后面的空白裁掉
FW, FH = 544, 336      # 成品帧尺寸
MEMBRANE = 0.86        # 翼膜的不透明度
QUALITY = 82


def load(name):
    b = np.asarray(Image.open(SRC / f"{name}.png").convert("RGB"), dtype=np.float32)
    s = np.asarray(Image.open(SRC / f"{name}.s.png").convert("L"), dtype=np.float32) / 255
    a = np.asarray(Image.open(SRC / f"{name}.a.png").convert("L"), dtype=np.float32) / 255
    return b, s, a


def cut(name, bg):
    b, s, a = load(name)
    mask = np.maximum(s, a * MEMBRANE)
    d = np.clip(b - bg, 0, None)
    peak = d.max(axis=2)
    glow = np.clip(peak / 255 * 2.2 - 0.05, 0, 1)
    alpha = np.maximum(mask, glow)
    # 发光部分只留色相，亮度交给透明度，叠在草地上不会发灰
    lit = d / np.maximum(peak, 1)[..., None] * (205 + 50 * glow)[..., None]
    m = mask[..., None]
    rgb = b * m + lit * (1 - m)
    # 预乘后缩小，再除回来，边缘不会带黑边
    pre = np.dstack([rgb * alpha[..., None], alpha * 255])[:, :CROP_W]
    chans = [Image.fromarray(pre[..., i]).resize((FW, FH), Image.LANCZOS) for i in range(4)]
    pre = np.dstack([np.asarray(c, dtype=np.float32) for c in chans])
    al = np.clip(pre[..., 3], 0, 255)
    al[al < 6] = 0
    rgb = np.where(al[..., None] > 0, pre[..., :3] / np.maximum(al[..., None] / 255, 1e-3), 0)
    out = np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8)
    return out[:, ::-1]      # 水平镜像：龙头朝右


def strip(frames):
    im = Image.new("RGBA", (FW * len(frames), FH))
    for i, f in enumerate(frames):
        im.paste(Image.fromarray(f, "RGBA"), (i * FW, 0))
    return im


def death(base, n=10):
    """碎裂消散：整体变白、下坠，按噪声一块块碎掉，最后只剩地上几粒碎冰。"""
    rng = np.random.default_rng(7)
    cell = 7
    noise = rng.random((FH // cell + 1, FW // cell + 1))
    noise = np.kron(noise, np.ones((cell, cell)))[:FH, :FW]
    yy = np.linspace(0, 1, FH)[:, None]
    order = noise * 0.75 + (1 - yy) * 0.25          # 上面的先碎
    frames = []
    for k in range(n):
        p = k / (n - 1)
        f = base.astype(np.float32).copy()
        white = min(1.0, p * 1.6) * 0.7
        f[..., :3] = f[..., :3] * (1 - white) + np.array([225, 240, 255]) * white
        keep = order > p * 1.08 - 0.04
        f[..., 3] *= keep
        drop = int(round(p * p * 46))
        if drop:
            f = np.roll(f, drop, axis=0)
            f[:drop] = 0
        f[..., 3] *= 1 - 0.55 * p
        frames.append(f.astype(np.uint8))
    return frames


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bg = np.median(load("fly_00")[0][:24, -24:].reshape(-1, 3), axis=0)
    fly = [cut(f"fly_{i:02d}", bg) for i in range(12)]
    roar = [cut(f"roar_{i:02d}", bg) for i in range(16)]
    for name, frames in (("Fly", fly), ("Roar", roar), ("Death", death(fly[0]))):
        im = strip(frames)
        im.save(OUT / f"{name}.webp", quality=QUALITY, method=6, exact=False)
        print(name, len(frames), "帧", im.size, (OUT / f"{name}.webp").stat().st_size // 1024, "KB")
    # 实体部分（不含翼膜和发光）的包围盒，给 build_hd.py 里手填锚点做参考
    s = np.asarray(Image.open(SRC / "fly_00.s.png").convert("L"))[:, :CROP_W]
    ys, xs = np.nonzero(s > 128)
    print("实体包围盒（成品帧坐标）x", FW - xs.max() // 2, FW - xs.min() // 2, "y", ys.min() // 2, ys.max() // 2)


main()
