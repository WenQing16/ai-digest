#!/usr/bin/env node
// ============================================================================
// AI Builders Digest — Send to Lark
// ============================================================================
// 两种模式：
//
//   1) 图片模式（默认，主链路）
//      node scripts/send-lark.js <digest.png> [summary.json]
//      - 先调 im/v1/images 上传图片拿 image_key
//      - 再以 msg_type=image 发到你的飞书私聊
//      - 若给了 summary.json，会再补发一条「原文链接」清单
//        （图片里的链接点不了，这条负责可点击跳转）
//
//   2) 文本模式（降级链路，LLM 不可用时使用）
//      node scripts/send-lark.js --text <file.md>
//      node scripts/send-lark.js --text -        # 从 stdin 读
//
// 必需环境变量：LARK_APP_ID, LARK_APP_SECRET, LARK_USER_OPEN_ID
// ============================================================================

const fs = require('fs');

const APP_ID = process.env.LARK_APP_ID;
const APP_SECRET = process.env.LARK_APP_SECRET;
const USER_OPEN_ID = process.env.LARK_USER_OPEN_ID;

if (!APP_ID || !APP_SECRET || !USER_OPEN_ID) {
  console.error('Missing one of: LARK_APP_ID, LARK_APP_SECRET, LARK_USER_OPEN_ID');
  process.exit(2);
}

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 飞书图片消息上限

// -- 鉴权 --------------------------------------------------------------------
async function getTenantAccessToken() {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`tenant_access_token failed: ${data.code} ${data.msg}`);
  }
  return data.tenant_access_token;
}

// -- 发消息（通用） ----------------------------------------------------------
async function sendMessage(token, msgType, content) {
  const res = await fetch(`${FEISHU_BASE}/im/v1/messages?receive_id_type=open_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: USER_OPEN_ID,
      msg_type: msgType,
      // content 必须是 JSON 字符串，不是嵌套对象
      // https://open.feishu.cn/document/server-docs/im-v1/message/create
      content: JSON.stringify(content),
    }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`im/v1/messages(${msgType}) failed: ${data.code} ${data.msg}`);
  }
  return data.data;
}

// -- 上传图片 ----------------------------------------------------------------
async function uploadImage(token, filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `图片 ${(buf.length / 1024 / 1024).toFixed(1)}MB 超过飞书 10MB 限制，请调小渲染尺寸`,
    );
  }

  const ext = filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')
    ? 'image/jpeg'
    : 'image/png';

  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([buf], { type: ext }), filePath.split(/[\\/]/).pop());

  const res = await fetch(`${FEISHU_BASE}/im/v1/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`im/v1/images failed: ${data.code} ${data.msg}`);
  }
  return data.data.image_key;
}

// -- markdown → 飞书 post 元素 -----------------------------------------------
function markdownToPostElements(md) {
  const lines = md.split('\n');
  const elements = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) {
      elements.push({ tag: 'md', text: buffer.join('\n') });
      buffer = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith('# ')) {
      flush();
      elements.push({ tag: 'md', text: '#### ' + line.slice(2) });
    } else if (line.startsWith('## ')) {
      flush();
      elements.push({ tag: 'md', text: '##### ' + line.slice(3) });
    } else if (line.trim() === '---') {
      flush();
      elements.push({ tag: 'hr' });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return elements;
}

// -- 从中文总结生成「原文链接」清单 ------------------------------------------
function buildLinksMarkdown(summary) {
  const lines = ['**📎 今日原文链接（图片中点不了，这里可跳转）**', ''];
  for (const sec of summary.sections || []) {
    const items = sec.items || [];
    if (!items.length) continue;
    lines.push(`**${sec.title}**`);
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.name}${it.role ? `（${it.role}）` : ''}`);
      lines.push(`${it.url}`);
    });
    lines.push('');
  }
  lines.push('— 由 follow-builders 自动生成 · https://github.com/zarazhangrui/follow-builders');
  return lines.join('\n');
}

// -- 主流程 ------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const isTextMode = argv[0] === '--text';

  let text = '';
  let imagePath = '';
  let summaryPath = '';

  if (isTextMode) {
    const src = argv[1];
    if (!src) {
      console.error('用法: node scripts/send-lark.js --text <file.md|->');
      process.exit(2);
    }
    text = src === '-' ? fs.readFileSync(0, 'utf-8') : fs.readFileSync(src, 'utf-8');
    text = text.trim();
    if (!text || text === 'No new updates today.' || text === 'No content.') {
      console.log('skipped: empty digest');
      return;
    }
  } else {
    imagePath = argv[0];
    summaryPath = argv[1];
    if (!imagePath) {
      console.error('用法: node scripts/send-lark.js <digest.png> [summary.json]');
      process.exit(2);
    }
    if (!fs.existsSync(imagePath)) {
      console.error(`找不到图片：${imagePath}`);
      process.exit(1);
    }
  }

  console.log('getting tenant_access_token...');
  const token = await getTenantAccessToken();

  if (isTextMode) {
    console.log('sending text message...');
    const result = await sendMessage(token, 'post', {
      zh_cn: { content: markdownToPostElements(text).map((el) => [el]) },
    });
    console.log(`OK message_id=${result.message_id} chat_id=${result.chat_id}`);
    return;
  }

  // 1) 上传并发送图片
  console.log(`uploading image ${imagePath} ...`);
  const imageKey = await uploadImage(token, imagePath);
  console.log(`image_key=${imageKey}`);
  const imgResult = await sendMessage(token, 'image', { image_key: imageKey });
  console.log(`OK image message_id=${imgResult.message_id} chat_id=${imgResult.chat_id}`);

  // 2) 补一条原文链接清单
  if (summaryPath && fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    const md = buildLinksMarkdown(summary);
    if (md.trim()) {
      console.log('sending links message...');
      const linksResult = await sendMessage(token, 'post', {
        zh_cn: { content: markdownToPostElements(md).map((el) => [el]) },
      });
      console.log(`OK links message_id=${linksResult.message_id}`);
    }
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
