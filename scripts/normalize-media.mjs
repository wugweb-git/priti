#!/usr/bin/env node
/**
 * Normalises media.json, writes assets/media.js, and pre-renders every work
 * grid and thumbnail strip into the static HTML of every page.
 *
 *   node scripts/normalize-media.mjs
 *
 * Captions. Instagram's og:title is the whole post — 'ACCOUNT on Instagram:
 * "<caption>"' — with entities still encoded. So each item keeps:
 *   caption  full decoded caption, for the lightbox and the record
 *   title    a short display line for the card, cut on a word boundary
 * Nothing is invented: with no caption to read, both stay empty and the card
 * falls back to the brand name.
 *
 * Metrics. enrich-meta.mjs stores Instagram's own published counts
 * ("121 likes", "46K followers") with the date they were read. Cards print
 * them as Instagram printed them, and each grid says when they were checked.
 * YouTube counts are not available without an API key, so YouTube cards show
 * none — a missing count is never rendered as 0.
 *
 * Pre-rendering. The site must work with JavaScript disabled, so the markup
 * lives in the HTML. Three hosts are filled, each replaced whole by a
 * depth-matched scan, so re-running is byte-stable:
 *
 *   <div class="media-block" data-media data-platform data-brand data-brands
 *        data-label data-showbrand data-wide>          full work grid
 *   <div class="mini-strip"  data-ids="a|b|c">         niche-card thumbnails
 *   <div class="film-strip"  data-ids="a|b|…">         hero contact sheet
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DB = path.join(ROOT, 'media.json');
const MEDIA_JS = path.join(ROOT, 'assets', 'media.js');

/* Every page that can host media, with the prefix that reaches the site root. */
const PAGES = [
  ['index.html', ''],
  ['hospitality/index.html', '../'],
  ['food-beverage/index.html', '../'],
  ['fashion/index.html', '../'],
  ['beauty/index.html', '../'],
  ['entertainment/index.html', '../'],
];

/* Which niche page each media section belongs to — the film strip links there. */
export const NICHE_OF = {
  sila: 'hospitality', cape: 'hospitality',
  chaipoint: 'food-beverage',
  cahoot: 'fashion', celeb: 'fashion',
  beauty: 'beauty',
  rapture: 'entertainment',
};

const TITLE_MAX = 84;

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** 'ACCOUNT on Instagram: "caption"' -> caption, or '' if not that shape. */
function extractCaption(raw) {
  const m = decode(raw).trim().match(/^.*? on Instagram:\s*["“”"](.*)["“”"]\s*$/s);
  return m ? m[1].trim() : '';
}

