#!/usr/bin/env node
// ============================================================================
// AI Builders Digest — Summarize (中文总结版)
// ============================================================================
// 输入（stdin）：prepare-digest.js 输出的原始 JSON（英文推文 / 播客 / 博客）
// 输出（stdout）：结构化中文总结 JSON，供 render-image.js 渲染成长图
//
// LLM 配置（需要一个 OpenAI 兼容接口的 key）：
//   AI_API_KEY  —— 必填。任意 OpenAI 兼容接口的 key
//   AI_BASE_URL —— 可选，默认 https://api.deepseek.com/v1
//   AI_MODEL    —— 可选，默认 deepseek-chat
//   AI_MAX_TOKENS      —— 可选，默认 8000
//   AI_DISABLE_THINKING—— 可选，关掉推理模型的思维链；
//                         base_url 含 minimax 时自动开启
//   常见组合：MiniMax / DeepSeek / Kimi / 智谱 GLM / 通义 / OpenAI / OpenRouter
//
// 注意：GitHub Models 已于 2026-07-30 正式退役（官方文档），
//       不再作为兜底方案，必须配置 AI_API_KEY。
//
// 用法：node scripts/summarize.js < /tmp/digest.json > /tmp/summary.json
// ============================================================================

const AI_API_KEY = (process.env.AI_API_KEY || '').trim();
const AI_BASE_URL = (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '');
const AI_MODEL = (process.env.AI_MODEL || '').trim();
// 输出上限：够放下整份中文总结 JSON 即可，别设太大（部分接口会拒绝超限值）
let MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 8000) || 0;

// 是否显式关闭推理模型的思维链。
// MiniMax M 系列默认会把 <think> 写进正文，既慢又容易把 max_tokens 吃光；
// 未显式配置时，只要 base_url 是 MiniMax 就自动关掉。
const DISABLE_THINKING = (() => {
  const raw = (process.env.AI_DISABLE_THINKING || '').trim();
  if (raw) return !/^(0|false|no|off)$/i.test(raw);
  return /minimax/i.test(AI_BASE_URL);
})();

// 运行期降级开关：接口不认某个参数时逐个关掉，而不是整轮失败
let THINKING_REJECTED = false;
let JSON_MODE_REJECTED = false;

// -- 截断上限：控制 token 消耗，避免长播客转写稿把上下文打爆 ---------------
const LIMITS = {
  builders: 30,
  tweetsPerBuilder: 6,
  tweetChars: 400,
  podcasts: 3,
  transcriptChars: 9000,
  blogs: 6,
  blogChars: 3000,
};

// -- 读取 stdin --------------------------------------------------------------
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

// -- Provider 解析 -----------------------------------------------------------
// 只认 AI_API_KEY。GitHub Models 已于 2026-07-30 退役，不再兜底。
function resolveProvider() {
  if (!AI_API_KEY) {
    throw new Error(
      '未配置 AI_API_KEY，无法生成中文总结。' +
        '请在仓库 Settings → Secrets and variables → Actions 里添加 AI_API_KEY' +
        '（任意 OpenAI 兼容接口的 key，如 DeepSeek / Kimi / 智谱 / 通义；' +
        '非 DeepSeek 时再用 Variables 配 AI_BASE_URL 和 AI_MODEL）。' +
        '注：GitHub Models 已于 2026-07-30 退役，不能再当免费兜底。',
    );
  }
  return {
    name: 'AI_API_KEY (OpenAI 兼容接口)',
    baseUrl: AI_BASE_URL || 'https://api.deepseek.com/v1',
    model: AI_MODEL || 'deepseek-chat',
    key: AI_API_KEY,
  };
}

