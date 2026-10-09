#!/usr/bin/env node
// ============================================================================
// AI Builders Digest — Render Image
// ============================================================================
// 输入：summarize.js 输出的中文总结 JSON
// 输出：一张 1080px 宽的手机友好长图（PNG）
//
// 用法：
//   node scripts/render-image.js summary.json digest.png
//   node scripts/render-image.js summary.json digest.html    # 只出 HTML，方便调版式
//
// 设计要点：
//   - 宽 1080 CSS px，接近主流手机屏幕物理宽度，缩放后依然清晰
//   - 自动测量内容高度，据此挑选 deviceScaleFactor，
//     保证最终像素高度不超 Chrome 截图上限（16384px）且文件不超飞书 10MB
//   - 中文字体优先 Noto Sans CJK（Actions 里 apt 装 fonts-noto-cjk）
// ============================================================================

const fs = require('fs');
const path = require('path');

const PAGE_WIDTH = 1080;
const MAX_PIXEL_HEIGHT = 15000; // 留足余量，Chrome 上限 16384
const MAX_PIXEL_WIDTH = 2160;
const MAX_FILE_BYTES = 9.5 * 1024 * 1024; // 飞书图片消息上限 10MB

// -- 工具 --------------------------------------------------------------------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/$/, '');
    const tail = p.length > 28 ? p.slice(0, 28) + '…' : p;
    return (u.hostname + tail).replace(/^www\./, '');
  } catch {
    return String(url || '');
  }
}

const SECTION_META = {
  x: { color: '#1d9bf0' },
  blogs: { color: '#10a37f' },
  podcasts: { color: '#f97316' },
};

