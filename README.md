# AI Builders Digest — 中文图片版

每天自动跑一次 [follow-builders](https://github.com/zarazhangrui/follow-builders)
抓取当日 AI 圈动态，**翻译并提炼成中文总结**，渲染成一张手机可读的**长图**，
通过飞书 OpenAPI 推到你的飞书私聊。

## 链路

```
follow-builders 中央 feed
  （26 位 AI builder 的 X 推文 + 播客 + 官方博客）
        ↓  node prepare-digest.js
   digest.json（原始英文）
        ↓  node scripts/summarize.js      ← 调 LLM 翻译 + 提炼
   summary.json（结构化中文总结）
        ↓  node scripts/render-image.js   ← 无头浏览器截图
   digest.png（1080px 宽长图）
        ↓  node scripts/send-lark.js      ← 上传图 + 发图片消息
   飞书私聊：1 张长图 + 1 条原文链接清单
```

## 时间

`0 2 * * *` UTC = **北京时间 10:00**，每天。

也可以在 Actions 页手动触发（workflow_dispatch）测试。

## 必需的 Secrets

**Settings → Secrets and variables → Actions**：

| 名称 | 说明 |
| --- | --- |
| `LARK_APP_ID` | `cli_aa10d8df4db81bd6` |
| `LARK_APP_SECRET` | 飞书开发者后台 https://open.feishu.cn/app/cli_aa10d8df4db81bd6 里的 App Secret |
| `LARK_USER_OPEN_ID` | `ou_01b19445427e92c8aa441a72192ca01a` |

### LLM 配置（必需）

> ⚠️ GitHub Models 已于 **2026-07-30 正式退役**，不再能当免费兜底。
> 现在必须自备一个 OpenAI 兼容接口的 key。

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Secret | `AI_API_KEY` | **必填**。任意 OpenAI 兼容接口的密钥 |
| Variable | `AI_BASE_URL` | 接口地址，默认 `https://api.deepseek.com/v1` |
| Variable | `AI_MODEL` | 模型名，默认 `deepseek-chat` |
| Variable | `AI_MAX_TOKENS` | 输出上限，默认 8000 |
| Variable | `AI_DISABLE_THINKING` | 关掉推理模型的思维链（`1` 开 / `0` 关）。`AI_BASE_URL` 含 `minimax` 时自动开启 |

常见组合：

| 服务 | `AI_BASE_URL` | `AI_MODEL` |
| --- | --- | --- |
| **MiniMax（当前在用）** | `https://api.minimaxi.com/v1` | `MiniMax-M3` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 月之暗面 Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-air` |
| OpenRouter | `https://openrouter.ai/api/v1` | 例如 `google/gemini-2.0-flash-exp:free` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

只填 `AI_API_KEY` 时走 DeepSeek 默认值；换别家再加 `AI_BASE_URL` / `AI_MODEL` 两个 Variable。

**推理模型的坑**：MiniMax M 系列（以及 DeepSeek-R1 一类）默认会把思维链
`<think>…</think>` 写进正文，既拖慢速度又容易把 `max_tokens` 吃光导致 JSON 被截断。
本脚本的处理：base_url 含 `minimax` 时自动带 `thinking: { type: "disabled" }`；
同时无论如何都会在解析前剥掉 `<think>` 块。如果某家接口不认这个参数，
会自动去掉参数重试，不会整轮失败。

## 文件

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/daily-digest.yml` | 定时 + 手动触发，装中文字体、跑完整链路 |
| `scripts/summarize.js` | 调 LLM 把英文原始内容翻译提炼成结构化中文总结 |
| `scripts/render-image.js` | 把中文总结渲染成 1080px 宽长图（puppeteer 截图） |
| `scripts/send-lark.js` | 上传图片 → 发飞书图片消息 → 补一条原文链接清单 |
| `scripts/format-digest.js` | **降级用**：LLM 挂了时输出英文原文 markdown |

## 降级行为

`summarize.js` 失败（没配额、接口报错等）时，流水线**不会中断**，
而是退回旧的英文原文文本消息，并在开头标注「中文总结生成失败」。
也就是说：**每天一定有东西送到，只是质量降级**。

## 版式说明

- 长图宽 1080 CSS px，接近主流手机物理宽度
- 自动测量内容高度后选择缩放比例，保证像素高度不超浏览器截图上限、文件不超飞书 10MB
- 中文字体用 Noto Sans CJK（workflow 里 `apt-get install fonts-noto-cjk`）
- 图片里的链接点不了，所以额外补一条「原文链接」文本消息负责跳转

## 本地调试

```bash
npm install
# 只出 HTML，方便调版式
node scripts/render-image.js summary.json digest.html
# 出图（本机没装 Chrome 时，可指向已有的 Edge/Chrome）
PUPPETEER_EXECUTABLE_PATH="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  node scripts/render-image.js summary.json digest.png
```

## Setup

1. 仓库 Settings → Secrets and variables → Actions，按上表填好三个 Lark Secret。
2. 再补一个 `AI_API_KEY`（必需，GitHub Models 已退役），需要换服务商就加 `AI_BASE_URL` / `AI_MODEL` 两个 Variable。
3. Actions 页 → "AI Builders Digest" → Run workflow 测一次。
4. 跑通后，之后每天北京时间 10:00 会自动掉进你的飞书私聊。