// -- 调用 LLM ----------------------------------------------------------------
async function chat(provider, messages, useJsonMode) {
  const body = {
    model: provider.model,
    messages,
    temperature: 0.3,
  };
  if (useJsonMode) body.response_format = { type: 'json_object' };
  if (MAX_TOKENS > 0) body.max_tokens = MAX_TOKENS;
  // MiniMax 等推理模型：关掉思维链，直接给答案
  if (DISABLE_THINKING && !THINKING_REJECTED) body.thinking = { type: 'disabled' };

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`LLM ${res.status}: ${raw.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`LLM 返回的不是 JSON 信封: ${raw.slice(0, 300)}`);
  }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    console.error('[summarize] 警告：输出被 max_tokens 截断，可能无法解析');
  }
  const content = choice?.message?.content;
  if (!content) throw new Error(`LLM 返回内容为空: ${raw.slice(0, 300)}`);
  // 排障用：把模型原始输出落盘（AI_DEBUG_DUMP=/path/to/raw.txt）
  if (process.env.AI_DEBUG_DUMP) {
    try {
      require('fs').writeFileSync(process.env.AI_DEBUG_DUMP, content);
    } catch {
      /* 忽略 */
    }
  }
  return content;
}

// -- 把原始 digest 压成给 LLM 看的纯文本 ------------------------------------
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function buildSourceText(data) {
  const lines = [];
  const stats = data.stats || {};

  lines.push(`【本次内容统计】X 博主 ${stats.xBuilders || 0} 位 · 推文 ${stats.totalTweets || 0} 条 · 播客 ${stats.podcastEpisodes || 0} 期 · 博客 ${stats.blogPosts || 0} 篇`);
  lines.push('');

  // X / 推特
  const builders = (data.x || []).slice(0, LIMITS.builders);
  if (builders.length) {
    lines.push('===== X / 推特 =====');
    for (const b of builders) {
      const bio = (b.bio || '').replace(/^@\w+\s*/g, '').trim();
      lines.push(`## ${b.name}${b.handle ? ` (@${b.handle})` : ''}${bio ? ` — ${bio}` : ''}`);
      const tweets = (b.tweets || []).slice(0, LIMITS.tweetsPerBuilder);
      for (const t of tweets) {
        const meta = [];
        if (typeof t.likes === 'number') meta.push(`赞${t.likes}`);
        if (typeof t.retweets === 'number' && t.retweets) meta.push(`转${t.retweets}`);
        lines.push(`- [${meta.join(' ')}] ${clip(t.text, LIMITS.tweetChars)}`);
        lines.push(`  url: ${t.url || ''}`);
      }
      lines.push('');
    }
  }

  // 官方博客
  const blogs = (data.blogs || []).slice(0, LIMITS.blogs);
  if (blogs.length) {
    lines.push('===== 官方博客 =====');
    for (const p of blogs) {
      lines.push(`## ${p.title || '(无标题)'} — ${p.name || ''}${p.author ? ` / ${p.author}` : ''}`);
      lines.push(`  url: ${p.url || ''}`);
      const body = p.content || p.summary || p.excerpt || '';
      if (body) lines.push(`  正文节选: ${clip(body, LIMITS.blogChars)}`);
      lines.push('');
    }
  }

  // 播客
  const podcasts = (data.podcasts || []).slice(0, LIMITS.podcasts);
  if (podcasts.length) {
    lines.push('===== 播客 =====');
    for (const p of podcasts) {
      lines.push(`## ${p.title || '(无标题)'} — ${p.name || ''}`);
      lines.push(`  url: ${p.url || ''}`);
      if (p.transcript) lines.push(`  转写稿节选: ${clip(p.transcript, LIMITS.transcriptChars)}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// -- 提示词 ------------------------------------------------------------------
const SYSTEM_PROMPT = `你是资深 AI 行业分析师，负责把英文的「AI Builders 每日动态」提炼成一份给中文读者看的中文总结。

铁律：
1. 只输出一个 JSON 对象，不要任何解释文字，不要 markdown 代码围栏。
2. 全部内容用简体中文写作。技术术语保留英文原形（AI、LLM、agent、token、prompt、RAG、fine-tuning 等）；人名、公司、产品名一律保留英文。
3. 严禁编造。只能使用输入里出现的事实、观点和链接。输入里没有的内容绝对不要写。
4. 链接只能原样照抄输入里的 url 字段，一个字符都不能改。没有 url 的条目直接丢弃。
5. 不要使用破折号（——）。
6. 语气像一位懂行的朋友在跟你聊，专业但不端着。不要写"据悉""值得一提"这类套话，直接给信息。
7. 每条要点必须具体：谁、做了什么、为什么值得关注。禁止写空泛的概括。

写作标准：
- headline：一句话头条，20 到 40 字，概括今天最值得注意的一件事。
- tldr：3 到 5 条，每条 15 到 40 字，是今天的信息主干，不要和 headline 重复。
- sections[].items[].points：每个人 1 到 3 条，每条 20 到 80 字，讲清他/她说了什么、做了什么。
- role：这个人的身份或所属公司，尽量简短（例如 "Claude @ Anthropic"）。
- 某个板块当天没有新内容，就整个板块不要出现在 sections 里。

输出 JSON 结构（严格遵守）：
{
  "headline": "string",
  "tldr": ["string"],
  "sections": [
    {
      "key": "x | blogs | podcasts",
      "title": "X / 推特",
      "items": [
        {
          "name": "string",
          "role": "string",
          "points": ["string"],
          "url": "string"
        }
      ]
    }
  ]
}`;

function buildUserPrompt(sourceText, todayCn) {
  return `今天是 ${todayCn}。以下是从 follow-builders 中央 feed 抓到的原始内容，请据此产出中文总结 JSON。

${sourceText}`;
}

// -- JSON 解析（带修复） -----------------------------------------------------
// 部分模型（MiniMax M 系列、DeepSeek-R1 等）会把思维链直接写进 content，
// 必须先剥掉，否则 <think> 里出现的花括号会污染 JSON 定位。
function stripThink(text) {
  // 完整配对 <think>…</think>；未闭合的 <think> 则一直删到结尾
  return String(text || '')
    .replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, '')
    .trim();
}

function extractJson(text) {
  let t = stripThink(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  // 先按「第一个 { 到最后一个 }」试
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* 落到下面逐个扫描 */
    }
  }

  // 兜底：从每个 { 起，自后向前收缩右边界，找一个能解析的完整对象
  for (let i = t.indexOf('{'); i !== -1; i = t.indexOf('{', i + 1)) {
    for (let k = t.lastIndexOf('}'); k > i; k = t.lastIndexOf('}', k - 1)) {
      try {
        return JSON.parse(t.slice(i, k + 1));
      } catch {
        /* 继续收缩 */
      }
    }
  }
  throw new Error('未找到可解析的 JSON 对象');
}

// -- 校验与清洗 --------------------------------------------------------------
const SECTION_TITLES = {
  x: 'X / 推特',
  blogs: '官方博客',
  podcasts: '播客',
};

function normalizeSections(sections) {
  const out = [];
  for (const sec of Array.isArray(sections) ? sections : []) {
    const items = [];
    for (const it of Array.isArray(sec.items) ? sec.items : []) {
      const url = String(it.url || '').trim();
      const points = (Array.isArray(it.points) ? it.points : [])
        .map((p) => String(p || '').trim())
        .filter(Boolean);
      const name = String(it.name || '').trim();
      // 没有链接或没有要点或没有名字的条目一律丢弃（宁可少，不可假）
      if (!url.startsWith('http') || !points.length || !name) continue;
      items.push({
        name,
        role: String(it.role || '').trim(),
        points,
        url,
      });
    }
    if (!items.length) continue;
    const key = ['x', 'blogs', 'podcasts'].includes(sec.key) ? sec.key : 'x';
    out.push({ key, title: String(sec.title || SECTION_TITLES[key]).trim(), items });
  }
  return out;
}

function normalizeSummary(parsed, data, todayCn) {
  const sections = normalizeSections(parsed.sections);
  if (!sections.length) throw new Error('LLM 输出里没有任何带链接的有效条目');

  const stats = data.stats || {};
  return {
    date_cn: todayCn,
    headline: String(parsed.headline || '').trim(),
    tldr: (Array.isArray(parsed.tldr) ? parsed.tldr : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 5),
    sections,
    stats: {
      xBuilders: stats.xBuilders || 0,
      totalTweets: stats.totalTweets || 0,
      podcastEpisodes: stats.podcastEpisodes || 0,
      blogPosts: stats.blogPosts || 0,
    },
  };
}

// -- 日期（北京时间） --------------------------------------------------------
function todayCn() {
  const now = new Date();
  // en-CA 固定输出 YYYY-MM-DD，避免各语言 formatToParts 差异
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-');
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'long',
  }).format(now);
  return `${y}年${m}月${d}日 ${weekday}`;
}

// -- 主流程 ------------------------------------------------------------------
async function summarizeWithRetry(provider, messages) {
  let lastErr;
  // 留 5 次：参数降级本身也要占用次数（thinking / max_tokens / json 模式各一次）
  for (let attempt = 1; attempt <= 5; attempt++) {
    // 前两次尝试走 JSON 模式；第三次起或已被拒绝则关掉，兼容不支持该参数的接口
    const useJsonMode = attempt <= 2 && !JSON_MODE_REJECTED;
    try {
      const content = await chat(provider, messages, useJsonMode);
      return extractJson(content);
    } catch (err) {
      lastErr = err;
      let retryNow = false;

      // 接口不认 thinking（关思维链）→ 记下来，立刻去掉该参数重试
      if (!THINKING_REJECTED && /thinking|reasoning_effort|reasoning/i.test(err.message)) {
        console.error('[summarize] 该接口不接受 thinking 参数，去掉后重试');
        THINKING_REJECTED = true;
        retryNow = true;
      }

      // 接口不认 max_tokens 的取值 → 去掉该参数重试
      if (MAX_TOKENS > 0 && /max_?tokens|maximum context|too large/i.test(err.message)) {
        console.error('[summarize] 该接口不接受该 max_tokens，去掉后重试');
        MAX_TOKENS = 0;
        retryNow = true;
      }

      // 接口不认 response_format → 关掉 json 模式重试
      if (!JSON_MODE_REJECTED && /response_format|json_object|json mode/i.test(err.message)) {
        console.error('[summarize] 该接口不支持 JSON 模式，关闭后重试');
        JSON_MODE_REJECTED = true;
        retryNow = true;
      }

      console.error(`[summarize] 第 ${attempt} 次尝试失败：${err.message}`);
      if (retryNow) continue;
      // 参数类错误重试无意义，直接抛出
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) break;
      if (attempt < 5) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) throw new Error('stdin 为空');

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`digest JSON 解析失败：${e.message}`);
  }
  if (data.status === 'error') throw new Error(`上游 prepare-digest 报错：${data.message}`);

  const stats = data.stats || {};
  if (!stats.totalTweets && !stats.podcastEpisodes && !stats.blogPosts) {
    console.error('[summarize] 今天没有新内容，跳过');
    console.log(JSON.stringify({ skipped: true, reason: 'no-new-content' }));
    return;
  }

  const dateCn = todayCn();
  const sourceText = buildSourceText(data);
  console.error(`[summarize] 送入模型的原始文本 ${sourceText.length} 字符`);

  const provider = resolveProvider();
  console.error(`[summarize] LLM: ${provider.name} · model=${provider.model}`);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(sourceText, dateCn) },
  ];

  const parsed = await summarizeWithRetry(provider, messages);
  const summary = normalizeSummary(parsed, data, dateCn);

  console.error(
    `[summarize] 完成：${summary.sections.length} 个板块 · ` +
      `${summary.sections.reduce((n, s) => n + s.items.length, 0)} 条动态 · ` +
      `tldr ${summary.tldr.length} 条`,
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`[summarize] FAIL: ${err.message}`);
  process.exit(1);
});
