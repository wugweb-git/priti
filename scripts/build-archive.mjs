#!/usr/bin/env node
/**
 * Maintains the Brand Archive.
 *
 *   node scripts/build-archive.mjs
 *
 * The archive data (BRANDS) and its renderer live in assets/site.js; the
 * filter buttons and the static grid live in index.html. This script:
 *
 * 1. Wires real links. A brand with work in media.json links to it, so the
 *    archive stops saying "Details coming next" for brands whose work is on
 *    the page. A profile beats a single post, since it represents the brand.
 *    Archive names and media names differ ("Cahoot (prev. Campus Sutra)" vs
 *    "Campus Sutra"), so the mapping is an explicit alias table, not a guess.
 *
 * 2. Tags capabilities, parsed only from each record's existing role/note
 *    text. A role naming no recognised capability simply gets none.
 *
 * 3. Pre-renders all brands into #archiveGrid so the archive exists with
 *    JavaScript disabled; the filters are an enhancement on a complete list.
 *
 * Every step is guarded or depth-matched, so re-running is byte-stable.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const JS = path.join(ROOT, 'assets', 'site.js');
const DB = path.join(ROOT, 'media.json');

const NO_LINK = 'Details coming next';   // the author's original wording

const CAPS = {
  brand: /\bbrand\b/i,
  strategy: /\bstrateg/i,
  content: /\bcontent\b|\bvisual language\b|\bbrand voice\b/i,
  performance: /\bperformance\b|\bgrowth\b|\bROI\b/i,
  influencer: /\binfluencer\b|\bcreator\b|\bcelebrity\b|\bambassador\b/i,
  campaigns: /\bcampaign/i,
  social: /\bsocial\b|\bORM\b/i,
  digital: /\bdigital\b|\becommerce\b|\bmarketplace\b/i,
};
const CAP_LABELS = { brand: 'Brand', strategy: 'Strategy', content: 'Content',
  performance: 'Performance', influencer: 'Influencer', campaigns: 'Campaigns',
  social: 'Social', digital: 'Digital' };

/* archive name -> media.json brand name, where they differ */
const ALIAS = {
  'Cahoot (prev. Campus Sutra)': 'Campus Sutra',
  'Cahoot': 'Campus Sutra',
  'InstaFab Plus': 'InstaFab Plus / Sohi',
  'Sohi': 'InstaFab Plus / Sohi',
};

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const db = JSON.parse(await readFile(DB, 'utf8'));
const linkFor = new Map();
for (const it of db.items) {
  if (!it.url) continue;
  const cur = linkFor.get(it.brand);
  if (!cur || (it.kind === 'profile' && cur.kind !== 'profile')) linkFor.set(it.brand, it);
}

/* ------------------------------------------------------- BRANDS data --- */
let js = await readFile(JS, 'utf8');
const start = js.indexOf('const BRANDS = [');
const end = js.indexOf('];', start);
if (start === -1 || end === -1) throw new Error('BRANDS array not found in assets/site.js');

const REC = /^\s*\{name:("(?:[^"\\]|\\.)*"),\s*cat:("(?:[^"\\]|\\.)*"),\s*role:("(?:[^"\\]|\\.)*"),\s*note:("(?:[^"\\]|\\.)*"),\s*(?:caps:(\[[^\]]*\]),\s*)?link:(null|"(?:[^"\\]|\\.)*")\}/;
const records = [];
let wired = 0;
const rebuilt = js.slice(start + 'const BRANDS = ['.length, end).split('\n').map((line) => {
  const m = line.match(REC);
  if (!m) return line;
  const rec = { name: JSON.parse(m[1]), cat: JSON.parse(m[2]), role: JSON.parse(m[3]),
    note: JSON.parse(m[4]), link: m[6] === 'null' ? null : JSON.parse(m[6]) };
  if (!rec.link) {
    const found = linkFor.get(ALIAS[rec.name] || rec.name);
    if (found) { rec.link = found.url; wired++; }
  }
  rec.caps = Object.entries(CAPS).filter(([, re]) => re.test(rec.role) || re.test(rec.note)).map(([k]) => k);
  records.push(rec);
  return `  {name:${JSON.stringify(rec.name)}, cat:${JSON.stringify(rec.cat)}, role:${JSON.stringify(rec.role)}, `
    + `note:${JSON.stringify(rec.note)}, caps:${JSON.stringify(rec.caps)}, link:${rec.link ? JSON.stringify(rec.link) : 'null'}},`;
}).join('\n').replace(/,(\s*)$/, '$1');
js = js.slice(0, start) + 'const BRANDS = [' + rebuilt + js.slice(end);

/* renderArchive: capability filters (once), and the author's no-link wording */
if (!js.includes('capFilter')) {
  js = js.replace(
    `  BRANDS.filter(b => filter === 'all' || b.cat === filter).forEach(b => {`,
    `  const capFilter = filter.startsWith('cap:') ? filter.slice(4) : null;\n`
    + `  BRANDS.filter(b => filter === 'all'\n`
    + `    || (capFilter ? (b.caps || []).includes(capFilter) : b.cat === filter)).forEach(b => {`);
}
js = js.replace(/<span class="arc-link">(?:\[Add project details\]|Details not published)<\/span>/g,
                `<span class="arc-link">${NO_LINK}</span>`);
await writeFile(JS, js, 'utf8');

/* ------------------------------------------------------ index.html --- */
let html = await readFile(HTML, 'utf8');

if (!html.includes('data-filter="cap:')) {
  const btns = Object.entries(CAP_LABELS)
    .map(([k, l]) => `      <button class="filter-btn" aria-pressed="false" data-filter="cap:${k}">${l}</button>`).join('\n');
  html = html.replace(/(<button class="filter-btn"[^>]*data-filter="other">Other<\/button>\n)/,
    `$1      <span class="filter-sep" aria-hidden="true"></span>\n${btns}\n`);
}

const staticArchive = records.map(b =>
  `<div class="arc-item" data-cat="${esc(b.cat)}" data-caps="${esc(b.caps.join(' '))}">`
  + `<div class="arc-name">${esc(b.name)}</div><div class="arc-cat">${esc(b.cat)}</div>`
  + `<div class="arc-hover"><div><div class="arc-role">${esc(b.role)}</div>`
  + `<div class="arc-note">${esc(b.note)}</div></div>`
  + (b.link ? `<a class="arc-link" href="${esc(b.link)}" target="_blank" rel="noopener">Visit brand ↗</a>`
            : `<span class="arc-link">${NO_LINK}</span>`)
  + `</div></div>`).join('');

{
  const open = html.indexOf('<div class="archive-grid reveal" id="archiveGrid">');
  if (open === -1) throw new Error('archiveGrid container not found in index.html');
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = open;
  let depth = 0, m, close = -1;
  while ((m = tag.exec(html))) {
    if (m[0] === '</div>') { if (--depth === 0) { close = tag.lastIndex; break; } }
    else depth++;
  }
  if (close === -1) throw new Error('unbalanced <div> in archiveGrid');
  html = html.slice(0, open) + `<div class="archive-grid reveal" id="archiveGrid">${staticArchive}</div>` + html.slice(close);
}
await writeFile(HTML, html, 'utf8');

console.log(`${records.length} archive brands · ${wired} links newly wired · pre-rendered into index.html`);
