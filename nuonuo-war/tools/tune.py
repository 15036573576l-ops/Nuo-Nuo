"""按兵种 id 改 units.js 里的数值字段：python3 tools/tune.py rat.hp=65 rat.cost=55 ..."""
import re, sys, pathlib
p = pathlib.Path(__file__).resolve().parent.parent / "src/units.js"
s = p.read_text(encoding="utf-8")
for arg in sys.argv[1:]:
    key, val = arg.split("=")
    uid, field = key.split(".")
    m = re.search(r"\n  \{\n    id: '" + uid + r"'.*?\n  \},", s, re.S)
    if not m:
        sys.exit(f"找不到兵种 {uid}")
    block = m.group(0)
    new, n = re.subn(r"(\b" + field + r": )([0-9.]+)", lambda mm: mm.group(1) + val, block, count=1)
    if n == 0:
        sys.exit(f"{uid} 没有字段 {field}")
    s = s.replace(block, new)
p.write_text(s, encoding="utf-8")
print("ok", len(sys.argv) - 1, "处")
