#!/usr/bin/env node
/**
 * Copies the shared page chrome from index.html into every niche page.
 *
 *   node scripts/sync-chrome.mjs
 *
 * index.html is the single source for three regions, each fenced by markers:
 *
 *   <!-- CHROME:NAV -->     … <!-- /CHROME:NAV -->       nav + mobile menu
 *   <!-- CHROME:FOOTER -->  … <!-- /CHROME:FOOTER -->    footer
 *   <!-- CHROME:LB -->      … <!-- /CHROME:LB -->        lightbox dialog
 *
 * Edit them once on the homepage, run this, and every page matches.
 *
 * Links are rewritten for pages one level down:
 *   href="#top"      -> href="../"          (the logo goes home)
 *   href="#contact"  -> kept                (each page has its own contact band)
 *   href="#main"     -> kept                (skip link)
 *   href="#other"    -> href="../#other"    (homepage sections)
 *   href="x/"        -> href="../x/"        (sibling niche pages)
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
export const NICHES = ['hospitality', 'food-beverage', 'fashion', 'beauty', 'entertainment'];
const REGIONS = ['NAV', 'FOOTER', 'LB'];
const LOCAL = new Set(['contact', 'main']);

function region(html, name) {
  const open = `<!-- CHROME:${name} -->`, close = `<!-- /CHROME:${name} -->`;
  const a = html.indexOf(open), b = html.indexOf(close);
  if (a === -1 || b === -1 || b < a) return null;
  return { a, b: b + close.length, body: html.slice(a, b + close.length) };
}

function forSubpage(chunk) {
  return chunk
    .replace(/href="#top"/g, 'href="../"')
    .replace(/href="#([\w-]+)"/g, (m, id) => LOCAL.has(id) ? m : `href="../#${id}"`)
    .replace(new RegExp(`href="(${NICHES.join('|')})/"`, 'g'), 'href="../$1/"');
}

const exists = (p) => access(p).then(() => true, () => false);
const home = await readFile(path.join(ROOT, 'index.html'), 'utf8');

for (const slug of NICHES) {
  const file = path.join(ROOT, slug, 'index.html');
  if (!(await exists(file))) { console.log(`  skip ${slug}/ (no page yet)`); continue; }
  let page = await readFile(file, 'utf8');
  const synced = [];
  for (const name of REGIONS) {
    const src = region(home, name), dst = region(page, name);
    if (!src || !dst) continue;
    page = page.slice(0, dst.a) + forSubpage(src.body) + page.slice(dst.b);
    synced.push(name.toLowerCase());
  }
  await writeFile(file, page, 'utf8');
  console.log(`  ${(slug + '/').padEnd(16)} synced ${synced.join(', ') || 'nothing'}`);
}
