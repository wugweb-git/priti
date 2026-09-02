#!/usr/bin/env node
/**
 * fetch-meta.mjs — populate media.json thumbnails, and CACHE THEM LOCALLY.
 *
 * Design rule: the site must never depend on a live Instagram CDN URL.
 * Instagram's og:image / thumbnail_url values are signed and expire (hours to days).
 * So this script always downloads the bytes to assets/thumbs/ and writes the
 * LOCAL path into media.json. The remote URL is kept only in `_sourceUrl` for audit.
 *
 * Resolution priority (falls through on failure):
 *   1. Instagram Graph API      — official, reliable. Needs IG_ACCESS_TOKEN.
 *   2. Instagram oEmbed         — official. Needs IG_ACCESS_TOKEN (app token) too.
 *   3. Public og:image scrape   — best effort. IG blocks unauthenticated UAs most of the time.
 *   4. Manual                   — leave status "needs_thumbnail"; drop a file in
 *                                 assets/thumbs/ig-<shortcode>.jpg and re-run --rescan.
 *
 * Usage:
 *   node scripts/fetch-meta.mjs            # try 1 -> 2 -> 3 for every needs_thumbnail item
 *   node scripts/fetch-meta.mjs --rescan   # no network: just mark items whose local file now exists
 *   node scripts/fetch-meta.mjs --only sila
 *
 * Env:
 *   IG_ACCESS_TOKEN   Meta app / IG Graph token (required for steps 1 & 2)
 *   IG_USER_ID        IG Business/Creator account id (required for step 1)
 */

import { readFile, writeFile, mkdir, access, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DB = path.join(ROOT, 'media.json');
const THUMBS = path.join(ROOT, 'assets', 'thumbs');
const TOKEN = process.env.IG_ACCESS_TOKEN || '';
const IG_USER_ID = process.env.IG_USER_ID || '';

const args = process.argv.slice(2);
const RESCAN_ONLY = args.includes('--rescan');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const exists = (p) => access(p).then(() => true, () => false);
const log = (...a) => console.log(...a);

/* ---------- 1. Instagram Graph API -------------------------------------- */
/* Returns the media_url/thumbnail_url for a shortcode owned by IG_USER_ID.
   Graph has no "lookup by shortcode" endpoint, so we page the account's media
   once and build a shortcode -> media map from each item's permalink.        */
let graphIndex = null;
async function buildGraphIndex() {
  if (graphIndex !== null) return graphIndex;
  if (!TOKEN || !IG_USER_ID) return (graphIndex = new Map());
  const map = new Map();
  let url = `https://graph.facebook.com/v21.0/${IG_USER_ID}/media`
    + `?fields=id,permalink,media_type,media_url,thumbnail_url,caption,timestamp`
    + `&limit=100&access_token=${TOKEN}`;
  try {
    while (url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`graph ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      for (const m of j.data || []) {
        const sc = (m.permalink || '').match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1];
        if (sc) map.set(sc, m);
      }
      url = j.paging?.next || null;
    }
    log(`  [graph] indexed ${map.size} media items`);
  } catch (e) {
    log(`  [graph] unavailable — ${e.message}`);
  }
  return (graphIndex = map);
}

async function viaGraph(item) {
  const idx = await buildGraphIndex();
  const m = idx.get(item.shortcode);
  if (!m) return null;
  const src = m.thumbnail_url || m.media_url;
  if (!src) return null;
  return { src, title: (m.caption || '').split('\n')[0].slice(0, 140), via: 'graph' };
}

/* ---------- 2. Official oEmbed ------------------------------------------ */
async function viaOembed(item) {
  if (!TOKEN) return null;
  const u = `https://graph.facebook.com/v21.0/instagram_oembed`
    + `?url=${encodeURIComponent(item.url)}&fields=thumbnail_url,author_name,title&access_token=${TOKEN}`;
  try {
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.thumbnail_url) return null;
    return { src: j.thumbnail_url, title: j.title || '', author: j.author_name || '', via: 'oembed' };
  } catch { return null; }
}

/* ---------- 2b. YouTube oEmbed (no token needed) ------------------------ */
async function viaYouTube(item) {
  const u = `https://www.youtube.com/oembed?url=${encodeURIComponent(item.url)}&format=json`;
  try {
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    const hi = `https://i.ytimg.com/vi/${item.shortcode}/maxresdefault.jpg`;
    return { src: hi, fallbackSrc: j.thumbnail_url, title: j.title, author: j.author_name, via: 'yt-oembed' };
  } catch { return null; }
}

/* ---------- 3. Public og:image scrape ----------------------------------- */
async function viaOpenGraph(item) {
  for (const target of [item.url, item.url.replace(/\/$/, '') + '/embed/captioned/']) {
    try {
      const r = await fetch(target, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
      if (!r.ok) continue;
      const html = await r.text();
      const og = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1]
        || html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i)?.[1]
        || html.match(/"display_url":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, '&');
      if (!og) continue;
      const title = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] || '';
      return { src: og.replace(/&amp;/g, '&'), title, via: 'og' };
    } catch { /* next */ }
  }
  return null;
}