/** First meaningful line, trimmed to a word boundary, hashtag tail dropped. */
function displayTitle(caption) {
  if (!caption) return '';
  let line = caption.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) || '';
  line = line.replace(/\s*#[\w.]+/g, '').replace(/\s+/g, ' ').trim();
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : TITLE_MAX).trim() + '…';
}

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthYear = (iso) => { const [y, m] = String(iso).split('-'); return m ? `${MONTH[+m - 1]} ${y}` : ''; };
const dayMonthYear = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** "121 likes · 12 comments" / "46K followers" — only what Instagram printed. */
function statsLine(it) {
  const m = it.metrics;
  if (!m) return '';
  if (it.kind === 'profile') return m.followers ? `${m.followers} followers` : '';
  return [m.likes && `${m.likes} likes`, m.comments && `${m.comments} comments`].filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------- data --- */
const db = JSON.parse(await readFile(DB, 'utf8'));
const byId = new Map(db.items.map(i => [i.id, i]));

let captioned = 0;
for (const it of db.items) {
  if (it.platform === 'youtube') { it.title = decode(it.title || ''); it.caption = it.caption || ''; continue; }
  if (it.kind === 'profile') { it.caption = ''; it.title = ''; continue; }
  // Idempotent: once extracted, `title` is the short display line, not the raw
  // og:title, so re-parsing it would lose the caption.
  const caption = it.caption ? it.caption : extractCaption(it.title || '');
  it.caption = caption;
  it.title = displayTitle(caption);
  if (caption) captioned++;
}
await writeFile(DB, JSON.stringify(db, null, 2) + '\n');

/* The runtime copy: only what the lightbox and fallback renderer read. */
const slim = db.items.map(i => ({
  id: i.id, brand: i.brand, section: i.section, platform: i.platform, kind: i.kind,
  shortcode: i.shortcode, url: i.url, thumbnail: i.thumbnail, title: i.title,
  caption: i.caption, ratio: i.ratio, status: i.status,
  ...(i.embed ? { embed: i.embed } : {}),
  ...(i.author ? { author: i.author } : {}),
  ...(i.metrics ? { metrics: i.metrics } : {}),
  ...(i.publishedAt ? { publishedAt: i.publishedAt } : {}),
  ...(i.capturedAt ? { capturedAt: i.capturedAt } : {}),
}));
await writeFile(MEDIA_JS,
  '/* Generated by scripts/normalize-media.mjs from media.json — do not edit by hand. */\n'
  + 'window.MEDIA = [\n' + slim.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n];\n');

/* Newest capture date across Instagram items — printed once per grid. */
const checked = db.items.map(i => i.capturedAt).filter(Boolean).sort().pop();

/* ----------------------------------------------------------- renderers --- */
const TINTS = ['rgba(229,67,43,.10)','rgba(240,189,62,.14)','rgba(39,67,214,.09)',
               'rgba(240,120,154,.12)','rgba(107,107,58,.11)','rgba(201,180,140,.16)'];
const tintFor = (s) => TINTS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
const PLAY = '<span class="m-play"><svg viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0l10 6-10 6z"/></svg></span>';

function shotFor(it, prefix, alt) {
  return it.status === 'available' && it.thumbnail
    ? `<img src="${esc(prefix + it.thumbnail)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="640" height="800">`
    : `<div class="m-ph" style="--ph-tint:${tintFor(it.shortcode)}"><div class="m-ph-brand">${esc(it.brand)}</div>`
      + (it.kind === 'profile' ? '' : `<div class="m-ph-code">${esc(it.shortcode)}</div>`) + `</div>`;
}

function card(it, showBrand, prefix) {
  const isProfile = it.kind === 'profile';
  const platform = it.platform === 'youtube' ? 'YouTube' : 'Instagram';
  const alt = it.title || `${it.brand} — ${platform} ${it.kind}`;
  const caption = it.title || (showBrand ? it.brand : '');
  const stats = statsLine(it);
  const when = it.publishedAt ? monthYear(it.publishedAt) : '';
  const foot = `<div class="m-foot">`
    + `<div class="m-kind">${platform} · ${esc(it.kind)}${when ? ` · ${esc(when)}` : ''}</div>`
    + (caption ? `<div class="m-title">${esc(caption)}</div>` : '')
    + (stats ? `<div class="m-stats">${esc(stats)}</div>` : '')
    + `<span class="m-open">${isProfile ? 'View profile' : 'Play'} ↗</span></div>`;
  const openAttr = isProfile ? '' : ` data-open="${esc(it.id)}"`;
  return `<a class="m-card" data-ratio="${esc(it.ratio)}"${openAttr} href="${esc(it.url)}" target="_blank" rel="noopener">`
    + `<div class="m-shot">${shotFor(it, prefix, alt)}${isProfile ? '' : PLAY}</div>${foot}</a>`;
}

function mediaBlock(cls, attrs, get, prefix) {
  const section = get('media');
  const platform = get('platform');
  const brand = get('brand');
  const brands = get('brands') ? get('brands').split('|') : null;
  const items = db.items.filter(i => i.section === section
    && (!platform || i.platform === platform)
    && (!brand || i.brand === brand)
    && (!brands || brands.includes(i.brand))
    && i.status !== 'dead');
  if (!items.length) return null;
  const hasIg = items.some(i => i.metrics);
  const hasYt = items.some(i => i.platform === 'youtube');
  const note = [hasIg && checked && `Instagram counts checked ${dayMonthYear(checked)}`,
                hasYt && 'YouTube counts not shown'].filter(Boolean).join(' · ');
  return {
    n: items.length,
    html: `<div class="media-block${cls}"${attrs}>`
      + `<div class="media-block-head">`
      + `<span class="media-block-title">${esc(get('label') || 'Published Work')}</span>`
      + `<span class="media-block-count">${items.length} link${items.length > 1 ? 's' : ''}</span>`
      + `</div>`
      + `<div class="media-grid${get('wide') === '1' ? ' wide' : ''}">`
      + items.map(it => card(it, get('showbrand') === '1', prefix)).join('')
      + `</div>`
      + (note ? `<p class="media-note">${esc(note)}</p>` : '')
      + `</div>`,
  };
}

/** Niche-card thumbnails: small, open the lightbox, fall back to the post. */
function miniStrip(cls, attrs, get, prefix) {
  const items = get('ids').split('|').map(id => byId.get(id)).filter(Boolean);
  if (!items.length) return null;
  return {
    n: items.length,
    html: `<div class="mini-strip${cls}"${attrs}>`
      + items.map(it => {
          const alt = it.title || `${it.brand} — ${it.platform} ${it.kind}`;
          const open = it.kind === 'profile' ? '' : ` data-open="${esc(it.id)}"`;
          return `<a class="mini" href="${esc(it.url)}" target="_blank" rel="noopener"${open}`
            + ` aria-label="${esc(it.brand)}: ${esc(alt)}">${shotFor(it, prefix, '')}</a>`;
        }).join('')
      + `</div>`,
  };
}

/** Hero contact sheet: each frame links to its niche page. Rendered twice so
    the CSS marquee loops seamlessly; the copy is hidden from assistive tech. */
function filmStrip(cls, attrs, get, prefix) {
  const items = get('ids').split('|').map(id => byId.get(id)).filter(Boolean);
  if (!items.length) return null;
  const frame = (it, hidden) => {
    const niche = NICHE_OF[it.section];
    const href = niche ? `${prefix}${niche}/` : it.url;
    return `<a class="frame" href="${esc(href)}"${hidden ? ' tabindex="-1" aria-hidden="true"' : ''}>`
      + shotFor(it, prefix, hidden ? '' : `${it.brand} — ${it.title || it.kind}`)
      + `<span class="frame-label">${esc(it.brand)}</span></a>`;
  };
  return {
    n: items.length,
    html: `<div class="film-strip${cls}"${attrs}><div class="film-track">`
      + items.map(it => frame(it, false)).join('')
      + items.map(it => frame(it, true)).join('')
      + `</div></div>`,
  };
}

/** Index just past the `</div>` closing the `<div` at `start` (depth-matched). */
function endOfDiv(s, start) {
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = start;
  let depth = 0, m;
  while ((m = tag.exec(s))) {
    if (m[0] === '</div>') { if (--depth === 0) return tag.lastIndex; }
    else depth++;
  }
  throw new Error('unbalanced <div> while scanning a media host');
}

const HOSTS = [
  [/<div class="media-block([^"]*)"([^>]*)>/g, mediaBlock],
  [/<div class="mini-strip([^"]*)"([^>]*)>/g, miniStrip],
  [/<div class="film-strip([^"]*)"([^>]*)>/g, filmStrip],
];

