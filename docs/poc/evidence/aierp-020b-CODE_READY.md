# AIERP-020B · CODE_READY

| Field | Value |
|---|---|
| Status | **CODE_READY** |
| Branch | `feat/aierp-020b-wecom-native-card-renderer` |
| Worktree | `D:\ERP\ai-erp-020b` |
| HEAD | `5c7989918112e3b0b2ceb08c4bbf69df4c29022c` |
| Base | `origin/master` @ `cf96c8dd` |
| Pushed | yes → `origin/feat/aierp-020b-wecom-native-card-renderer` |
| Open PR | https://github.com/youxihe/ai-erp/compare/master...feat/aierp-020b-wecom-native-card-renderer?expand=1 |
| Unit | `node deploy/scripts/aierp-020b-wecom-card-unit.mjs` → ALL_PASS |
| Capability | `docs/poc/evidence/aierp-020b-wecom-capability-matrix.md` |

## Delivered

1. Installed Bot WS capability matrix (markdown / template_card / image / file; plain before_dispatch forbidden HTML/MEDIA).
2. Multi-line purchase WeCom adapter — name, qty, unit price, line amount, bill totals; 2 bills / 3 lines accurate.
3. Buttons: view/copy confirm phrase only — never post stock.
4. PURCHASE / MIX / SERVICE confirm routes preserved.

## Not in this PR

- Live PC/mobile client open screenshots (SDK probed; delivery UAT separate).
- Deploy to F: / runtime `app.jar` (forbidden for this agent).
