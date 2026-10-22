# -*- coding: utf-8 -*-
from pathlib import Path

p = Path("deploy/openclaw/plugins/aierp-erp-tools/index.js")
t = p.read_text(encoding="utf-8")
marker = 'name: "erp_excel_template"'
idx = t.find(marker)
if idx < 0:
    raise SystemExit("tool not found")
# Find end of description string concatenation before parameters
sub = t[idx : idx + 1200]
guard = "回执PDF由渠道处理，禁止用本工具冒充回执。"
if guard in t:
    print("already guarded")
else:
    # Insert after the description block's last quoted segment before `parameters:`
    anchor = "\n      parameters: {"
    pos = t.find(anchor, idx)
    if pos < 0:
        raise SystemExit("parameters anchor missing")
    insert = (
        ' +\n        "'
        + guard
        + '"'
    )
    # Find last `",` or `";` of description - look backward for last quote-comma pattern
    # Safer: add as new concatenation before parameters
    # description currently ends with something like: `禁止 excel.confirm。",`
    # Find the last `",` before parameters within the tool object
    window = t[idx:pos]
    last = window.rfind('",')
    if last < 0:
        raise SystemExit("desc end not found")
    abs_last = idx + last
    t = t[: abs_last + 1] + insert + t[abs_last + 1 :]
    p.write_text(t, encoding="utf-8")
    print("guard appended")
