#!/usr/bin/env node
// Format the prepare-digest.js JSON output into a clean markdown digest.
// Note: without an LLM in the loop, summaries are just the raw tweet text
// grouped per builder — readable but not as polished as an interactive remix.

const fs = require('fs');

function escapeMd(s) {
  if (!s) return '';
  // Keep it simple; the markdown we emit is wrapped into a post JSON later
  return s;
}

function formatTweet(t) {
  const text = (t.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  let out = '';
  if (text.length > 280) {
    out += text.slice(0, 280).trim() + '…';
  } else {
    out += text;
  }
  if (t.url) out += `\n${t.url}`;
  return out;
}

function formatBuilder(b) {
  const tweets = (b.tweets || []).map(formatTweet).filter(Boolean);
  if (tweets.length === 0) return null;

  let header;
  if (b.bio) {
    header = `**${b.name}** — ${b.bio.replace(/^@\w+\s*/g, '').trim()}`;
  } else {
    header = `**${b.name}**`;
  }

  return header + '\n\n' + tweets.map((t, i) => `${i > 0 ? '\n' : ''}${t}`).join('\n\n');
}

function formatPodcast(p) {
  if (!p) return null;
  let out = `**${p.title}** — ${p.name}\n${p.url || ''}`;
  // Include transcript length so reader can decide whether to dig in
  if (p.transcript) {
    out += `\n\n_~${Math.round(p.transcript.length / 1000)}k chars of transcript — listen at the link._`;
  }
  return out;
}

function main() {
  const raw = fs.readFileSync(0, 'utf-8');
  if (!raw.trim()) {
    console.log('No content.');
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.log('Failed to parse digest JSON: ' + e.message);
    process.exit(1);
  }

  const stats = data.stats || {};
  const podcastEpisodes = stats.podcastEpisodes || 0;
  const xBuilders = stats.xBuilders || 0;
  const totalTweets = stats.totalTweets || 0;

  if (podcastEpisodes === 0 && xBuilders === 0) {
    console.log('No new updates today.');
    return;
  }

  // Date in user's preferred timezone (UTC here, GitHub Actions timezone)
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Shanghai',
  });

  const lines = [];
  lines.push(`# AI Builders Digest — ${today}`);
  lines.push('');

  if (xBuilders > 0) {
    lines.push('## X / TWITTER');
    lines.push('');
    for (const b of (data.x || [])) {
      const block = formatBuilder(b);
      if (block) {
        lines.push(block);
        lines.push('');
      }
    }
  }

  if (podcastEpisodes > 0 && data.podcasts && data.podcasts[0]) {
    lines.push('## PODCASTS');
    lines.push('');
    lines.push(formatPodcast(data.podcasts[0]));
    lines.push('');
  }

  lines.push('---');
  lines.push(`_Auto-generated via [follow-builders](https://github.com/zarazhangrui/follow-builders). ${xBuilders} builders · ${totalTweets} tweets · ${podcastEpisodes} podcast._`);
  lines.push('');

  console.log(lines.join('\n'));
}

main();