// -- HTML 模板 ---------------------------------------------------------------
function renderHtml(summary) {
  const sections = Array.isArray(summary.sections) ? summary.sections : [];
  const tldr = Array.isArray(summary.tldr) ? summary.tldr : [];
  const stats = summary.stats || {};

  const sectionHtml = sections
    .map((sec) => {
      const meta = SECTION_META[sec.key] || SECTION_META.x;
      const items = (sec.items || [])
        .map((it) => {
          const points = (it.points || [])
            .map((p) => `<li>${escapeHtml(p)}</li>`)
            .join('');
          return `
        <div class="item" style="border-left-color:${meta.color}33">
          <div class="item-head">
            <span class="name">${escapeHtml(it.name)}</span>
            ${it.role ? `<span class="role">${escapeHtml(it.role)}</span>` : ''}
          </div>
          <ul class="points">${points}</ul>
          <div class="src">🔗 ${escapeHtml(shortUrl(it.url))}</div>
        </div>`;
        })
        .join('');
      return `
      <div class="section">
        <div class="section-head">
          <span class="dot" style="background:${meta.color}"></span>
          <span class="section-title">${escapeHtml(sec.title)}</span>
          <span class="section-count">${(sec.items || []).length} 条</span>
        </div>${items}
      </div>`;
    })
    .join('');

  const tldrHtml = tldr.length
    ? `
      <div class="tldr">
        <div class="tldr-title">今日要点</div>
        <ol class="tldr-list">
          ${tldr.map((t) => `<li><span>${escapeHtml(t)}</span></li>`).join('')}
        </ol>
      </div>`
    : '';

  const statLine = [
    stats.xBuilders ? `${stats.xBuilders} 位博主` : null,
    stats.totalTweets ? `${stats.totalTweets} 条推文` : null,
    stats.blogPosts ? `${stats.blogPosts} 篇博客` : null,
    stats.podcastEpisodes ? `${stats.podcastEpisodes} 期播客` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #ffffff; }
  body {
    width: ${PAGE_WIDTH}px;
    font-family: 'Noto Sans SC', 'Noto Sans CJK SC', 'Source Han Sans SC',
                 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei',
                 'WenQuanYi Micro Hei', sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    color: #0f172a;
  }
  .page { width: ${PAGE_WIDTH}px; background: #ffffff; padding-bottom: 8px; }
  .accent { height: 12px; background: linear-gradient(90deg, #2f6bff 0%, #7c3aed 50%, #06b6d4 100%); }

  .head { padding: 46px 56px 0; }
  .kicker { font-size: 21px; font-weight: 700; letter-spacing: 3px; color: #2f6bff; }
  h1 { font-size: 54px; line-height: 1.22; font-weight: 800; margin-top: 18px; letter-spacing: -0.5px; }
  .date { font-size: 24px; color: #64748b; margin-top: 16px; }

  .headline-card {
    margin: 34px 56px 0; padding: 34px 38px;
    background: linear-gradient(135deg, #eef4ff 0%, #f6f1ff 100%);
    border: 2px solid #dbe6ff; border-radius: 26px;
  }
  .headline-label { font-size: 22px; font-weight: 700; color: #2f6bff; letter-spacing: 1px; }
  .headline-text { font-size: 37px; line-height: 1.5; font-weight: 700; color: #111827; margin-top: 16px; }

  .tldr {
    margin: 26px 56px 0; padding: 32px 38px;
    background: #ffffff; border: 2px solid #e6eaf2; border-radius: 26px;
  }
  .tldr-title { font-size: 27px; font-weight: 800; color: #0f172a; }
  .tldr-list { list-style: none; counter-reset: tl; margin-top: 20px; }
  .tldr-list li {
    counter-increment: tl; display: flex; gap: 18px; align-items: flex-start;
    font-size: 28px; line-height: 1.6; color: #1f2937; margin-top: 18px;
  }
  .tldr-list li:first-child { margin-top: 0; }
  .tldr-list li::before {
    content: counter(tl); flex: 0 0 auto;
    width: 40px; height: 40px; border-radius: 12px; margin-top: 3px;
    background: #2f6bff; color: #fff; font-size: 22px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }

  .section { margin: 50px 56px 0; }
  .section-head { display: flex; align-items: center; gap: 16px; }
  .dot { width: 16px; height: 16px; border-radius: 50%; flex: 0 0 auto; }
  .section-title { font-size: 35px; font-weight: 800; color: #0f172a; }
  .section-count { font-size: 22px; color: #94a3b8; margin-left: 4px; }

  .item {
    margin-top: 24px; padding: 30px 34px;
    background: #fafbfd; border-radius: 20px; border-left: 8px solid #dfe6f3;
  }
  .item-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  .name { font-size: 31px; font-weight: 700; color: #0f172a; }
  .role { font-size: 22px; color: #64748b; }
  .points { list-style: none; margin-top: 6px; }
  .points li {
    position: relative; padding-left: 26px;
    font-size: 27px; line-height: 1.62; color: #334155; margin-top: 16px;
  }
  .points li::before {
    content: ''; position: absolute; left: 4px; top: 16px;
    width: 10px; height: 10px; border-radius: 3px; background: #94a3b8;
  }
  .src { font-size: 20px; color: #9aa5b8; margin-top: 18px; word-break: break-all; }

  .footer {
    margin: 58px 56px 0; padding: 34px 0 52px;
    border-top: 2px solid #eef1f6; font-size: 22px; line-height: 1.75; color: #94a3b8;
  }
  .footer strong { color: #64748b; font-weight: 700; }
</style>
</head>
<body>
  <div class="page">
    <div class="accent"></div>
    <div class="head">
      <div class="kicker">AI BUILDERS DIGEST</div>
      <h1>AI 圈 · 每日速览</h1>
      <div class="date">${escapeHtml(summary.date_cn || '')}</div>
    </div>

    ${
      summary.headline
        ? `<div class="headline-card">
             <div class="headline-label">今日头条</div>
             <div class="headline-text">${escapeHtml(summary.headline)}</div>
           </div>`
        : ''
    }

    ${tldrHtml}
    ${sectionHtml}

    <div class="footer">
      <strong>本期收录</strong>　${escapeHtml(statLine || '—')}<br>
      内容源自 follow-builders 中央 feed，由 AI 自动翻译并提炼，可能存在误差，请以原文为准。
    </div>
  </div>
</body>
</html>`;
}

// -- 截图 --------------------------------------------------------------------
const COMMON_CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
];

// 依次尝试：环境变量指定 → puppeteer 自带 Chrome → 系统常见安装路径
async function launchBrowser(puppeteer) {
  const attempts = [];
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    attempts.push({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, label: 'env' });
  }
  attempts.push({ executablePath: undefined, label: 'bundled' });
  for (const p of COMMON_CHROME_PATHS) {
    if (fs.existsSync(p)) attempts.push({ executablePath: p, label: p });
  }

  let lastErr;
  for (const a of attempts) {
    try {
      const opts = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
      };
      if (a.executablePath) opts.executablePath = a.executablePath;
      const browser = await puppeteer.launch(opts);
      console.error(`[render] 使用浏览器: ${a.label}`);
      return browser;
    } catch (err) {
      lastErr = err;
      console.error(`[render] 浏览器 ${a.label} 启动失败：${err.message.slice(0, 120)}`);
    }
  }
  throw lastErr || new Error('找不到可用的 Chrome/Chromium');
}

async function renderPng(html, outPath) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    throw new Error('未安装 puppeteer，请先运行 npm install');
  }

  const browser = await launchBrowser(puppeteer);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: PAGE_WIDTH, height: 1200, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    // 等字体就绪，否则中文可能以回退字体截到
    await page.evaluate(() => document.fonts && document.fonts.ready);

    const height = await page.evaluate(
      () => document.querySelector('.page').getBoundingClientRect().height,
    );

    // 根据内容高度挑选缩放比例，兼顾清晰度与截图/文件体积上限
    const scaleForHeight = MAX_PIXEL_HEIGHT / height;
    const scaleForWidth = MAX_PIXEL_WIDTH / PAGE_WIDTH;
    let scale = Math.min(2, scaleForHeight, scaleForWidth);
    if (scale < 0.6) scale = 0.6;

    await page.setViewport({
      width: PAGE_WIDTH,
      height: Math.ceil(height),
      deviceScaleFactor: scale,
    });

    let quality = null;
    await page.screenshot({ path: outPath, fullPage: true, type: 'png' });

    // PNG 过大就退成 JPEG，保证能塞进飞书 10MB 限制
    let size = fs.statSync(outPath).size;
    if (size > MAX_FILE_BYTES) {
      await page.screenshot({ path: outPath, fullPage: true, type: 'jpeg', quality: 88 });
      size = fs.statSync(outPath).size;
      quality = 'jpeg';
    }

    const px = await page.evaluate(() => ({
      w: document.querySelector('.page').getBoundingClientRect().width,
      h: document.querySelector('.page').getBoundingClientRect().height,
    }));

    return {
      cssHeight: Math.round(height),
      scale: Number(scale.toFixed(2)),
      pixelWidth: Math.round(px.w * scale),
      pixelHeight: Math.round(px.h * scale),
      bytes: size,
      format: quality || 'png',
    };
  } finally {
    await browser.close();
  }
}

// -- 主流程 ------------------------------------------------------------------
async function main() {
  const inFile = process.argv[2];
  const outFile = process.argv[3] || 'digest.png';
  if (!inFile) {
    console.error('用法: node scripts/render-image.js <summary.json> <out.png>');
    process.exit(2);
  }

  const summary = JSON.parse(fs.readFileSync(inFile, 'utf-8'));
  if (summary.skipped) {
    console.error(`[render] 内容为空（${summary.reason || 'skipped'}），跳过出图`);
    process.exit(0);
  }

  const html = renderHtml(summary);

  if (outFile.endsWith('.html')) {
    fs.writeFileSync(outFile, html);
    console.error(`[render] 已输出 HTML：${outFile}`);
    return;
  }

  const info = await renderPng(html, outFile);
  console.error(
    `[render] ${path.basename(outFile)} · ${info.pixelWidth}x${info.pixelHeight}px · ` +
      `scale=${info.scale} · ${info.format} · ${(info.bytes / 1024).toFixed(0)} KB`,
  );
}

main().catch((err) => {
  console.error(`[render] FAIL: ${err.message}`);
  process.exit(1);
});
