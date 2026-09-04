#!/usr/bin/env node
// Send the formatted digest to Lark via OpenAPI (bot identity).
// Required env: LARK_APP_ID, LARK_APP_SECRET, LARK_USER_OPEN_ID

const fs = require('fs');

const APP_ID = process.env.LARK_APP_ID;
const APP_SECRET = process.env.LARK_APP_SECRET;
const USER_OPEN_ID = process.env.LARK_USER_OPEN_ID;

if (!APP_ID || !APP_SECRET || !USER_OPEN_ID) {
  console.error('Missing one of: LARK_APP_ID, LARK_APP_SECRET, LARK_USER_OPEN_ID');
  process.exit(2);
}

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

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

// Convert markdown lines to a flat list of post elements. We send everything as
// a sequence of md text blocks. H1 → H4, H2 → H5 per Lark post normalization.
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

async function sendMessage(token, text) {
  const elements = markdownToPostElements(text);
  // The `content` field must be a JSON-encoded STRING, not a nested object.
  // See https://open.feishu.cn/document/server-docs/im-v1/message/create
  const contentStr = JSON.stringify({
    zh_cn: { content: elements.map((el) => [el]) },
  });
  const res = await fetch(`${FEISHU_BASE}/im/v1/messages?receive_id_type=open_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: USER_OPEN_ID,
      msg_type: 'post',
      content: contentStr,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`im/v1/messages failed: ${data.code} ${data.msg}`);
  }
  return data.data;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: send-lark.js <markdown-file>');
    process.exit(2);
  }
  const text = fs.readFileSync(file, 'utf-8').trim();
  if (!text || text === 'No new updates today.' || text === 'No content.') {
    console.log('skipped: empty digest');
    return;
  }

  console.log('getting tenant_access_token...');
  const token = await getTenantAccessToken();
  console.log('sending message...');
  const result = await sendMessage(token, text);
  console.log(`OK message_id=${result.message_id} chat_id=${result.chat_id}`);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});