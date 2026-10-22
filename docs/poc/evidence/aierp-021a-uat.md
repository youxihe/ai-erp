# AIERP-021A UAT notes

## Automated (non-posting) — PASS 20/20

```bash
node deploy/scripts/aierp-021a-partner-master.mjs
```

Evidence: `docs/poc/evidence/aierp-021a-partner-master.json`

- prepare → zero `jsh_supplier` insert
- trusted `确认建档{id}` / `确认修改{id}` → real supplier/customer id
- duplicate same-type name blocked; bank/tax/begin balances unchanged on update
- partner search finds new supplier; stock unchanged
- LLM self-report / group / unbound / rebind rejected

## Live WeCom client

`NOT_RUN` — `plugin/index.js` not wired in this PR (F: unified integrate). SOP modules + registry ready for that window.

## Demo checklist

See `docs/poc/DEMO_UAT_MASTERDATA_CHAT.md` sections 1–3, 7.
