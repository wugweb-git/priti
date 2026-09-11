const MEDIA = window.MEDIA || [];
/* Pages below the root set <html data-root="../"> so runtime-built paths
   resolve from anywhere; the homepage leaves it empty. */
const ROOT = document.documentElement.dataset.root || '';
/* =====================================================================
   EDITABLE CONTENT — update this data as new project details come in.
   ===================================================================== */
/* =====================================================================
   MEDIA — every work link on the site. Mirrors media.json.
   RULE: `thumbnail` is ALWAYS a local path. Never point it at a live
   Instagram CDN URL — those are signed and expire within days.
   status: "available"       -> renders the cached image
           "needs_thumbnail" -> renders a designed placeholder tile
   To fill a placeholder: save the cover to the `thumbnail` path, then
   run `node scripts/fetch-meta.mjs --rescan` to flip its status.
   ===================================================================== */


const esc = s => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const PLAY = '<span class="m-play"><svg viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0l10 6-10 6z"/></svg></span>';

/* Deterministic tint per item so a wall of not-yet-captured covers reads as a
   designed grid rather than 37 identical empty slots. */
const TINTS = ['rgba(229,67,43,.10)','rgba(240,189,62,.14)','rgba(39,67,214,.09)',
               'rgba(240,120,154,.12)','rgba(107,107,58,.11)','rgba(201,180,140,.16)'];
const tintFor = s => TINTS[[...String(s)].reduce((a,c)=>a + c.charCodeAt(0), 0) % TINTS.length];

/* Fallback renderer only — scripts/normalize-media.mjs pre-renders every grid
   into the HTML, so this runs only if that static markup is missing. */
function mediaCard(it, showBrand){
  const isProfile = it.kind === 'profile';
  const platform  = it.platform === 'youtube' ? 'YouTube' : 'Instagram';
  const shot = it.status === 'available'
    ? `<img src="${esc(ROOT + it.thumbnail)}" alt="${esc(it.title || it.brand)}" loading="lazy" decoding="async">${isProfile ? '' : PLAY}`
    : `<div class="m-ph" style="--ph-tint:${tintFor(it.shortcode)}">
         <div class="m-ph-brand">${esc(it.brand)}</div>
         ${isProfile ? '' : `<div class="m-ph-code">${esc(it.shortcode)}</div>`}
       </div>${isProfile ? '' : PLAY}`;

  // only show a caption line when there is a real one — never echo the kind label
  const caption = it.title || (showBrand ? it.brand : '');
  const foot = `<div class="m-foot">
      <div class="m-kind">${platform} · ${esc(it.kind)}</div>
      ${caption ? `<div class="m-title">${esc(caption)}</div>` : ''}
      <span class="m-open">${isProfile ? 'View profile' : 'Play'} ↗</span>
    </div>`;

  const inner = `<div class="m-shot">${shot}</div>${foot}`;
  return isProfile
    ? `<a class="m-card" data-ratio="${it.ratio}" href="${esc(it.url)}" target="_blank" rel="noopener">${inner}</a>`
    : `<a class="m-card" data-ratio="${it.ratio}" data-open="${esc(it.id)}" href="${esc(it.url)}" target="_blank" rel="noopener">${inner}</a>`;
}

