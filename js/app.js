/**
 * Muncho — Food Court Booking App Engine
 *
 * Apple design language on the interaction layer: instant press feedback,
 * 1:1 sheet tracking with velocity handoff, start-from-current-value motion,
 * tabular money, tabular numbers. M3 Expressive radii/tone on the visual layer.
 * Zero dependencies; data comes from data.js, payments from payment.js.
 *
 * The concept: a booking, not a checkout. You reserve your food for the time
 * you'll arrive at the counter — "Airbnb for your food."
 */
(function () {
  'use strict';

  const PAGE = document.body.dataset.page || 'feed';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const cfg = window.MUNCHO_CONFIG || {};
  const feeRate = cfg.serviceFeeRate !== undefined ? cfg.serviceFeeRate : 0.05;
  /* Romanian decimal comma, tabular digits — "45,00 lei" */
  const money = (n) => Number(n).toFixed(2).replace('.', ',') + ' lei';
  const num = (n) => Number(n).toFixed(2).replace('.', ',');
  const BOOKING = Object.assign(
    { open: '10:00', close: '22:00', slotMinutes: 15, minLeadMinutes: 20, slotCount: 10 },
    cfg.booking || {}
  );

  /* haptic — short, only at the moment of visual commit (§13 harmony) */
  const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  /* ==========================================================================
     State & storage (keys unchanged for compatibility)
     ========================================================================== */
  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem('fc-cart') || '{}');
      if (!raw || typeof raw !== 'object') return {};
      return Object.fromEntries(Object.entries(raw).filter(([id, q]) => itemOf(id) && q > 0));
    } catch (e) { return {}; }
  }
  function saveCart() { try { localStorage.setItem('fc-cart', JSON.stringify(cart)); } catch (e) {} }

  function loadFavs() {
    try {
      const raw = JSON.parse(localStorage.getItem('fc-fav') || '[]');
      return new Set(Array.isArray(raw) ? raw.map(String) : []);
    } catch (e) { return new Set(); }
  }
  function saveFavs() { try { localStorage.setItem('fc-fav', JSON.stringify([...favs])); } catch (e) {} }

  function loadOrders() {
    try {
      const raw = JSON.parse(localStorage.getItem('fc-orders') || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }
  function saveOrders() { try { localStorage.setItem('fc-orders', JSON.stringify(orders)); } catch (e) {} }

  let cart = loadCart();
  let favs = loadFavs();
  let orders = loadOrders();
  let activeVenueId = new URLSearchParams(location.search).get('id') || 'sapori';
  let activeFilter = 'All';        // feed category
  let venueFilter = 'All';         // merchant page section
  let query = '';                  // feed search
  let venueQuery = '';             // merchant search
  let selectedPayMethod = 'TEJ';   // TEJ (register) | GOOGLE PAY | APPLE PAY | STRIPE
  let selectedSlot = null;         // { kind: 'asap'|'time', label, day, ts }
  let countdownTimer = null;
  let lastPlacedOrder = null;

  const qty = (id) => cart[id] || 0;
  const cartItemCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
  const cartSubtotal = () => Object.entries(cart).reduce((a, [id, q]) => {
    const it = itemOf(id);
    return a + (it ? it.price * q : 0);
  }, 0);
  const cartFee = () => cartSubtotal() * feeRate;
  const cartTotal = () => cartSubtotal() + cartFee();
  const maxLeadMinutes = () => {
    let lead = BOOKING.minLeadMinutes;
    Object.keys(cart).forEach((id) => {
      const it = itemOf(id);
      if (it && it.eta) {
        const m = String(it.eta).match(/(\d+)\s*$/);
        if (m) lead = Math.max(lead, Number(m[1]));
      }
    });
    if (PAGE === 'venue') {
      const v = venueOf(activeVenueId);
      const m = v && String(v.eta || '').match(/(\d+)\s*$/);
      if (m) lead = Math.max(lead, Number(m[1]));
    }
    return lead;
  };

  /* ==========================================================================
     Booking slot engine — "Airbnb for your food"
     Slots on a 15-min grid, starting after prep lead time, inside mall hours.
     ========================================================================== */
  const DAY_NAMES = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];

  function computeSlots() {
    const grid = BOOKING.slotMinutes * 60000;
    const open = parseHM(BOOKING.open);
    const close = parseHM(BOOKING.close);
    let first = Date.now() + maxLeadMinutes() * 60000;
    first = Math.ceil(first / grid) * grid; // snap to grid, never before lead

    let startDay = new Date(first); startDay.setHours(0, 0, 0, 0);
    let dayStart = startDay.getTime();
    let openAt = dayStart + open * 60000;
    let closeAt = dayStart + close * 60000;

    // roll to next day if we're past closing today (or before opening)
    if (first > closeAt) {
      dayStart += 86400000;
      openAt = dayStart + open * 60000;
      closeAt = dayStart + close * 60000;
      first = Math.max(first, openAt - ((Date.now() + maxLeadMinutes() * 60000) % grid), openAt);
    } else if (first < openAt) {
      first = openAt;
    }

    const slots = [];
    let t = first;
    let rolled = first >= dayStart + 86400000; // not currently used; keeps guard simple
    const now = Date.now();
    while (slots.length < BOOKING.slotCount && t < closeAt) {
      const when = new Date(t);
      slots.push({
        ts: t,
        label: fmtHM(when),
        day: dayLabel(when),
        dayKey: when.toDateString(),
        minutes: Math.round((t - now) / 60000)
      });
      t += grid;
    }
    // if nothing fits before closing, move to tomorrow's opening (rare late-night case)
    if (!slots.length) {
      let next = dayStart + 86400000 + open * 60000;
      for (let i = 0; i < BOOKING.slotCount; i++) {
        const when = new Date(next);
        slots.push({
          ts: next, label: fmtHM(when), day: dayLabel(when),
          dayKey: when.toDateString(), minutes: Math.round((next - now) / 60000)
        });
        next += grid;
      }
    }
    return slots;
  }

  function parseHM(hm) {
    const [h, m] = String(hm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  function fmtHM(d) {
    return d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  }
  function dayLabel(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const diff = Math.round((that - today) / 86400000);
    if (diff === 0) return 'Astăzi';
    if (diff === 1) return 'Mâine';
    return DAY_NAMES[d.getDay()];
  }

  function initSlotSelection() {
    const slots = computeSlots();
    if (selectedSlot && slots.some((s) => s.ts === selectedSlot.ts)) return;
    const first = slots[0];
    selectedSlot = { kind: 'asap', ts: first.ts, label: first.label, day: first.day, minutes: first.minutes };
  }

  function slotDisplay() {
    if (!selectedSlot) initSlotSelection();
    if (selectedSlot.kind === 'asap') {
      const soon = computeSlots()[0];
      return { kind: 'asap', label: soon.label, day: soon.day, ts: soon.ts, eta: `în ~${soon.minutes} min` };
    }
    return {
      kind: 'time', label: selectedSlot.label, day: selectedSlot.day, ts: selectedSlot.ts,
      eta: `rezervat ${selectedSlot.day.toLowerCase()} ${selectedSlot.label}`
    };
  }

  /* ==========================================================================
     Shared UI atoms
     ========================================================================== */
  const ICONS = {
    back: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    bag: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
    store: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1-5h14l1 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5 4 2z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 11v5"/></svg>',
    zap: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/></svg>',
    gpLogo: '<svg viewBox="0 0 48 48" width="19" height="19"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
    appleLogo: '<svg viewBox="0 0 170 170" width="17" height="17" fill="currentColor"><path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.66-7.85-11.87-14.42-6.19-9.58-11.05-20.73-14.59-33.45-3.53-12.72-5.3-24.62-5.3-35.7 0-14.9 3.53-27.18 10.59-36.85 7.06-9.67 15.86-14.63 26.41-14.88 5.12 0 10.4 1.34 15.84 4.02 5.44 2.68 9.27 4.08 11.48 4.2 1.8 0 5.8-1.5 12-4.5 6.21-3.01 11.66-4.43 16.36-4.26 12.4.67 22.38 5.14 29.93 13.41-10.88 6.59-16.2 15.65-15.96 27.18.24 9.15 3.73 16.87 10.47 23.16 6.74 6.29 14.75 9.77 24.03 10.45-2.22 6.86-4.8 13.8-7.74 20.82zM119.22 31.84c0-7.18 2.6-13.85 7.8-20.01 5.2-6.16 11.66-9.96 19.38-11.41.24 1.08.36 2.05.36 2.9 0 7.06-2.73 13.79-8.19 20.19-5.46 6.4-12.02 10.15-19.68 11.25-.12-.96-.2-1.93-.2-2.92z"/></svg>'
  };

  function toast(html) {
    const el = $('#toast');
    if (!el) return;
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function renderControl(id) {
    const q = qty(id);
    if (!itemOf(id)) return '';
    if (q > 0) {
      return `
        <span class="stepper" data-id="${id}">
          <button type="button" data-action="dec" data-id="${id}" aria-label="Scade cantitatea">−</button>
          <span class="qv num" aria-live="polite">${q}</span>
          <button type="button" data-action="inc" data-id="${id}" aria-label="Crește cantitatea">+</button>
        </span>`;
    }
    return `
      <button type="button" class="add-btn" data-action="add" data-id="${id}" aria-label="Adaugă în coș">
        Adaugă
      </button>`;
  }

  function favBtn(id) {
    const on = favs.has(String(id));
    return `
      <button type="button" class="fav-btn ${on ? 'on' : ''}" data-action="fav" data-id="${id}" aria-pressed="${on}" aria-label="Salvează în favorite">
        ${ICONS.heart}
      </button>`;
  }

  /* ==========================================================================
     Cards
     ========================================================================== */
  function venueCard(v) {
    return `
      <a class="venue-card rise" href="venue.html?id=${encodeURIComponent(v.id)}">
        <div class="venue-cover">
          <img src="${v.hero || v.logo}" alt="${esc(v.name)}" loading="lazy" />
          <span class="venue-flag">${esc(v.directApi ? 'Direct API' : v.tag || 'Food Court')}</span>
          <span class="venue-eta num">~${esc(v.eta)} min</span>
        </div>
        <div class="venue-body">
          <h3>${esc(v.name)}</h3>
          <p class="venue-cat">${esc(v.cat)}</p>
          <div class="venue-stats">
            ${ICONS.star}<span>${esc(v.rating)}</span><span class="muted">(${esc(v.reviews)})</span>
          </div>
        </div>
      </a>`;
  }

  /* ==========================================================================
     Floating tray (dynamic-island commit bar)
     ========================================================================== */
  function updateTray() {
    const tray = $('#tray-dock');
    const n = cartItemCount();
    if (!tray) return;
    if (n > 0) {
      tray.classList.add('up');
      $('#tray-count').textContent = n === 1 ? '1 produs' : n + ' produse';
      $('#tray-sum').textContent = money(cartTotal()).replace(' lei', ' lei');
    } else {
      tray.classList.remove('up');
    }
    $$('.tab .bub').forEach((b) => {
      if (b.dataset.bub === 'orders') {
        b.hidden = orders.length === 0;
        b.textContent = orders.length;
      } else {
        b.hidden = n === 0;
        b.textContent = n;
      }
    });
  }

  function setQty(id, next) {
    next = Math.max(0, Math.min(30, next));
    if (next === 0) delete cart[id];
    else cart[id] = next;
    saveCart();
    updateTray();
    refreshCardControl(id); /* feed + venue cards share the anchor */
    if (PAGE === 'checkout') renderCheckout(false);

    // an open cart sheet is the visible cart — keep it in lockstep on any page
    const cs = $('#cart-sheet');
    if (cs && cs.classList.contains('up')) {
      const row = document.querySelector(`#cart-sheet-body .cart-sheet-row[data-id="${id}"]`);
      if (row) {
        if (cart[id]) row.outerHTML = cartRow(id);
        else row.remove();
      }
      const tot = $('#cart-sheet-total');
      if (tot) tot.textContent = money(cartTotal());
    }
    buzz(6);
  }

  /* Re-render only affected cards — keeps scroll & motion uninterrupted.
     Every feed/menu card exposes [data-card][data-id] and a .ctl-slot anchor. */
  function refreshCardControl(id) {
    const slot = document.querySelector(`[data-card][data-id="${id}"] .ctl-slot`);
    if (slot) slot.innerHTML = renderControl(id);
  }

  /* ==========================================================================
     Sheets — open/close + drag-to-dismiss with velocity handoff
     ========================================================================== */
  function sheetEl(id) { return document.getElementById(id); }

  function openSheet(id) {
    const sheet = sheetEl(id);
    if (!sheet) return;
    const scrim = $('#sheet-scrim');
    sheet.classList.add('up');
    sheet.style.translate = '';
    if (scrim) scrim.classList.add('dim');
    document.documentElement.style.overflow = 'hidden';
  }

  function closeSheet(id) {
    const sheet = sheetEl(id);
    const scrim = $('#sheet-scrim');
    if (sheet) {
      sheet.classList.remove('up');
      sheet.style.translate = '';
    }
    if (scrim) scrim.classList.remove('dim');
    document.documentElement.style.overflow = '';
  }

  function closeTopSheet() {
    const open = $$('.sheet.up');
    if (!open.length) return false;
    closeSheet(open[open.length - 1].id);
    return true;
  }

  /* 1:1 drag on the grip; release hands velocity to the exit/settle motion. */
  function initSheetDrag() {
    $$('.sheet').forEach((sheet) => {
      const grip = sheet.querySelector('.sheet-grip');
      if (!grip) return;
      let startY = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, pulled = 0;

      grip.addEventListener('pointerdown', (e) => {
        if (!sheet.classList.contains('up')) return;
        dragging = true;
        startY = lastY = e.clientY;
        lastT = e.timeStamp;
        vel = 0; pulled = 0;
        sheet.classList.add('dragging');
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        pulled = Math.max(0, dy);
        const dt = Math.max(1, e.timeStamp - lastT);
        vel = (e.clientY - lastY) / dt * 1000; // px/s
        lastY = e.clientY; lastT = e.timeStamp;
        // rubber-band: progressively resist past origin (§9)
        const damped = (pulled * 420) / (420 + pulled);
        sheet.style.translate = `0 ${damped}px`;
      });
      const release = () => {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove('dragging');
        if (pulled > 90 || vel > 480) {
          closeSheet(sheet.id);
        } else {
          sheet.style.translate = '';
        }
      };
      grip.addEventListener('pointerup', release);
      grip.addEventListener('pointercancel', release);
    });
  }

  /* ==========================================================================
     Feed page
     ========================================================================== */
  function renderFeed() {
    const rail = $('#venues-rail');
    if (rail && typeof VENUES !== 'undefined') rail.innerHTML = VENUES.map(venueCard).join('');

    const chips = $('#cat-chips');
    if (chips && typeof FILTERS !== 'undefined') {
      chips.innerHTML = FILTERS.map((f) => `
        <button type="button" class="chip ${activeFilter === f ? 'on' : ''}" data-action="cat" data-cat="${esc(f)}">${esc(f === 'All' ? 'Toate' : f)}</button>
      `).join('');
    }

    renderFeedDishes();
  }

  /* ==========================================================================
     Card shapes — editorial feed: features, tiles, grid, venue jumps.
     Every dish photo carries the venue's logo over it (brand badge).
     ========================================================================== */
  function brandBadge(venueId, cls = '') {
    const v = venueOf(venueId);
    if (!v) return '';
    return `<span class="media-brand${cls ? ' ' + cls : ''}" aria-hidden="true"><img src="${v.logo || v.hero}" alt="" loading="lazy" /></span>`;
  }

  const priceHtml = (n) => `${num(n)}<small>&nbsp;lei</small>`;

  function featureCard(it) {
    const venue = venueOf(it.venue);
    return `
      <article class="feature-card" data-card data-id="${it.id}">
        <button type="button" class="press f-press" data-action="open-venue" data-venue="${it.venue}" aria-label="Vezi ${esc(venue ? venue.name : 'meniul')}">
          <span class="f-media">
            <img src="${it.img}" alt="${esc(it.title)}" loading="lazy" />
            <span class="media-veil"></span>
            ${it.badge ? `<span class="f-badge">${esc(it.badge)}</span>` : ''}
            ${brandBadge(it.venue)}
          </span>
          <span class="f-copy">
            <span class="f-title">${esc(it.title)}</span>
            <span class="f-venue">${esc(venue ? venue.name : '')}</span>
          </span>
        </button>
        ${favBtn(it.id)}
        <div class="f-foot">
          <span class="f-price num">${priceHtml(it.price)}</span>
          <span class="ctl-slot">${renderControl(it.id)}</span>
        </div>
      </article>`;
  }

  function leadRow(it) {
    const venue = venueOf(it.venue);
    return `
      <article class="vlead" data-card data-id="${it.id}">
        <div class="vl-copy">
          ${it.badge ? `<span class="dish-flag">${esc(it.badge)}</span>` : ''}
          <h3 class="vl-title">${esc(it.title)}</h3>
          <p class="vl-desc">${esc(it.desc || '')}</p>
          <div class="vl-foot">
            <span class="vl-price num">${priceHtml(it.price)}</span>
            <span class="ctl-slot">${renderControl(it.id)}</span>
          </div>
        </div>
        <div class="vl-media">
          <img src="${it.img}" alt="${esc(it.title)}" loading="lazy" />
          ${brandBadge(it.venue, 'sm')}
        </div>
        ${favBtn(it.id)}
      </article>`;
  }

  function tileCard(it) {
    const venue = venueOf(it.venue);
    return `
      <article class="tile" data-card data-id="${it.id}">
        <button type="button" class="press t-press" data-action="open-venue" data-venue="${it.venue}" aria-label="Vezi ${esc(venue ? venue.name : 'meniul')}">
          <span class="t-media">
            <img src="${it.img}" alt="${esc(it.title)}" loading="lazy" />
            <span class="media-veil"></span>
            ${brandBadge(it.venue, 'sm')}
          </span>
          <span class="t-copy">
            <span class="t-title">${esc(it.title)}</span>
            <span class="t-venue">${esc(venue ? venue.name : '')}</span>
          </span>
        </button>
        <div class="t-foot">
          <span class="t-price num">${priceHtml(it.price)}</span>
          <span class="ctl-slot">${renderControl(it.id)}</span>
        </div>
      </article>`;
  }

  function gridCard(it) {
    const venue = venueOf(it.venue);
    return `
      <article class="grid-card" data-card data-id="${it.id}">
        <button type="button" class="press g-press" data-action="open-venue" data-venue="${it.venue}" aria-label="Vezi ${esc(venue ? venue.name : 'meniul')}">
          <span class="g-media">
            <img src="${it.img}" alt="${esc(it.title)}" loading="lazy" />
            <span class="media-veil"></span>
            ${brandBadge(it.venue)}
          </span>
          <span class="g-copy">
            <span class="g-venue">${esc(venue ? venue.name : '')}</span>
            <span class="g-title">${esc(it.title)}</span>
          </span>
        </button>
        ${favBtn(it.id)}
        <div class="g-foot">
          <span class="g-price num">${priceHtml(it.price)}</span>
          <span class="ctl-slot">${renderControl(it.id)}</span>
        </div>
      </article>`;
  }

  function venueJumpRail() {
    if (typeof VENUES === 'undefined') return '';
    return `<div class="vj-rail">${VENUES.map((v) => `
      <a class="vj" href="venue.html?id=${encodeURIComponent(v.id)}" aria-label="Deschide ${esc(v.name)}">
        <span class="vj-logo"><img src="${v.logo || v.hero}" alt="" loading="lazy" /></span>
        <span class="vj-name">${esc(v.name)}</span>
        <span class="vj-eta num">~${esc(v.eta)} min</span>
      </a>`).join('')}</div>`;
  }

  function sepBlock(label) {
    return `<div class="stream-sep" role="separator"><span>${esc(label)}</span></div>`;
  }

  /* ======================= Feed composer ======================= */
  function renderFeedDishes() {
    const list = $('#dish-stream');
    if (!list || typeof ITEMS === 'undefined') return;
    let items = ITEMS.slice();
    if (activeFilter !== 'All') items = items.filter((i) => i.cat === activeFilter);
    if (query) {
      const q = query.trim().toLowerCase();
      items = items.filter((i) =>
        (i.title + ' ' + (i.desc || '') + ' ' + (i.cat || '') + ' ' + (i.venueName || '')).toLowerCase().includes(q));
    }

    const headEl = $('#dish-stream-title');
    const subEl = $('#dish-stream-sub');
    if (headEl) {
      headEl.textContent = query ? `„${query.trim()}”` : (activeFilter === 'All' ? 'Recomandate' : activeFilter);
    }
    if (subEl) {
      subEl.textContent = items.length === 0 ? '' : (items.length === 1 ? 'un preparat' : `${items.length} preparate`);
    }

    if (!items.length) {
      list.innerHTML = `
        <div class="empty-box rise">
          <strong>Niciun preparat găsit${query ? ` pentru „${esc(query)}”` : ''}</strong>
          <p>Încearcă pizza, burgeri, paste, noodles sau clătite.</p>
          <button type="button" class="btn-secondary" data-action="reset-filter">Afișează tot</button>
        </div>`;
      return;
    }

    /* Non-linear composition: hero pair, venue jumps, scroll rail, grid —
       segmented with separator labels so the eye can travel with rhythm. */
    const parts = [];
    const [first, second, ...rest] = items;
    parts.push(`<div class="feature-duo">${featureCard(first)}${second ? featureCard(second) : ''}</div>`);

    if (!query && activeFilter === 'All') {
      parts.push(sepBlock('Pe local'));
      parts.push(venueJumpRail());
      if (rest.length) {
        parts.push(sepBlock('Rapide de luat'));
        parts.push(`<div class="tile-rail">${rest.slice(0, 4).map(tileCard).join('')}</div>`);
      }
      const more = rest.slice(4);
      if (more.length) {
        parts.push(sepBlock('Toate preparatele'));
        parts.push(`<div class="dish-grid">${more.map(gridCard).join('')}</div>`);
      }
    } else {
      if (rest.length) parts.push(`<div class="dish-grid">${rest.map(gridCard).join('')}</div>`);
    }

    list.innerHTML = parts.filter((p) => p && p.length > 1).join('');
  }

  /* ==========================================================================
     Merchant page
     ========================================================================== */
  function renderMerchant() {
    const hero = $('#venue-hero');
    const v = venueOf(activeVenueId);
    if (!v) { location.replace('index.html'); return; }

    document.title = `${v.name} — Muncho Food Court Argeș Mall`;

    if (hero) {
      hero.innerHTML = `
        <img src="${v.hero}" alt="${esc(v.name)}" />
        <div class="hero-fade"></div>
        <div class="hero-controls">
          <a href="index.html" class="round-btn on-glass" aria-label="Înapoi la food court">${ICONS.back}</a>
          <span class="venue-eta num" style="position:static;">~${esc(v.eta)} min</span>
        </div>`;
    }

    const intro = $('#venue-intro');
    if (intro) {
      intro.innerHTML = `
        <span class="kicker">${esc(v.directApi ? '⚡ Conexiune directă' : esc(v.tag || ''))}</span>
        <h1>${esc(v.name)}</h1>
        <p class="about">${esc(v.about || '')}</p>`;
    }

    const pills = $('#venue-pillrow');
    if (pills) {
      pills.innerHTML = `
        <span class="stat-pill">${ICONS.star} ${esc(v.rating)} <span style="color:var(--ink-3)">(${esc(v.reviews)})</span></span>
        <span class="stat-pill">${ICONS.pin} Argeș Mall · Nivel 1</span>`;
    }

    renderVenueChips();
    renderVenueMenu();
  }

  function renderVenueChips() {
    const chips = $('#venue-chips');
    const v = venueOf(activeVenueId);
    if (!chips || !v) return;
    const sections = (typeof SECTIONS !== 'undefined' && SECTIONS[v.id]) ? SECTIONS[v.id] : [];
    chips.innerHTML = ['All', ...sections].map((s) => `
      <button type="button" class="chip ${venueFilter === s ? 'on' : ''}" data-action="venue-cat" data-cat="${esc(s)}">${esc(s === 'All' ? 'Toate' : s)}</button>
    `).join('');
  }

  function renderVenueMenu() {
    const box = $('#venue-menu');
    const v = venueOf(activeVenueId);
    if (!box || !v || typeof ITEMS === 'undefined') return;

    let items = itemsOfVenue(v.id);
    if (venueQuery) {
      const q = venueQuery.trim().toLowerCase();
      items = items.filter((i) => (i.title + ' ' + (i.desc || '') + ' ' + (i.cat || '')).toLowerCase().includes(q));
      box.innerHTML = `
        <div class="sec-head"><h2>Rezultate (${items.length})</h2></div>
        <div class="dish-grid">${items.length ? items.map(gridCard).join('') :
          `<div class="empty-box"><p>Niciun preparat găsit.</p></div>`}</div>`;
      return;
    }

    const sections = (typeof SECTIONS !== 'undefined' && SECTIONS[v.id]) ? SECTIONS[v.id] : [];
    const shown = (venueFilter === 'All') ? sections : [venueFilter];

    box.innerHTML = shown.map((sec) => {
      const secItems = items.filter((i) => i.cat === sec);
      if (!secItems.length) return '';
      const [lead, ...tail] = secItems;
      return `
        <section data-section="${esc(sec)}">
          <div class="sec-head"><h2>${esc(sec)}</h2><span class="sec-sub">${secItems.length} preparate</span></div>
          ${leadRow(lead)}
          ${tail.length ? `<div class="dish-grid">${tail.map(gridCard).join('')}</div>` : ''}
        </section>`;
    }).join('');
  }

  /* ==========================================================================
     Checkout / booking page
     ========================================================================== */
  function cartRow(id) {
    const it = itemOf(id);
    const q = cart[id];
    if (!it) return '';
    const v = venueOf(it.venue);
    return `
      <div class="rowline cart-sheet-row" data-card data-id="${id}">
        <img src="${it.img}" alt="${esc(it.title)}" />
        <div class="grow">
          <strong>${esc(it.title)}</strong>
          <span>${esc(v ? v.name : 'Food Court')} · ${money(it.price)}</span>
        </div>
        <div class="row-ctl">
          <span class="ctl-slot">${renderControl(id)}</span>
          <span class="num amount">${money(it.price * q)}</span>
        </div>
      </div>`;
  }

  function slotPicker(compact) {
    const slots = computeSlots();
    if (!selectedSlot || !slots.some((s) => s.ts === selectedSlot.ts)) initSlotSelection();
    const disp = slotDisplay();
    return `
      <div class="slot-title">${compact ? ICONS.clock : ICONS.calendar}
        <span>${compact ? 'Ridicare' : 'Când vii să ridici?'}</span>
        <span class="free">fără cost</span>
      </div>
      ${compact ? '' : `
      <div class="seg" role="tablist" aria-label="Mod de ridicare">
        <button type="button" class="${selectedSlot.kind === 'asap' ? 'on' : ''}" data-action="slot-mode" data-mode="asap" role="tab" aria-selected="${selectedSlot.kind === 'asap'}">Cât mai repede</button>
        <button type="button" class="${selectedSlot.kind === 'time' ? 'on' : ''}" data-action="slot-mode" data-mode="time" role="tab" aria-selected="${selectedSlot.kind === 'time'}">Rezervă ora</button>
      </div>`}
      <div class="slot-rail" ${compact ? 'aria-hidden="true"' : ''} ${compact ? 'hidden' : ''}>
        ${slots.map((s) => `
          <button type="button" class="slot-chip ${selectedSlot.kind === 'time' && selectedSlot.ts === s.ts ? 'on' : ''}"
            data-action="slot" data-ts="${s.ts}" aria-pressed="${selectedSlot.kind === 'time' && selectedSlot.ts === s.ts}">
            <span class="t">${s.label}</span><span class="d">${s.day}</span>
          </button>`).join('')}
      </div>
      <p class="slot-note">${ICONS.check} Gata la <strong>&nbsp;${disp.label}</strong> · ${disp.day} · ${disp.eta}</p>`;
  }

  function payOption(method, title, sub, iconHtml) {
    const on = selectedPayMethod === method;
    return `
      <button type="button" class="pay-opt ${on ? 'on' : ''}" data-action="pay-method" data-method="${esc(method)}" role="radio" aria-checked="${on}">
        <span class="pi">${iconHtml}</span>
        <span class="pt"><strong>${esc(title)}</strong><span>${sub}</span></span>
        <span class="mark"></span>
      </button>`;
  }

  function renderPayOptions() {
    const grid = $('#pay-options');
    if (!grid) return;
    const stripe = (cfg.stripe && cfg.stripe.publishableKey) ? cfg.stripe : null;
    const hasGoogle = !!(cfg.payments && cfg.payments.enableGooglePay);
    const hasApple = !!(cfg.payments && cfg.payments.enableApplePay);

    grid.innerHTML = [
      payOption('TEJ', 'Plătești la ridicare', 'Rezervi acum, plătești la tejghea — fără card', ICONS.bag),
      hasGoogle ? payOption('GOOGLE PAY', 'Google Pay', 'Foaia Google Pay se deschide direct', ICONS.gpLogo) : '',
      hasApple ? payOption('APPLE PAY', 'Apple Pay', 'Doar în Safari (iPhone / Mac)', ICONS.appleLogo) : '',
      stripe ? payOption('STRIPE', 'Card (Stripe)', `Test · ${stripe.platformFeePercentage || 0}% taxă platformă`, ICONS.card) : ''
    ].join('');
  }

  function renderCheckout(resetScroll) {
    const list = $('#checkout-items');
    const totals = $('#checkout-totals');
    const submit = $('#btn-reserve');
    if (!list || !totals) return;

    const ids = Object.keys(cart);
    if (!ids.length) {
      list.innerHTML = `
        <div class="empty-box">
          <strong>Nu ai nimic rezervat</strong>
          <p>Alege preparatele și revino aici pentru a-ți fixa ora.</p>
          <a class="btn-secondary tap" href="index.html">Înapoi la food court</a>
        </div>`;
      totals.innerHTML = '';
      if (submit) { submit.disabled = true; submit.textContent = 'Coș gol'; }
      const dock = $('#checkout-dock');
      if (dock) dock.hidden = true;
      return;
    }

    list.innerHTML = ids.map(cartRow).join('');
    const sub = cartSubtotal(), fee = cartFee(), total = cartTotal();
    totals.innerHTML = `
      <div class="trow"><span>Preparate</span><span class="num">${money(sub)}</span></div>
      <div class="trow"><span>Serviciu Food Court (5%)</span><span class="num">${money(fee)}</span></div>
      <div class="trow grand"><span>Total</span><span class="num">${money(total)}</span></div>`;

    if (submit) { submit.disabled = false; submit.textContent = `Rezervă · ${money(total).replace(' lei', '')} lei`; }

    const slotBox = $('#slot-box');
    if (slotBox) slotBox.innerHTML = slotPicker(false);

    renderPayOptions();
    if (resetScroll !== false) window.scrollTo(0, 0);
  }

  /* ---- Order finalization (shared by register / GPay / Apple / Stripe) ---- */
  function buildOrderData() {
    return {
      items: Object.entries(cart).map(([id, q]) => ({ id, item: itemOf(id), qty: q })),
      subtotal: cartSubtotal(),
      fee: cartFee(),
      total: cartTotal(),
      slot: slotDisplay(),
      customer: { name: '', phone: '', notes: '' }
    };
  }

  async function placeOrder(payResult) {
    const data = buildOrderData();
    buzz(14);

    // direct kitchen sync (Sapori) — unchanged bridge
    const saporiItems = data.items
      .filter((x) => x.item && x.item.venue === 'sapori')
      .map((x) => ({ productId: x.item.id, qty: x.qty }));
    let saporiSync = null;
    if (saporiItems.length && window.MunchoSaporiBridge) {
      saporiSync = await window.MunchoSaporiBridge.createVirtualCart(saporiItems);
    }

    const code = 'M-' + (100 + Math.floor(Math.random() * 899));
    lastPlacedOrder = {
      id: 'ord_' + Date.now(),
      code,
      total: data.total,
      payMethod: (payResult && payResult.method) || selectedPayMethod,
      payTx: (payResult && payResult.transactionId) || null,
      payDemo: !!(payResult && payResult.demo),
      date: new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      itemsCount: cartItemCount(),
      items: data.items.map((x) => ({ title: x.item.title, qty: x.qty, price: x.item.price, venue: x.item.venue })),
      slot: data.slot,
      customer: data.customer,
      saporiCartId: (saporiSync && saporiSync.cartId) || null,
      saporiUrl: (saporiSync && saporiSync.directUrl) || null,
      status: 'în pregătire'
    };

    orders.unshift(lastPlacedOrder);
    saveOrders();
    cart = {};
    saveCart();
    updateTray();

    // The ticket is the user's product — render it immediately; kitchen
    // dispatch is a background concern and must never block it.
    showSuccess(lastPlacedOrder);

    if (window.MunchoDispatch) {
      window.MunchoDispatch.sendOrder(lastPlacedOrder)
        .then((dispatchInfo) => {
          lastPlacedOrder.dispatch = dispatchInfo;
          renderDispatchNote(dispatchInfo);
        })
        .catch(() => {
          renderDispatchNote({ delivered: false, results: [] });
        });
    } else {
      renderDispatchNote({ delivered: false, results: [] });
    }
  }

  function ticketUrl(order) {
    const base = location.pathname.replace(/[^/]*$/, '');
    return location.origin + base + 'comanda.html#o=' + encodeTicket(order);
  }
  function encodeTicket(order) {
    const data = {
      c: order.code,
      d: order.date,
      t: Math.round(Number(order.total) * 100) / 100,
      m: order.payMethod,
      s: order.slot ? `${order.slot.label} · ${order.slot.day}` : '',
      i: (order.items || []).map((x) => [String(x.title).slice(0, 44), x.qty, x.price])
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(data))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function renderQr(order) {
    const box = $('#order-qr');
    if (!box) return;
    box.innerHTML = '';
    if (!window.qrcode) return;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(ticketUrl(order));
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 6, scalable: true });
      const svg = box.querySelector('svg');
      if (svg) { svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; }
    } catch (e) {
      box.textContent = '#' + order.code;
    }
  }

  function renderDispatchNote(dispatchInfo) {
    const disp = $('#dispatch-note');
    if (!disp) return;
    const okCh = (dispatchInfo.results || []).filter((r) => r.ok)
      .map((r) => (r.channel === 'ntfy' ? 'notificare bucătărie' : r.channel));
    disp.innerHTML = dispatchInfo.delivered
      ? `<strong style="color:var(--green)">✓ Tichet trimis la bucătărie</strong> (${okCh.join(' + ')})`
      : `<strong style="color:var(--danger)">⚠ Trimiterea automată a eșuat</strong> — folosește butonul WhatsApp de mai jos.`;
  }

  function showSuccess(order) {
    const form = $('#booking-form');
    const success = $('#booking-success');
    const dock = $('#checkout-dock');
    if (!form || !success) return;
    form.hidden = true;
    success.hidden = false;
    if (dock) dock.hidden = true;
    $('#final-code').textContent = '#' + order.code;

    const slotPill = $('#pickup-slot-label');
    if (slotPill) slotPill.textContent = `Ridicare: ${order.slot.day} · ${order.slot.label}`;
    const st = $('#success-total');
    if (st) st.textContent = money(order.total);
    const tt = $('#tl-time');
    if (tt) tt.textContent = `plasată ${order.date}`;
    const tsl = $('#tl-slot');
    if (tsl) tsl.textContent = `Gata la ${order.slot.label}`;

    $('#success-summary').innerHTML = (order.items || []).map((x) => `
      <div class="rowline">
        <div class="grow"><strong>${esc(x.title)}</strong><span>× ${x.qty}</span></div>
        <span class="num amount">${money(x.price * x.qty)}</span>
      </div>`).join('');

    renderQr(order);
    startCountdown(order);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startCountdown(order) {
    const el = $('#slot-countdown');
    if (!el) return;
    clearInterval(countdownTimer);
    const tick = () => {
      const soon = order.slot && order.slot.ts ? order.slot.ts : computeSlots()[0].ts;
      const mins = Math.round((soon - Date.now()) / 60000);
      el.textContent = mins > 0
        ? `Mâncarea ta va fi gata la ${order.slot.label} — în ${mins} min`
        : 'Mâncarea ta ar trebui să fie gata — prezintă codul la tejghea';
    };
    tick();
    countdownTimer = setInterval(tick, 30000);
  }

  async function handleReserve(explicitPayResult, explicitMethod) {
    if (!cartItemCount()) { toast('Coșul e gol — alege mai întâi preparate.'); return; }
    const btn = $('#btn-reserve');
    if (btn) { btn.disabled = true; }
    try {
      let payResult = explicitPayResult;
      if (!payResult) {
        const method = explicitMethod || selectedPayMethod;
        payResult = await window.MunchoPayments.processPayment(buildOrderData(), method);
      }
      await placeOrder(payResult);
    } catch (err) {
      toast(esc((err && err.message) || 'Comanda nu a putut fi plasată.'));
      if (btn) btn.disabled = false;
    }
  }

  /* ==========================================================================
     Sheets content
     ========================================================================== */
  function renderCartSheet() {
    const box = $('#cart-sheet-body');
    const foot = $('#cart-sheet-foot');
    if (!box) return;
    const ids = Object.keys(cart);
    if (!ids.length) {
      box.innerHTML = `<div class="empty-box"><strong>Coșul e gol</strong><p>Alege preparate din meniu.</p></div>`;
      if (foot) foot.style.display = 'none';
      return;
    }
    box.innerHTML = ids.map(cartRow).join('');
    if (foot) {
      foot.style.display = '';
      $('#cart-sheet-total').textContent = money(cartTotal());
    }
  }

  function renderVenuesSheet() {
    const box = $('#venues-sheet-body');
    if (!box || typeof VENUES === 'undefined') return;
    box.innerHTML = VENUES.map((v) => `
      <a class="rowline" href="venue.html?id=${encodeURIComponent(v.id)}">
        <img src="${v.logo || v.hero}" alt="" />
        <div class="grow">
          <strong>${esc(v.name)}</strong>
          <span>${esc(v.cat)} · ~${esc(v.eta)} min</span>
        </div>
        ${ICONS.arrow}
      </a>`).join('');
  }

  function renderOrdersSheet() {
    const box = $('#orders-sheet-body');
    if (!box) return;
    const rows = (typeof VENUES !== 'undefined' ? orders : []).map((o) => `
      <div class="order-row">
        <div class="top">
          <code>#${esc(o.code)}</code>
          <span class="num">${money(o.total)}</span>
        </div>
        <div class="when">${esc(o.date)}${o.slot ? ' · ridicare ' + esc(o.slot.label) + ' (' + esc(o.slot.day) + ')' : ''}</div>
        <div class="items">${esc((o.items || []).map((x) => `${x.qty}× ${x.title}`).join(', '))}</div>
        <div class="when">Plată: ${esc(payLabel(o.payMethod))}</div>
      </div>`).join('');
    box.innerHTML = rows || `
      <div class="empty-box">
        <strong>Nicio comenzi încă</strong>
        <p>Rezervările tale vor apărea aici, cu ora de ridicare.</p>
      </div>`;
  }

  function payLabel(m) {
    return ({ TEJ: 'la ridicare', 'GOOGLE PAY': 'Google Pay', 'APPLE PAY': 'Apple Pay', STRIPE: 'card', CASH: 'numerar', SAVE: 'la ridicare' })[m] || m || '—';
  }

  /* ==========================================================================
     Events
     ========================================================================== */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const id = t.dataset.id;
    switch (t.dataset.action) {
      case 'add': setQty(id, qty(id) + 1); toast(`Adăugat în coș ✓`); break;
      case 'inc': setQty(id, qty(id) + 1); break;
      case 'dec': setQty(id, qty(id) - 1); break;
      case 'fav': {
        const key = String(id);
        if (favs.has(key)) favs.delete(key); else favs.add(key);
        saveFavs();
        t.classList.toggle('on', favs.has(key));
        t.setAttribute('aria-pressed', String(favs.has(key)));
        buzz(6);
        break;
      }
      case 'cat': {
        activeFilter = t.dataset.cat;
        query = '';
        const si = $('#search-input'); if (si) { si.value = ''; si.closest('.search')?.classList.remove('has-text'); }
        const sc = $('#search-clear'); if (sc) sc.hidden = true;
        $$('.chip[data-action="cat"]').forEach((c) =>
          c.classList.toggle('on', c.dataset.cat === activeFilter));
        renderFeedDishes();
        break;
      }
      case 'venue-cat': {
        venueFilter = t.dataset.cat;
        $$('.chip[data-action="venue-cat"]').forEach((c) =>
          c.classList.toggle('on', c.dataset.cat === venueFilter));
        renderVenueMenu();
        break;
      }
      case 'open-venue':
        location.href = 'venue.html?id=' + encodeURIComponent(t.dataset.venue);
        break;
      case 'reset-filter':
        activeFilter = 'All';
        renderFeedDishes();
        break;
      case 'open-cart-sheet': renderCartSheet(); openSheet('cart-sheet'); break;
      case 'close-sheet': closeTopSheet(); break;
      case 'open-venues-sheet': renderVenuesSheet(); openSheet('venues-sheet'); break;
      case 'open-orders-sheet': renderOrdersSheet(); openSheet('orders-sheet'); break;
      case 'checkout-go': location.href = 'checkout.html'; break;
      case 'slot-mode': {
        if (t.dataset.mode === selectedSlot.kind) break;
        const slots = computeSlots();
        if (t.dataset.mode === 'asap') {
          selectedSlot = { kind: 'asap', ts: slots[0].ts, label: slots[0].label, day: slots[0].day };
        } else {
          // keep the already-selected time chip, defaulting to the closest future one
          const chosen = slots.find((s) => s.ts === (selectedSlot && selectedSlot.ts)) || slots[3] || slots[0];
          selectedSlot = { kind: 'time', ts: chosen.ts, label: chosen.label, day: chosen.day };
        }
        const box = $('#slot-box');
        if (box) box.innerHTML = slotPicker(false);
        buzz(6);
        break;
      }
      case 'slot': {
        const slots = computeSlots();
        const chosen = slots.find((s) => String(s.ts) === t.dataset.ts);
        if (chosen) {
          selectedSlot = { kind: 'time', ts: chosen.ts, label: chosen.label, day: chosen.day, minutes: chosen.minutes };
          const box = $('#slot-box');
          if (box) box.innerHTML = slotPicker(false);
          buzz(6);
        }
        break;
      }
      case 'pay-method': {
        selectedPayMethod = t.dataset.method;
        $$('#pay-options .pay-opt').forEach((b) =>
          { const on = b.dataset.method === selectedPayMethod; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        buzz(6);
        break;
      }
      case 'submit-order': handleReserve(); break;
      case 'apple-pay': {
        if (!window.MunchoPayments) break;
        window.MunchoPayments.payWithApplePay(buildOrderData()).then((res) => {
          if (res && res.success) {
            selectedPayMethod = 'APPLE PAY';
            handleReserve(res, 'APPLE PAY');
          }
        }).catch((err) => toast(esc(err.message || 'Apple Pay a fost anulat.')));
        break;
      }
      case 'whatsapp-ticket': {
        const o = lastPlacedOrder;
        if (!o) break;
        const text = `Comandă Muncho ${'#' + o.code}\nRidicare: ${o.slot ? (o.slot.day + ' ' + o.slot.label) : new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}\n` +
          (o.items || []).map((x) => `${x.qty}× ${x.title}`).join('\n') +
          `\nTotal: ${money(o.total)}`;
        window.open('https://wa.me/' + (cfg.whatsappNumber || '40770864679') + '?text=' + encodeURIComponent(text), '_blank');
        break;
      }
      case 'go-home': location.href = 'index.html'; break;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTopSheet();
  });

  function bindSearch(config) {
    const input = $(config.input);
    const wrap = input && input.closest('.search');
    if (!input) return;
    input.addEventListener('input', () => {
      config.set(input.value);
      if (wrap) wrap.classList.toggle('has-text', !!input.value);
      const clear = $(config.clear);
      if (clear) clear.hidden = !input.value;
    });
    const clearBtn = $(config.clear);
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        config.set('');
        if (wrap) wrap.classList.remove('has-text');
        clearBtn.hidden = true;
        input.focus();
      });
    }
  }

  /* ==========================================================================
     Init
     ========================================================================== */
  function init() {
    lastPlacedOrder = null;
    initSlotSelection();
    initSheetDrag();
    updateTray();

    // scrim click closes topmost sheet
    $('#sheet-scrim') && $('#sheet-scrim').addEventListener('click', closeTopSheet);
    const b = $('#btn-back-home') || $('#btn-home');
    b && b.addEventListener('click', () => { location.href = 'index.html'; });

    if (PAGE === 'feed') {
      renderFeed();
      bindSearch({
        input: '#search-input',
        clear: '#search-clear',
        set: (v) => { query = v; renderFeedDishes(); }
      });
    }

    if (PAGE === 'venue') {
      renderMerchant();
      bindSearch({
        input: '#venue-search-input',
        clear: '#venue-search-clear',
        set: (v) => { venueQuery = v; renderVenueMenu(); }
      });
    }

    if (PAGE === 'checkout') {
      renderCheckout();

      // Google Pay mount (real sheet on secure origins; graceful fallback otherwise)
      if (window.MunchoPayments && cfg.payments && cfg.payments.enableGooglePay) {
        window.MunchoPayments.initGooglePay({
          amount: cartTotal(),
          getCustomer: () => ({ name: '', phone: '', notes: '' }),
          validateCustomer: () => null,
          onPaid: (payResult) => { selectedPayMethod = 'GOOGLE PAY'; handleReserve(payResult, 'GOOGLE PAY'); },
          onUnavailable: (reason) => { showPayErrorBox(reason); }
        });
      } else {
        const gbox = $('#gpay-box');
        if (gbox) gbox.hidden = true;
      }
      renderPayOptions();
    }
  }

  function showPayErrorBox(msg) {
    const box = $('#pay-error');
    if (!box) return;
    if (!msg) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = msg;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