function render(html, prefix) {
  let counts = { hosts: 0, items: 0 };
  for (const [re, fn] of HOSTS) {
    const pieces = []; let cursor = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(html))) {
      const [, cls, attrs] = m;
      const get = (n) => attrs.match(new RegExp(`data-${n}="([^"]*)"`))?.[1] ?? '';
      const stop = endOfDiv(html, m.index);
      re.lastIndex = stop;
      const out = fn(cls, attrs, get, prefix);
      if (!out) continue;
      pieces.push(html.slice(cursor, m.index), out.html);
      cursor = stop;
      counts.hosts++; counts.items += out.n;
    }
    pieces.push(html.slice(cursor));
    html = pieces.join('');
  }
  return { html, counts };
}

/* --------------------------------------------------------------- pages --- */
const exists = (p) => access(p).then(() => true, () => false);
console.log(`normalised ${db.items.length} items · ${captioned} captions · assets/media.js written`);
for (const [rel, prefix] of PAGES) {
  const file = path.join(ROOT, rel);
  if (!(await exists(file))) continue;
  const { html, counts } = render(await readFile(file, 'utf8'), prefix);
  await writeFile(file, html, 'utf8');
  console.log(`  ${rel.padEnd(26)} ${counts.hosts} hosts · ${counts.items} items pre-rendered`);
}