document.querySelectorAll('.media-block').forEach(block => {
  const section  = block.dataset.media;
  const platform = block.dataset.platform;
  const brand    = block.dataset.brand;
  const brands   = block.dataset.brands ? block.dataset.brands.split('|') : null;
  const items = MEDIA.filter(m => m.section === section
    && (!platform || m.platform === platform)
    && (!brand || m.brand === brand)
    && (!brands || brands.includes(m.brand))
    && m.status !== 'dead');
  if(!items.length){ block.remove(); return; }

  const showBrand = block.dataset.showbrand === '1';

  // The grids are pre-rendered into the HTML by scripts/normalize-media.mjs so
  // the work is visible with JavaScript disabled. Only build them here if that
  // static markup is missing, and never re-render over it.
  if (!block.querySelector('.media-grid')) {
    block.innerHTML = `
      <div class="media-block-head">
        <span class="media-block-title">${esc(block.dataset.label || 'Published Work')}</span>
        <span class="media-block-count">${items.length} link${items.length > 1 ? 's' : ''}</span>
      </div>
      <div class="media-grid${block.dataset.wide === '1' ? ' wide' : ''}">
        ${items.map(it => mediaCard(it, showBrand)).join('')}
      </div>`;
  }

  // a cached thumb that 404s must degrade to the placeholder, never a broken image
  block.querySelectorAll('.m-shot img').forEach(img => {
    img.addEventListener('error', () => {
      const it = items.find(m => ROOT + m.thumbnail === img.getAttribute('src')) || {};
      img.outerHTML = `<div class="m-ph" style="--ph-tint:${tintFor(it.shortcode || '')}">
        <div class="m-ph-brand">${esc(it.brand || '')}</div>
        <div class="m-ph-code">${esc(it.shortcode || '')}</div></div>`;
    }, { once:true });
  });
});

/* Covers and thumbnail strips: a cached image that 404s is hidden rather than
   shown broken; the tile's own background and label remain. */
document.querySelectorAll('.mini img, .frame img, .nc-cover img, .nh-cover img').forEach(img => {
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once:true });
});

/* Lightbox — the official embed is fetched ONLY on click, so the page never
   depends on Instagram being reachable in order to look right. */
const lb      = document.getElementById('lb');
const lbFrame = document.getElementById('lbFrame');
const lbBrand = document.getElementById('lbBrand');
const lbOut   = document.getElementById('lbOut');

function openLB(id){
  const it = MEDIA.find(m => m.id === id);
  if(!it || !lb) return false;
  const src = it.platform === 'youtube'
    ? (it.embed || `https://www.youtube.com/embed/${it.shortcode}`) + '?autoplay=1'
    : it.url.replace(/\/?$/, '/') + 'embed/captioned/';
  lbFrame.dataset.p = it.platform;
  lbFrame.innerHTML = `<iframe src="${esc(src)}" title="${esc(it.title || it.brand)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen scrolling="no"></iframe>`;
  lbBrand.textContent = it.brand;
  lbOut.href = it.url;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  return true;
}
function closeLB(){
  if(!lb) return;
  lb.classList.remove('open');
  lbFrame.innerHTML = '';
  document.body.style.overflow = '';
}
document.addEventListener('click', e => {
  const card = e.target.closest('[data-open]');
  // Without JS these are ordinary links to the post; with JS the lightbox wins.
  // If the lightbox cannot open, the link is left to do its normal job.
  if(card){ if(openLB(card.dataset.open)) e.preventDefault(); return; }
  if(lb && (e.target.closest('[data-lb-close]') || e.target === lb)) closeLB();
});
document.addEventListener('keydown', e => { if(e.key === 'Escape' && lb && lb.classList.contains('open')) closeLB(); });

