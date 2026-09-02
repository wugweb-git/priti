#!/usr/bin/env node
/**
 * Normalises what fetch-meta.mjs pulled from Instagram's og: tags, then syncs
 * the inlined copy of the data inside index.html.
 *
 *   node scripts/normalize-media.mjs
 *
 * Instagram's og:title is the whole post — 'ACCOUNT on Instagram: "<caption>"'
 * — with HTML entities still encoded. That is far too long for a card and
 * renders as mojibake if used raw. So:
 *
 *   caption  full decoded caption, kept for the lightbox and for the record
 *   title    a short display line for the card, cut on a word boundary
 *
 * Nothing is invented. Both fields come from the fetched tag; when there is no
 * caption to read, both stay empty and the card falls back to the brand name.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DB = path.join(ROOT, 'media.json');
const HTML = path.join(ROOT, 'index.html');

const TITLE_MAX = 84;

/** Decode the numeric and named entities Instagram leaves in og: tags. */
function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** 'ACCOUNT on Instagram: "caption"' -> caption. Leaves anything else alone. */
function extractCaption(raw) {
  const s = decode(raw).trim();
  const m = s.match(/^.*? on Instagram:\s*["""](.*)[""']\s*$/s);
  return (m ? m[1] : s).trim();
}

/** First meaningful line, trimmed to a word boundary, hashtag tail dropped. */
function displayTitle(caption) {
  if (!caption) return '';
  let line = caption.split('\n').map(l => l.trim())
    .find(l => l && !l.startsWith('#')) || '';
  line = line.replace(/\s*#[\w.]+/g, '').replace(/\s+/g, ' ').trim();
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : TITLE_MAX).trim() + '…';
}

const db = JSON.parse(await readFile(DB, 'utf8'));

let captioned = 0;
for (const it of db.items) {
  if (it.platform === 'youtube') {
    it.title = decode(it.title || '');
    it.caption = it.caption || '';
    continue;
  }
  // A profile's og:title is just the account name — a label, not a caption.
  if (it.kind === 'profile') {
    it.caption = '';
    it.title = '';
    continue;
  }
  const caption = extractCaption(it.title || '');
  it.caption = caption;
  it.title = displayTitle(caption);
  if (caption) captioned++;
}

db._schema.generatedAt = new Date().toISOString();
await writeFile(DB, JSON.stringify(db, null, 2) + '\n');

/* ---- sync the inlined copy in index.html -------------------------------- */
const html = await readFile(HTML, 'utf8');
const start = html.indexOf('const MEDIA = [');
const end = html.indexOf('];', start);
if (start === -1 || end === -1) {
  console.error('Could not find `const MEDIA = [ ... ];` in index.html — media.json written, HTML untouched.');
  process.exit(1);
}

// Keep only what the page actually renders; drop the fetch bookkeeping.
const slim = db.items.map(i => ({
  id: i.id, brand: i.brand, section: i.section, platform: i.platform,
  kind: i.kind, shortcode: i.shortcode, url: i.url, thumbnail: i.thumbnail,
  title: i.title, caption: i.caption, ratio: i.ratio, status: i.status,
}));

const block = 'const MEDIA = [\n' + slim.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n';
await writeFile(HTML, html.slice(0, start) + block + html.slice(end), 'utf8');

console.log(`normalised ${db.items.length} items · ${captioned} captions decoded`);
console.log('media.json rewritten and index.html MEDIA block synced.');
