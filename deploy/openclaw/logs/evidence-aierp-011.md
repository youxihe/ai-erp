# AIERP-011 本机验收证据（脱敏）

- Date: 2026-10-20
- OpenClaw: `2026.10.5` (npm)
- Runtime: Windows native under `%LOCALAPPDATA%\aierp-openclaw` (Node `24.16.0` portable)
- Why not Docker first: Ubuntu WSL vhdx missing (`D:\OpenClaw\Ubuntu\ext4.vhdx`); Docker Hub/GHCR image pull stalled behind Desktop proxy/mirror
- Why not default HOME service: `gateway install` blocked for non-default `OPENCLAW_STATE_DIR` → use `start-gateway-native.ps1` (`gateway run --bind loopback`)

## Checks

| Check | Result |
|---|---|
| Control UI `http://127.0.0.1:18789/` | HTTP 200 |
| Bind | `127.0.0.1:18789` only (loopback) |
| DeepSeek models list | `deepseek/deepseek-v4-flash` Auth=yes |
| DeepSeek agent smoke | PASS (`AIERP-011-OK`, ~15s) — see `deepseek-smoke.txt` |
| WeCom channel probe | `enabled, configured, running, works` |
| ERP isolation | No MySQL/Redis/boot network join; no Docker socket |

## User action remaining

1. Open WeCom, private-chat the bot: `你好` → expect DeepSeek reply.
2. If pairing prompt: approve in Control UI (dmPolicy=pairing).
3. Send `你可以做什么` → should say conversation-only / no ERP tools yet.
4. Optional: rotate Bot Secret / DeepSeek key (they were pasted in chat once).

## Manage

```powershell
cd D:\ERP\ai-erp\deploy\openclaw
.\scripts\start-gateway-native.ps1
.\scripts\health.ps1
.\scripts\backup.ps1
# logs: .\logs\gateway-run.err.log (redact before sharing)
```

## Review Fix Round-1 (2026-10-20)

| Check | Result |
|---|---|
| `cmdline_token_leak` after restart | `false` (no `--token` on node cmdline) |
| Port ownership stop | Only `node … aierp-openclaw … gateway run` |
| Native `health.ps1` | `runtime=native`, HTTP 200 |
| DeepSeek smoke | `AIERP-011-OK` (~10.5s) |
| WeCom probe after restart/restore | `enabled, configured, running, works` |
| Backup/restore | `deploy/openclaw/backups\` + workspace MIR removes extras |
| Autostart | Manual `start-gateway-native.ps1` (not a Windows service) |
