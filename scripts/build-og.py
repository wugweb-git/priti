#!/usr/bin/env python3
"""
Builds the 1200x630 social-preview image for each niche page.

    python3 scripts/build-og.py

Output: assets/og/<slug>.png — referenced by each page's og:image and
twitter:image, so a link shared on LinkedIn, WhatsApp or X shows the niche,
its thesis and a real piece of the work instead of a blank card.

Uses the site's own palette and type. Fraunces and Space Mono are fetched
once from the google/fonts repository into scripts/.fonts/ (gitignored); if
that fails, Georgia and Courier stand in so the build never breaks.

Requires Pillow.
"""
import json, os, sys, urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'og'
FONTS = ROOT / 'scripts' / '.fonts'

IVORY, IVORY2, CHAR, TOMATO, BUTTER = '#F6F1E6', '#EDE5D3', '#18160F', '#E5432B', '#F0BD3E'
ACCENT = {'hospitality': '#6B6B3A', 'food-beverage': '#E5432B', 'fashion': '#F0BD3E',
          'beauty': '#B83D63', 'entertainment': '#2743D6'}

SRC = {
  'fraunces.ttf': 'https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf',
  'spacemono-bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/spacemono/SpaceMono-Bold.ttf',
  'spacemono.ttf': 'https://github.com/google/fonts/raw/main/ofl/spacemono/SpaceMono-Regular.ttf',
}
FALLBACK = {
  'fraunces.ttf': '/System/Library/Fonts/Supplemental/Georgia Bold.ttf',
  'spacemono-bold.ttf': '/System/Library/Fonts/Supplemental/Courier New Bold.ttf',
  'spacemono.ttf': '/System/Library/Fonts/Supplemental/Courier New.ttf',
}

def font(name, size, weight=None):
    FONTS.mkdir(parents=True, exist_ok=True)
    p = FONTS / name
    if not p.exists():
        try:
            urllib.request.urlretrieve(SRC[name], p)
        except Exception as e:
            print(f'  font {name}: fetch failed ({e}); using fallback')
    path = p if p.exists() and p.stat().st_size > 10000 else Path(FALLBACK[name])
    f = ImageFont.truetype(str(path), size)
    if weight and path == p:
        try:
            axes = f.get_variation_axes()
            f.set_variation_by_axes([ {'wght': weight, 'opsz': 144}.get(a['name'].decode() if isinstance(a['name'], bytes) else a['name'], a['default']) for a in axes ])
        except Exception:
            pass
    return f

def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=f) <= width: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def build(slug, name, thesis, brands, cover):
    W, H = 1200, 630
    im = Image.new('RGB', (W, H), IVORY)
    d = ImageDraw.Draw(im)
    acc = ACCENT[slug]

    # right: the cover, framed like the site's cards, with the accent shadow
    cx, cy, cw, ch = 792, 70, 336, 420
    d.rectangle([cx + 12, cy + 12, cx + cw + 12, cy + ch + 12], fill=acc)
    try:
        c = Image.open(ROOT / cover).convert('RGB')
        c = ImageOps.fit(c, (cw, ch), Image.LANCZOS)
        im.paste(c, (cx, cy))
    except Exception:
        d.rectangle([cx, cy, cx + cw, cy + ch], fill=IVORY2)
    d.rectangle([cx, cy, cx + cw, cy + ch], outline=CHAR, width=2)

    # left: eyebrow, niche name, thesis, brands
    mono_b, mono = font('spacemono-bold.ttf', 19), font('spacemono.ttf', 18)
    d.text((72, 70), 'PRITI TIWARI  —  SELECTED WORK', font=mono_b, fill=CHAR)
    d.rectangle([72, 108, 72 + 64, 112], fill=acc)

    size = 104
    while size > 56:
        disp = font('fraunces.ttf', size, weight=900)
        lines = wrap(d, name, disp, 660)
        if len(lines) <= 2: break
        size -= 6
    y = 138
    for ln in lines:
        d.text((68, y), ln, font=disp, fill=CHAR)
        y += int(size * 1.02)

    th = font('fraunces.ttf', 34, weight=500)
    y += 16
    for ln in wrap(d, thesis, th, 660)[:3]:
        d.text((72, y), ln, font=th, fill=CHAR)
        y += 44

    d.text((72, 538), ' · '.join(brands).upper()[:62], font=mono, fill=CHAR)

    # bottom band: the address, so the card works as a pointer
    d.rectangle([0, H - 40, W, H], fill=CHAR)
    d.text((72, H - 31), 'WUGWEB-GIT.GITHUB.IO/PRITI', font=font('spacemono-bold.ttf', 17), fill=BUTTER)
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / f'{slug}.png', optimize=True)
    return OUT / f'{slug}.png'

if __name__ == '__main__':
    spec = json.loads((ROOT / 'scripts' / 'niches.json').read_text())
    for n in spec['niches']:
        p = build(n['slug'], n['name'], n['thesis'], n['brands'], n['cover_thumb'])
        print(f'  {p.relative_to(ROOT)}  {Image.open(p).size}')
