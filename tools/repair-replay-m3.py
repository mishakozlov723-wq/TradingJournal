from pathlib import Path

path = Path("public/replay-space.js")
source = path.read_text()
replacements = [
    (
        "d.m3&&d.m3Start&&d.T[cur]>=d.m3Start",
        "d.m3&&d.m3.m3Start&&d.T[cur]>=d.m3.m3Start",
    ),
    (
        "s.d.m3&&s.d.m3Start&&s.d.T[s.cur]>=s.d.m3Start",
        "s.d.m3&&s.d.m3.m3Start&&s.d.T[s.cur]>=s.d.m3.m3Start",
    ),
]
for old, new in replacements:
    count = source.count(old)
    if count == 0:
        if new in source:
            continue
        raise SystemExit(f"Expected M3 expression not found: {old}")
    if count != 1:
        raise SystemExit(f"Expected one M3 expression, found {count}: {old}")
    source = source.replace(old, new)
path.write_text(source)