#!/usr/bin/env node
/**
 * Enriches the BRANDS archive data inside index.html.
 *
 *   node scripts/build-archive.mjs
 *
 * Two jobs:
 *
 * 1. Wire real links. Every brand that has a work link in media.json gets one,
 *    so the archive stops saying "details coming next" for brands whose work is
 *    already on the page. A profile URL is preferred over a single post,
 *    because it represents the brand rather than one asset.
 *
 * 2. Add the capability dimension. The archive could only filter by industry,
 *    but the architecture calls for industry + capability. Capabilities are
 *    parsed out of each record's existing `role` string — the text after the
 *    em dash, which already names them ("F&B — Brand & Campaigns"). Nothing is
 *    inferred beyond what that field already says; a role with no recognised
 *    capability simply gets none.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const DB = path.join(ROOT, 'media.json');

/* Capability vocabulary — matched against the existing role text only. */
const CAPS = {
  brand: /\bbrand\b/i,
  strategy: /\bstrateg/i,
  content: /\bcontent\b|\bvisual language\b|\bbrand voice\b/i,
  performance: /\bperformance\b|\bgrowth\b|\bROI\b|\bperformance marketing\b/i,
  influencer: /\binfluencer\b|\bcreator\b|\bcelebrity\b|\bambassador\b/i,
  campaigns: /\bcampaign/i,
  social: /\bsocial\b|\bORM\b/i,
  digital: /\bdigital\b|\becommerce\b|\bmarketplace\b/i,
};

const CAP_LABELS = {
  brand: 'Brand', strategy: 'Strategy', content: 'Content',
  performance: 'Performance', influencer: 'Influencer',
  campaigns: 'Campaigns', social: 'Social', digital: 'Digital',
};

const db = JSON.parse(await readFile(DB, 'utf8'));

/* brand name -> best link (profile beats a single post) */
const linkFor = new Map();
for (const it of db.items) {
  if (!it.url) continue;
  const cur = linkFor.get(it.brand);
  if (!cur || (it.kind === 'profile' && cur.kind !== 'profile')) {
    linkFor.set(it.brand, { url: it.url, kind: it.kind });
  }
}
// The archive labels this brand with its historical name in parentheses.
for (const [k, v] of [...linkFor]) {
  if (k === 'Cahoot') linkFor.set('Cahoot (prev. Campus Sutra)', v);
}

let html = await readFile(HTML, 'utf8');

const start = html.indexOf('const BRANDS = [');
const end = html.indexOf('];', start);
if (start === -1 || end === -1) throw new Error('BRANDS array not found in index.html');

const body = html.slice(start + 'const BRANDS = ['.length, end);

let wired = 0, tagged = 0, total = 0;

const rebuilt = body
  .split('\n')
  .map((line) => {
    const m = line.match(/^\s*\{name:"([^"]+)",\s*cat:"([^"]+)",\s*role:"([^"]*)",\s*note:"([^"]*)",\s*link:(null|"[^"]*")\}/);
    if (!m) return line;
    total++;
    const [, name, cat, role, note, rawLink] = m;

    const found = linkFor.get(name);
    const link = rawLink !== 'null' ? rawLink : found ? JSON.stringify(found.url) : 'null';
    if (link !== 'null' && rawLink === 'null') wired++;

    // Parse capabilities from the role text that is already there.
    const caps = Object.entries(CAPS)
      .filter(([, re]) => re.test(role) || re.test(note))
      .map(([k]) => k);
    if (caps.length) tagged++;

    return `  {name:${JSON.stringify(name)}, cat:${JSON.stringify(cat)}, role:${JSON.stringify(role)}, `
      + `note:${JSON.stringify(note)}, caps:${JSON.stringify(caps)}, link:${link}},`;
  })
  .join('\n')
  .replace(/,(\s*)$/, '$1');

html = html.slice(0, start) + 'const BRANDS = [' + rebuilt + html.slice(end);

/* ---- filter UI: add the capability dimension --------------------------- */
const capBtns = Object.entries(CAP_LABELS)
  .map(([k, label]) => `      <button class="filter-btn" data-filter="cap:${k}">${label}</button>`)
  .join('\n');

html = html.replace(
  /(<button class="filter-btn" data-filter="other">Other<\/button>\n)(\s*<\/div>)/,
  `$1      <span class="filter-sep" aria-hidden="true"></span>\n${capBtns}\n$2`
);

/* ---- renderArchive: understand cap: filters and show capability chips --- */
html = html.replace(
  `  BRANDS.filter(b => filter === 'all' || b.cat === filter).forEach(b => {`,
  `  const capFilter = filter.startsWith('cap:') ? filter.slice(4) : null;\n` +
  `  BRANDS.filter(b => filter === 'all'\n` +
  `    || (capFilter ? (b.caps || []).includes(capFilter) : b.cat === filter)).forEach(b => {`
);

html = html.replace(
  '<span class="arc-link">Details coming next</span>',
  '<span class="arc-link">Details not published</span>'
);

/* ---- pre-render the archive so it exists without JavaScript ------------- */
/* With JS off the grid used to be an empty div. Emit all 28 brands; the
   filter buttons are an enhancement on top of a complete list. */
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const records = [...html.slice(html.indexOf('const BRANDS = ['), html.indexOf('];', html.indexOf('const BRANDS = [')))
  .toString().matchAll(/\{name:("(?:[^"\\]|\\.)*"), cat:("(?:[^"\\]|\\.)*"), role:("(?:[^"\\]|\\.)*"), note:("(?:[^"\\]|\\.)*"), caps:(\[[^\]]*\]), link:(null|"(?:[^"\\]|\\.)*")\}/g)]
  .map(m => ({
    name: JSON.parse(m[1]), cat: JSON.parse(m[2]), role: JSON.parse(m[3]),
    note: JSON.parse(m[4]), caps: JSON.parse(m[5]),
    link: m[6] === 'null' ? null : JSON.parse(m[6]),
  }));

const staticArchive = records.map(b =>
  `<div class="arc-item" data-cat="${esc(b.cat)}" data-caps="${esc(b.caps.join(' '))}">`
  + `<div class="arc-name">${esc(b.name)}</div>`
  + `<div class="arc-cat">${esc(b.cat)}</div>`
  + `<div class="arc-hover"><div>`
  + `<div class="arc-role">${esc(b.role)}</div>`
  + `<div class="arc-note">${esc(b.note)}</div></div>`
  + (b.link
      ? `<a class="arc-link" href="${esc(b.link)}" target="_blank" rel="noopener">Visit brand ↗</a>`
      : `<span class="arc-link">Details not published</span>`)
  + `</div></div>`
).join('');

html = html.replace(
  /<div class="archive-grid reveal" id="archiveGrid">[\s\S]*?<\/div>(?=\s*<)/,
  `<div class="archive-grid reveal" id="archiveGrid">${staticArchive}</div>`
);

await writeFile(HTML, html, 'utf8');
console.log(`${total} archive brands · ${wired} links wired · ${tagged} capability-tagged`);
console.log(`pre-rendered ${records.length} archive items into index.html (works without JS)`);
