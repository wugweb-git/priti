#!/usr/bin/env node
/**
 * enrich-meta.mjs — add real, dated engagement metadata to media.json.
 *
 *   node scripts/enrich-meta.mjs            # every Instagram item
 *   node scripts/enrich-meta.mjs --only sila
 *
 * fetch-meta.mjs caches thumbnails. This script does the other half: it reads
 * the numbers Instagram already publishes in the page's own meta description,
 * which it serves to link-preview crawlers:
 *
 *   post / reel   "121 likes, 12 comments - silaleisure on March 3, 2026: "…""
 *   profile       "46K Followers, 289 Following, 2,130 Posts - See Instagram…"
 *
 * What gets written, per item:
 *   metrics      { likes, comments }                 posts and reels
 *                { followers, following, posts }     profiles
 *                Each value is kept as the string Instagram printed ("12K"),
 *                because that is the claim it makes — parsing "12K" to 12000
 *                would invent precision it does not have.
 *   publishedAt  ISO date, from "on March 3, 2026"   posts and reels only
 *   caption      recovered from og:title when the item has none yet
 *   metricsSource 'instagram-meta'
 *   capturedAt   when this run read the numbers
 *
 * Nothing is guessed. A field Instagram did not print stays absent, and the
 * previous run's values are kept if a request fails — a failed fetch never
 * blanks known data.
 *
 * These are live platform counts. They are a different claim from the
 * self-reported portfolio figures in the Receipts, and the page shows them
 * separately, with their capture date.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DB = path.join(ROOT, 'media.json');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const UA = 'facebookexternalhit/1.1';
const PAUSE_MS = 900;

const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7,
  august:8, september:9, october:10, november:11, december:12 };

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const meta = (html, attr, key) =>
  html.match(new RegExp(`<meta\\s+${attr}=["']${key}["']\\s+content=["']([^"']*)["']`, 'i'))?.[1];

/** "121 likes, 12 comments - handle on March 3, 2026: "…"" */
function parsePost(desc) {
  const d = decode(desc);
  const out = {};
  const likes = d.match(/^([\d.,]+[KMB]?)\s+likes?\b/i)?.[1];
  const comments = d.match(/,\s*([\d.,]+[KMB]?)\s+comments?\b/i)?.[1];
  if (likes) out.likes = likes;
  if (comments) out.comments = comments;
  const date = d.match(/\bon\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  let publishedAt = null;
  if (date && MONTHS[date[1].toLowerCase()]) {
    const mm = String(MONTHS[date[1].toLowerCase()]).padStart(2, '0');
    publishedAt = `${date[3]}-${mm}-${date[2].padStart(2, '0')}`;
  }
  return { metrics: Object.keys(out).length ? out : null, publishedAt };
}

/** "46K Followers, 289 Following, 2,130 Posts - …" */
function parseProfile(desc) {
  const d = decode(desc);
  const out = {};
  const f = d.match(/([\d.,]+[KMB]?)\s+Followers/i)?.[1];
  const g = d.match(/([\d.,]+[KMB]?)\s+Following/i)?.[1];
  const p = d.match(/([\d.,]+[KMB]?)\s+Posts/i)?.[1];
  if (f) out.followers = f;
  if (g) out.following = g;
  if (p) out.posts = p;
  return Object.keys(out).length ? out : null;
}

/** 'ACCOUNT on Instagram: "caption"' -> caption, or '' if not that shape. */
function captionFromTitle(t) {
  const m = decode(t || '').trim().match(/^.*? on Instagram:\s*["“”](.*)["“”]\s*$/s);
  return m ? m[1].trim() : '';
}

const db = JSON.parse(await readFile(DB, 'utf8'));
const now = new Date().toISOString();
let ok = 0, failed = 0, captions = 0;

for (const item of db.items) {
  if (item.platform !== 'instagram') continue;
  if (ONLY && item.section !== ONLY) continue;

  const url = item.kind === 'profile'
    ? `https://www.instagram.com/${item.shortcode}/`
    : item.url;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const desc = meta(html, 'name', 'description') || meta(html, 'property', 'og:description');
    if (!desc) throw new Error('no description meta');

    if (item.kind === 'profile') {
      const m = parseProfile(desc);
      if (!m) throw new Error('profile counts not found');
      item.metrics = m;
    } else {
      const { metrics, publishedAt } = parsePost(desc);
      if (!metrics && !publishedAt) throw new Error('post counts not found');
      if (metrics) item.metrics = metrics;
      if (publishedAt) item.publishedAt = publishedAt;
      if (!item.caption) {
        const cap = captionFromTitle(meta(html, 'property', 'og:title'));
        if (cap) { item.caption = cap; item.title = ''; captions++; }
      }
    }
    item.metricsSource = 'instagram-meta';
    item.capturedAt = now;
    ok++;
    console.log(`✓ ${item.id.padEnd(16)} ${JSON.stringify(item.metrics)}${item.publishedAt ? '  ' + item.publishedAt : ''}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${item.id.padEnd(16)} ${e.message} — previous values kept`);
  }
  await new Promise(res => setTimeout(res, PAUSE_MS));
}

db._schema.generatedAt = now;
await writeFile(DB, JSON.stringify(db, null, 2) + '\n');
console.log(`\nenriched ${ok} · failed ${failed} · captions recovered ${captions}`);
console.log('Run node scripts/normalize-media.mjs next to trim titles and re-render the pages.');
