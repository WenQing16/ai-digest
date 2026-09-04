# AI Builders Digest — Daily Lark Sender

GitHub Actions workflow that runs the
[follow-builders](https://github.com/zarazhangrui/follow-builders) skill once a
day and delivers the result to your Lark (Feishu) DM via the Lark OpenAPI.

## Schedule

`0 2 * * *` UTC = **10:00 Asia/Shanghai**, daily.

You can also trigger it manually from the Actions tab (workflow_dispatch).

## Required Secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret              | Value |
| ------------------- | ----- |
| `LARK_APP_ID`       | `cli_aa10d8df4db81bd6` |
| `LARK_APP_SECRET`   | (from https://open.feishu.cn/app/cli_aa10d8df4db81bd6) |
| `LARK_USER_OPEN_ID` | `ou_01b19445427e92c8aa441a72192ca01a` |

## Files

- `.github/workflows/daily-digest.yml` — the cron + manual dispatch
- `scripts/format-digest.js` — turns `prepare-digest.js` JSON into readable markdown
- `scripts/send-lark.js` — calls Lark OpenAPI to deliver the markdown as a `post` message

## Setup

1. In GitHub Desktop: Add Local Repository → pick this folder → Publish to a **private** repo.
2. In GitHub repo Settings → Secrets and variables → Actions → New repository secret:
   - `LARK_APP_ID` = `cli_aa10d8df4db81bd6`
   - `LARK_APP_SECRET` = (paste from Feishu developer console)
   - `LARK_USER_OPEN_ID` = `ou_01b19445427e92c8aa441a72192ca01a`
3. Actions tab → "AI Builders Digest" → Run workflow to test.
4. If it succeeds, the next 10:00 Asia/Shanghai run will land in your Lark DM automatically.

## Quality note

This pipeline does **not** include an LLM remix step. Each builder's tweet text
is included verbatim (truncated to ~280 chars per tweet). For a richer summary
with editorial framing, you would need OpenClaw or a similar agent runtime.