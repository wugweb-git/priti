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

/**
 * 'ACCOUNT on Instagram: "caption"' -> caption.
 *
 * Returns '' for anything that does not match that shape. Some records still
 * carry a hand-written label from the original link list; promoting one of
 * those to `caption` would present an author's note as fetched platform data,
 * so an unmatched value is discarded rather than passed through.
 */
function extractCaption(raw) {
  const s = decode(raw).trim();
  const m = s.match(/^.*? on Instagram:\s*["“”"](.*)["“”"]\s*$/s);
  return m ? m[1].trim() : '';
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
  // Idempotent: once a caption has been extracted, `title` holds the short
  // display line, not the raw og:title, so re-parsing it would discard the
  // caption. Only parse a record that has not been normalised yet.
  const caption = it.caption ? it.caption : extractCaption(it.title || '');
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
let out = html.slice(0, start) + block + html.slice(end);

/* ---- pre-render the media grids into the HTML --------------------------- */
/* The brief requires the page to work with JavaScript disabled. The grids used
   to be built entirely at runtime, so with JS off every work link vanished.
   Emitting the same markup here means the work is in the document itself; the
   runtime script only adds the lightbox and the broken-image fallback. */

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const TINTS = ['rgba(229,67,43,.10)', 'rgba(240,189,62,.14)', 'rgba(39,67,214,.09)',
               'rgba(240,120,154,.12)', 'rgba(107,107,58,.11)', 'rgba(201,180,140,.16)'];
const tintFor = (s) => TINTS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
const PLAY = '<span class="m-play"><svg viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0l10 6-10 6z"/></svg></span>';

function card(it, showBrand) {
  const isProfile = it.kind === 'profile';
  const platform = it.platform === 'youtube' ? 'YouTube' : 'Instagram';
  const alt = it.title || `${it.brand} — ${platform} ${it.kind}`;
  const shot = it.status === 'available' && it.thumbnail
    ? `<img src="${esc(it.thumbnail)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="640" height="800">${isProfile ? '' : PLAY}`
    : `<div class="m-ph" style="--ph-tint:${tintFor(it.shortcode)}">`
      + `<div class="m-ph-brand">${esc(it.brand)}</div>`
      + (isProfile ? '' : `<div class="m-ph-code">${esc(it.shortcode)}</div>`)
      + `</div>${isProfile ? '' : PLAY}`;

  const caption = it.title || (showBrand ? it.brand : '');
  const foot = `<div class="m-foot">`
    + `<div class="m-kind">${platform} · ${esc(it.kind)}</div>`
    + (caption ? `<div class="m-title">${esc(caption)}</div>` : '')
    + `<span class="m-open">${isProfile ? 'View profile' : 'Play'} ↗</span></div>`;

  const inner = `<div class="m-shot">${shot}</div>${foot}`;
  const openAttr = isProfile ? '' : ` data-open="${esc(it.id)}"`;
  return `<a class="m-card" data-ratio="${esc(it.ratio)}"${openAttr} href="${esc(it.url)}" target="_blank" rel="noopener">${inner}</a>`;
}

let grids = 0, cards = 0;
out = out.replace(
  /<div class="media-block([^"]*)"([^>]*)>[\s\S]*?<\/div>(?=\s*(?:<|$))/g,
  (whole, cls, attrs) => {
    const get = (n) => attrs.match(new RegExp(`data-${n}="([^"]*)"`))?.[1] ?? '';
    const section = get('media');
    if (!section) return whole;
    const platform = get('platform');
    const items = db.items.filter(m => m.section === section
      && (!platform || m.platform === platform) && m.status !== 'dead');
    if (!items.length) return whole;

    const showBrand = get('showbrand') === '1';
    const label = get('label') || 'Published Work';
    grids++; cards += items.length;

    const styleAttr = attrs.match(/style="([^"]*)"/)?.[0] ?? '';
    return `<div class="media-block${cls}"${attrs.replace(/\s*style="[^"]*"/, '')} ${styleAttr}>`
      + `<div class="media-block-head">`
      + `<span class="media-block-title">${esc(label)}</span>`
      + `<span class="media-block-count">${items.length} link${items.length > 1 ? 's' : ''}</span>`
      + `</div>`
      + `<div class="media-grid${get('wide') === '1' ? ' wide' : ''}">`
      + items.map(it => card(it, showBrand)).join('')
      + `</div></div>`;
  }
);

await writeFile(HTML, out, 'utf8');

console.log(`normalised ${db.items.length} items · ${captioned} captions decoded`);
console.log(`pre-rendered ${grids} media grids · ${cards} cards into index.html (works without JS)`);