/* ---------- download + cache -------------------------------------------- */
async function cache(src, destAbs) {
  const r = await fetch(src, { headers: { 'User-Agent': UA, Referer: 'https://www.instagram.com/' } });
  if (!r.ok) throw new Error(`download ${r.status}`);
  await mkdir(path.dirname(destAbs), { recursive: true });
  await pipeline(Readable.fromWeb(r.body), createWriteStream(destAbs));
  const { size } = await stat(destAbs);
  if (size < 1024) throw new Error(`suspiciously small (${size}b)`);
  return size;
}

/* ---------- main --------------------------------------------------------- */
const db = JSON.parse(await readFile(DB, 'utf8'));
await mkdir(THUMBS, { recursive: true });

let filled = 0, rescanned = 0, failed = 0;

for (const item of db.items) {
  if (ONLY && item.section !== ONLY) continue;
  const destAbs = path.join(ROOT, item.thumbnail);

  // Manual drop-in wins: if the file is on disk, mark available and move on.
  if (await exists(destAbs)) {
    if (item.status !== 'available') {
      item.status = 'available';
      item.fetchedAt = new Date().toISOString();
      rescanned++;
      log(`✓ ${item.id} — local file found, marked available`);
    }
    continue;
  }
  if (RESCAN_ONLY) continue;

  log(`· ${item.id} (${item.platform}/${item.kind} ${item.shortcode})`);
  const chain = item.platform === 'youtube'
    ? [viaYouTube]
    : [viaGraph, viaOembed, viaOpenGraph];

  let done = false;
  for (const step of chain) {
    const meta = await step(item);
    if (!meta) continue;
    for (const src of [meta.src, meta.fallbackSrc].filter(Boolean)) {
      try {
        const size = await cache(src, destAbs);
        item.status = 'available';
        item.fetchedAt = new Date().toISOString();
        item._sourceUrl = src;          // audit only — never rendered
        item._via = meta.via;
        if (meta.title && !item.title) item.title = meta.title;
        if (meta.author) item.author = meta.author;
        log(`  ✓ cached via ${meta.via} (${(size / 1024) | 0}kb)`);
        filled++; done = true; break;
      } catch (e) { log(`  ✗ ${meta.via}: ${e.message}`); }
    }
    if (done) break;
  }
  if (!done) {
    failed++;
    log(`  → still needs_thumbnail. Drop a file at ${item.thumbnail} and run --rescan.`);
  }
}

db._schema.generatedAt = new Date().toISOString();
await writeFile(DB, JSON.stringify(db, null, 2) + '\n');

log(`\ncached ${filled} · adopted ${rescanned} local file(s) · ${failed} still manual`);
if (failed && !TOKEN) {
  log('\nInstagram needs auth. Set IG_ACCESS_TOKEN (and IG_USER_ID for the Graph path):');
  log('  https://developers.facebook.com/docs/instagram-platform/instagram-graph-api');
  log('Until then, screenshot each reel cover into assets/thumbs/ig-<shortcode>.jpg and run --rescan.');
}
