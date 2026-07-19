# codex-usage

Pi Coding Agent extension for monitoring your [OpenAI Codex / ChatGPT subscription](https://developers.openai.com/codex) usage.

Shows the 5-hour rate-limit window and weekly quota in the pi footer bar, and exposes a `codex_usage` tool.

## Install

```bash
pi install git:github.com/inouemoby/pi-codex-usage
```

## Setup

No login needed from this extension. It reuses your existing Codex credentials, resolved in this order:

1. pi's auth config (`~/.pi/agent/auth.json` → `openai-codex`) — the same OAuth store pi uses (run `/auth openai-codex` if missing)
2. Codex CLI (`~/.codex/auth.json` → `tokens`, honors `$CODEX_HOME`) — populated by `codex login`

The extension automatically refreshes the ChatGPT OAuth access token before it expires and **rotates the refresh token back** into the source file (refresh tokens are single-use in OpenAI's OAuth).

## Commands

| Command | Description |
|---------|-------------|
| `/codex` | Show detailed usage with progress bars (5h / weekly / credits) |

## Footer Display

When using a Codex / ChatGPT-backed model, the footer shows:

```
↑3.2k ↓1.1k 12.5%/256k (auto) 5h:6% wk:1%    (openai-codex) gpt-5-codex • medium
```

- `5h:6%` — 5-hour rolling rate-limit window. `!` above expected pace, `!!` exceeds 1.5× expected pace
- `wk:1%` — weekly quota (resets every 7 days), same pacing flags

## Quota Details

- **5h window**: Rolling burst limit — even with weekly quota left, sending too many requests inside 5 hours triggers throttling.
- **Weekly window**: Main subscription quota, auto-refreshes every 7 days. Unused quota does not accumulate.
- **Credits**: Pay-as-you-go balance (shown when present). `unlimited` is shown for plans without a credit ceiling.
- **Extra limits**: Model-specific limits such as Codex Spark are listed in `/codex`.

## Tool: codex_usage

The extension also registers a `codex_usage` tool that the AI can call:

```
Check OpenAI Codex usage (5h window, weekly quota & credits)
```

## How It Works

- Reads OAuth tokens from `~/.pi/agent/auth.json` (`openai-codex`) or `~/.codex/auth.json` (`tokens`).
- Refreshes the access token via `POST https://auth.openai.com/oauth/token` (`grant_type=refresh_token`, client `app_EMoamEEZ73f0CkXaXp7hrann`) when the JWT `exp` is within 1 hour, then atomically writes the rotated tokens back.
- Fetches usage from `GET https://chatgpt.com/backend-api/wham/usage` with the access token as a Bearer token.
- Rate windows (`primary_window` / `secondary_window`) are classified into 5h vs weekly by their `limit_window_seconds` — OpenAI assigns these fields differently per plan, so classification by duration is more robust than by field name.

The `wham/usage` endpoint is undocumented and may change without notice.

## Related

- [pi-kimi-usage](https://github.com/inouemoby/pi-kimi-usage) — Same tool for Kimi (Moonshot AI)
- [pi-zai-usage](https://github.com/inouemoby/pi-zai-usage) — Same tool for ZAI Coding Plan
- [pi-ollama-usage](https://github.com/inouemoby/pi-ollama-usage) — Same tool for Ollama Cloud