const BRANDS = [
  {name:"Chaipoint", cat:"fnb", role:"F&B — Brand & Campaigns", note:"Flagship F&B case study — Chaipoint × Maggi.", caps:["brand","campaigns"], link:"https://www.instagram.com/p/C8pF5KSo_Qe/"},
  {name:"Samosa Party", cat:"fnb", role:"F&B — Brand Voice", note:"Case study 03 — brand voice for an everyday snack.", caps:["brand","content"], link:null},
  {name:"Krispy Kreme", cat:"fnb", role:"QSR — Content", note:"Case study 04 — playful, repeatable visual language.", caps:["content"], link:null},
  {name:"The Cape Goa", cat:"hospitality", role:"Hospitality — Growth", note:"Case study 01 — selling the escape.", caps:["performance"], link:"https://www.instagram.com/reel/DZukipWvNt6/"},
  {name:"Sila Leisure", cat:"hospitality", role:"Hospitality — Marketing Lead", note:"Case study 01 — selling the escape.", caps:[], link:"https://www.instagram.com/reel/DVa9lAbEcFF/"},
  {name:"Bella Vita Organic", cat:"beauty", role:"Consumer — Performance", note:"Beauty hero brand, Chatterbox Communications.", caps:["brand","performance"], link:"https://www.instagram.com/reel/CqftBD_jhPH/"},
  {name:"Vi-John", cat:"beauty", role:"Social / Performance / Influencer", note:"Chatterbox Communications roster.", caps:["performance","influencer","social"], link:"https://www.instagram.com/reel/CqzlzneoSPE/"},
  {name:"Kevin Murphy India", cat:"beauty", role:"Premium Haircare", note:"Premium beauty portfolio.", caps:[], link:"https://www.instagram.com/kevin.murphy_india"},
  {name:"Olaplex India", cat:"beauty", role:"Premium Haircare", note:"Premium beauty portfolio.", caps:[], link:"https://www.instagram.com/p/DQjTwYdlcFy/"},
  {name:"Dermalogica India", cat:"beauty", role:"Premium Skincare", note:"Premium beauty portfolio.", caps:[], link:"https://www.instagram.com/dermalogicain"},
  {name:"Cahoot (prev. Campus Sutra)", cat:"fashion", role:"Consumer — Digital", note:"3X ROI through influencer marketing.", caps:["performance","influencer","digital"], link:"https://www.instagram.com/reel/CysVtHPytzf/"},
  {name:"InstaFab Plus", cat:"fashion", role:"Consumer — Digital", note:"Scaled growth with a celebrity collaboration.", caps:["performance","influencer","digital"], link:"https://www.instagram.com/reel/C3P1A_JSCP4/"},
  {name:"Sohi", cat:"fashion", role:"Consumer — Brand", note:"Celebrity-backed growth, alongside InstaFab Plus.", caps:["brand","performance","influencer"], link:"https://www.instagram.com/reel/C3P1A_JSCP4/"},
  {name:"Haute Sauce", cat:"lifestyle", role:"Consumer — Content", note:"3X ROI through influencer marketing.", caps:["content","performance","influencer"], link:null},
  {name:"Vybe Beauty Fridge", cat:"lifestyle", role:"ORM / Performance / Influencer", note:"Billionkart roster.", caps:["performance","influencer","social"], link:null},
  {name:"Pourdemistase", cat:"lifestyle", role:"Social Media Marketing", note:"Billionkart roster.", caps:["social"], link:null},
  {name:"Pina Colada", cat:"lifestyle", role:"Social Media Marketing", note:"Billionkart roster.", caps:["social"], link:null},
  {name:"Be Soulfull", cat:"lifestyle", role:"Social / ORM / Performance", note:"Chatterbox Communications roster.", caps:["performance","social"], link:null},
  {name:"Detoxie Skincare", cat:"lifestyle", role:"Social / ORM / Performance", note:"Chatterbox Communications roster.", caps:["performance","social"], link:null},
  {name:"Happier Skincare", cat:"lifestyle", role:"Social / ORM / Performance", note:"Chatterbox Communications roster.", caps:["performance","social"], link:null},
  {name:"Planet Herbs Lifesciences", cat:"lifestyle", role:"Social / ORM / Performance", note:"Chatterbox Communications roster.", caps:["performance","social"], link:null},
  {name:"Veda & Grace", cat:"lifestyle", role:"Social / ORM / Performance", note:"Chatterbox Communications roster.", caps:["performance","social"], link:null},
  {name:"Rapture Entertainment", cat:"other", role:"Celebrity Manager", note:"Supported Parthiv Gohil's events & live shows.", caps:["influencer"], link:"https://www.instagram.com/parthivgohil9"},
  {name:"Bajaj Finance", cat:"other", role:"Social Media Marketing", note:"Handled at Chtrsocial.", caps:["social"], link:null},
  {name:"Chetan Rathod Group", cat:"other", role:"Ad Film", note:"Created an ad film, Chtrsocial.", caps:[], link:null},
  {name:"St. Willibrord International School", cat:"other", role:"Social Strategy", note:"Early career, Aprowress.", caps:["strategy","social"], link:null},
  {name:"Willy Kids Pre-school", cat:"other", role:"Social Strategy", note:"Early career, Aprowress.", caps:["strategy","social"], link:null},
  {name:"Parents As Teachers (PAT)", cat:"other", role:"Social Strategy", note:"Education influencer, Aprowress.", caps:["strategy","influencer","social"], link:null}
];

