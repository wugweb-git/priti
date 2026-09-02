# Priti Tiwari — content migration record

**Date:** 2026-09-02
**Shell (structure/design):** `index.html` from `wugweb-git/priti` — 1,345 lines, md5 `4285f55f`
**Content source (authority):** `~/Downloads/priti-tiwari-portfolio.html` — 37,710 bytes, md5 `89fd6b4b`, created 06:46
**Output:** `index.html` · media data `media.json` · thumbnails `assets/thumbs/`

Rule applied: **old file = implementation shell, new file = authoritative content.** No redesign.
Where the new file has content for a slot, the new file wins. Where the old file carries content the
new file doesn't cover, it is retained — not omitted. Conflicts are listed in §3, unresolved.

---

## 1. What moved across

| From the content source | Landed in |
|---|---|
| Tagline "Marketing strategist. Brand builder. Professional overthinker of good ideas." | Hero `.hero-role` |
| "and yes, I obsess over the details." | Hero, handwritten note |
| 6 receipts + 3 hand annotations ("not bad.", "yes, really.", "numbers matter.") | Receipts strip |
| "Where I Play" — 6 disciplines with meta | New `.play-grid` under Industries intro |
| "I like brands people can taste." + F&B copy | F&B industry block lead |
| **Case 01 — Selling the escape** (Sila Leisure / The Cape Goa) | New `#case-01`, full 6-field case |
| Funnel: Attention → Interest → Lead → Booking | `#case-01` |
| **Case 02** — The Culture field + 6 board notes | Added to existing Chaipoint × Maggi case |
| **Case 03 — Serious about samosas** (Samosa Party) | New `#case-03` |
| **Case 04 — Good brands are like good donuts** (Krispy Kreme) | New `#case-04` |
| "Not skills. A process." — 7-step flow | New `.flow` in Thinking section |
| About — 3 paragraphs | Replaced the old 2 paragraphs |
| Brand wall roles (10 brands) | Merged into the 28-brand archive |
| Footer "Built with too many ideas" | Footer note |

## 2. What the old shell kept (content source doesn't cover it — retained, not omitted)

- Six industry blocks: F&B, Hospitality (Restaurants / Properties), Beauty, Fashion, Lifestyle, Entertainment
- 18 of the 28 archive brands absent from the new file's 10-brand wall
- About facts: Bengaluru · Marketing Lead, Sila Leisure · BAMMC, L.S. Raheja College · Hootsuite, Meta Business Suite, SEMRUSH, Google Analytics
- Receipts the new file drops: **10K+ Instagram likes** and **50+ influencers/brand/month** — kept, because dropping them would be omission
- Chaipoint × Maggi deep case: Brief / Problem / Thought / Human Truth / Creative Direction / Content World / Execution / Results / Takeaway
- Hero line "I like complicated briefs. I just don't like complicated ideas."
- The 39 Instagram/YouTube links and the whole media pipeline

## 3. ⚠️ Conflicts — NOT resolved, your call

| Field | Old shell | Content source | What's live now |
|---|---|---|---|
| **Email** | tpriti009@gmail.com | hello@pritiwari.com | **hello@pritiwari.com** as primary (source wins). Gmail kept on "Request resume". Does `pritiwari.com` exist and receive mail? If not this is a dead primary CTA. |
| **LinkedIn** | `/in/prititiwari18` | `href="#"` (placeholder) | **Old URL kept** — taking the source's value would have shipped a dead link |
| **Brand spelling** | Chaipoint | Chaipoint | **Chaipoint** — I reverted my earlier "Chai Point" rename. Note: their own YouTube channel is "Chai Point", two words |
| **Campus Sutra** | Campus Sutra | Campus Sutra | **Campus Sutra** — I reverted my earlier "Cahoot" rename. Priti's WhatsApp said "Cahoot (previously campus sutra)"; the content file disagrees |
| **Receipts count** | 8 | 6 | **8** — the 2 extras retained |

## 4. Explicit unavailable states (no fake data)

- Cases 03 and 04: "Details to be added — full campaign metrics available on request." + a `Metrics not published` badge
- All 39 tiles now render a real cached cover; the designed placeholder remains as the fallback,
  wired to both a status gate and an `onerror` handler
- Author TODOs (`[Add project details]`, `coming next`) replaced with honest "not published" states
- Hero-media slots: unchanged, still empty

## 5. Deduplication

Sila Leisure and The Cape Goa work rails used to sit in the Hospitality industry block **and** would
have repeated in the case study. The rails now live only in `#case-01`; the industry block links to it.
Samosa Party and Krispy Kreme brand cards link to `#case-03` / `#case-04` instead of repeating copy.

## 6. Media pipeline (unchanged from spec)

Priority: Graph API → oEmbed → og:image → manual. **og:image is the live path.**

Correction to an earlier version of this note, which said Instagram was blocked and manual capture
was the only option. That was wrong. Instagram serves `og:` tags to link-preview crawlers but not to
browser user-agents — a Chrome UA gets a ~620KB JavaScript shell with no metadata, which is why the
first attempt came back empty. Requesting as `facebookexternalhit` returns the cover image, the full
caption and the owning account handle. Thumbnails are always local files; no live Instagram CDN URL
is ever a dependency.

| Platform | Links | Thumbnails | Captions |
|---|---|---|---|
| YouTube | 2 | ✅ cached via public oEmbed | ✅ 2 |
| Instagram | 37 | ✅ 37 cached via og:image | ✅ 27 (4 celeb reels and 4 profiles expose none) |

Engagement counts remain unavailable and are not guessed. Instagram exposes them only to a token
that owns the post; YouTube needs a Data API key (`YOUTUBE_API_KEY`).

## 7. Defects fixed in passing

| | Before | After |
|---|---|---|
| WCAG AA contrast failures | 100 | **0** |
| Content outside landmarks | 56 nodes | 1 |
| Open Graph / Twitter / favicon | none | full set + generated `assets/og.png` (1200×630) |
| Horizontal scroll | 1280 and 390 | none |
| `<main>` landmark | absent | present |

Contrast was fixed by raising opacity on small mono type and swapping `--tomato` → `--tomato-dim`
on light grounds, `--butter` on dark, plus a new `--coral-dim` token. Hues unchanged; the visual
system is intact.

## 8. Still open — needs you

1. ~~Confirm `hello@pritiwari.com`~~ — **resolved: `pritiwari.com` is unregistered** (`whois`: "No
   match for domain"). It was the primary contact CTA *and* the canonical / og:url / og:image host.
   All now point at the live Pages URL and `tpriti009@gmail.com`. Register the domain to change this.
2. Chaipoint vs Chai Point — evidence now favours **Chai Point**: their own Instagram handle is
   `@chai_point` and the YouTube channel name returned by oEmbed is "Chai Point". Still your call.
3. ~~Campus Sutra vs Cahoot~~ — **resolved: Cahoot**, with "previously Campus Sutra" kept as context
4. Name the celebrity in the InstaFab Plus / Sohi collab — one of the four reels
   (`C2uSo-ZqeDk`) is posted by **@fukravarun**, the other three by `@instafabplus`. Not published as
   fact, since account-of-origin is not the same as confirmed casting. Confirm and I'll add it.
5. Name "Brand 2" at Sila Leisure, or drop the ₹10L figure
6. 8 brand cards still say `[Add project details]`; 6 hero-media slots still empty
7. ~~Capture the 37 Instagram thumbnails~~ — **done, all 37 fetched via og:image**
8. Every receipt figure is self-reported — decide which you can evidence