/* Brand Archive — homepage only; every lookup is guarded so niche pages,
   which have no archive, run the rest of this file untouched. */
const grid = document.getElementById('archiveGrid');
function renderArchive(filter){
  grid.innerHTML = "";
  const capFilter = filter.startsWith('cap:') ? filter.slice(4) : null;
  BRANDS.filter(b => filter === 'all'
    || (capFilter ? (b.caps || []).includes(capFilter) : b.cat === filter)).forEach(b => {
    const el = document.createElement('div');
    el.className = 'arc-item';
    el.innerHTML = `
      <div class="arc-name">${b.name}</div>
      <div class="arc-cat">${b.cat}</div>
      <div class="arc-hover">
        <div>
          <div class="arc-role">${b.role}</div>
          <div class="arc-note">${b.note}</div>
        </div>
        ${b.link ? `<a class="arc-link" href="${b.link}" target="_blank" rel="noopener">Visit brand ↗</a>` : `<span class="arc-link">Details coming next</span>`}
      </div>`;
    grid.appendChild(el);
  });
}
const filterRow = document.getElementById('filterRow');
if (grid && filterRow) {
  renderArchive('all');
  filterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if(!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
    btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
    renderArchive(btn.dataset.filter);
  });
}

/* Mobile menu */
const burger = document.getElementById('burgerBtn');
const mmenu = document.getElementById('mobileMenu');
if (burger && mmenu) {
  burger.addEventListener('click', () => {
    const open = mmenu.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
  });
  mmenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mmenu.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
  }));
}

/* Rotating badge */
const words = ["Strategy","Content","Culture","Growth"];
let wi = 0;
const rw = document.getElementById('rotWord');
if(rw && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  setInterval(() => {
    rw.style.opacity = 0;
    setTimeout(() => {
      wi = (wi + 1) % words.length;
      rw.textContent = words[wi];
      rw.style.opacity = 1;
    }, 350);
  }, 2200);
}

/* Scroll reveal — an entrance animation, never a gate on seeing content.
   .reveal starts at opacity:0, so if nothing ever adds .in-view the block is
   simply invisible. The observer alone is not a guarantee: it is throttled in
   background tabs and on slow devices, and it does not run for a block the
   page jumped past on an anchor link (the "← All work" links land on
   #niches). So: reveal whatever is already on screen straight away and again
   after load and on hash changes, and after 2.5s reveal everything regardless. */
const revealEls = [...document.querySelectorAll('.reveal')];
const show = el => el.classList.add('in-view');
const onScreen = el => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; };
const showOnScreen = () => revealEls.filter(onScreen).forEach(show);
showOnScreen();
window.addEventListener('load', showOnScreen);
window.addEventListener('hashchange', showOnScreen);
if('IntersectionObserver' in window){
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        show(entry.target);
        io.unobserve(entry.target);
      }
    });
  // threshold 0, not a fraction: a block taller than viewport ÷ threshold
  // (≈8 phone screens at 0.12) can never show that share of itself at once,
  // so it would stay invisible forever. Any visible pixel now reveals it.
  }, {threshold:0, rootMargin:'0px 0px -60px 0px'});
  revealEls.forEach(el => io.observe(el));
} else {
  revealEls.forEach(show);
}
setTimeout(() => revealEls.forEach(show), 2500);
