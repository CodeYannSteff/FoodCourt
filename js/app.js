/**
 * Muncho — iOS Liquid Glass Food Court App Engine
 * High-performance, zero-dependency, FTP-ready vanilla JS architecture.
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

  /* ==========================================================================
     State & Storage
     ========================================================================== */
  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem('fc-cart') || '{}');
      if (!raw || typeof raw !== 'object') return {};
      return Object.fromEntries(
        Object.entries(raw).filter(([id, q]) => itemOf(id) && q > 0)
      );
    } catch (e) {
      return {};
    }
  }
  function saveCart() {
    try { localStorage.setItem('fc-cart', JSON.stringify(cart)); } catch (e) {}
  }

  function loadFavs() {
    try {
      const raw = JSON.parse(localStorage.getItem('fc-fav') || '[]');
      return new Set(Array.isArray(raw) ? raw.map(String) : []);
    } catch (e) {
      return new Set();
    }
  }
  function saveFavs() {
    try { localStorage.setItem('fc-fav', JSON.stringify([...favs])); } catch (e) {}
  }

  function loadOrders() {
    try {
      const raw = JSON.parse(localStorage.getItem('fc-orders') || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }
  function saveOrders(orders) {
    try { localStorage.setItem('fc-orders', JSON.stringify(orders)); } catch (e) {}
  }

  let cart = loadCart();
  let favs = loadFavs();
  let orders = loadOrders();
  let activeVenueId = new URLSearchParams(location.search).get('id') || 'sapori';
  let activeFilter = 'All';
  let query = '';
  let venueQuery = '';
  let selectedPayMethod = 'SAVE';
  let lastPlacedOrder = null;

  /* Cart Calculations */
  const qty = (id) => cart[id] || 0;
  const cartItemCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
  const cartSubtotal = () => Object.entries(cart).reduce((a, [id, q]) => {
    const it = itemOf(id);
    return a + (it ? it.price * q : 0);
  }, 0);
  const cartFee = () => cartSubtotal() * feeRate;
  const cartTotal = () => cartSubtotal() + cartFee();

  /* Toast Notification */
  let toastTimer = null;
  function toast(html) {
    const el = $('#iosToast');
    if (!el) return;
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* Inline Lucide/iOS Icons */
  const ICONS = {
    heart: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="13" height="13" fill="#D97706" stroke="#D97706" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'
  };

  /* Stepper / Add Button Component */
  function renderControl(id) {
    const q = qty(id);
    const it = itemOf(id);
    if (!it) return '';
    if (q > 0) {
      return `
        <span class="ios-stepper">
          <button type="button" data-action="dec" data-id="${id}" aria-label="Scade">−</button>
          <span class="qv num">${q}</span>
          <button type="button" data-action="inc" data-id="${id}" aria-label="Adaugă">+</button>
        </span>
      `;
    }
    return `
      <button type="button" class="ios-add-btn" data-action="add" data-id="${id}" aria-label="Adaugă în coș">
        Adaugă +
      </button>
    `;
  }

  function renderFavButton(id) {
    const isFav = favs.has(String(id));
    return `
      <button type="button" class="fav-heart-btn" data-action="fav" data-id="${id}" aria-pressed="${isFav}" aria-label="Favorite">
        ${ICONS.heart}
      </button>
    `;
  }

  /* Food Court Dish Card */
  function renderDishCard(it) {
    const venue = venueOf(it.venue);
    return `
      <article class="food-card-ios" data-id="${it.id}">
        <div class="food-card-content">
          <span class="venue-origin-badge">
            <span style="width:5px;height:5px;border-radius:50%;background:currentColor;"></span>
            ${esc(venue ? venue.name : 'Food Court')}
          </span>
          <h3 class="food-card-title">${esc(it.title)}</h3>
          <p class="food-card-desc">${esc(it.desc || '')}</p>
          <div class="food-card-price-row">
            <span class="food-price num">${money(it.price)}</span>
            <div>${renderControl(it.id)}</div>
          </div>
        </div>
        <div class="food-card-media">
          <img src="${it.img}" alt="${esc(it.title)}" loading="lazy" />
          ${renderFavButton(it.id)}
        </div>
      </article>
    `;
  }

  /* Food Court Restaurant Showcase Card */
  function renderVenueCard(v) {
    const badgeText = v.directApi ? '⚡ Conexiune Directă' : (v.tag || 'Food Court');
    return `
      <div class="venue-card-hub" data-venue-id="${v.id}">
        <div class="venue-card-cover">
          <img src="${v.hero || v.logo}" alt="${esc(v.name)}" loading="lazy" />
          <span class="venue-tag-glass">${esc(badgeText)}</span>
          <span class="venue-eta-glass">~${esc(v.eta)} min</span>
        </div>
        <div class="venue-card-body">
          <h3 class="venue-card-title">${esc(v.name)}</h3>
          <p class="venue-card-cat">${esc(v.cat)}</p>
          <div class="venue-card-footer">
            <span class="rating">${ICONS.star} ${esc(v.rating)} (${esc(v.reviews)})</span>
            <a href="venue.html?id=${encodeURIComponent(v.id)}" class="btn-enter-venue">
              Meniu ${ICONS.arrowRight}
            </a>
          </div>
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     Feed Page Engine (index.html)
     ========================================================================== */
  function renderFeed() {
    // 1. Render Venues Rail (Food Court Restaurants)
    const vRail = $('#venuesRail');
    if (vRail && typeof VENUES !== 'undefined') {
      vRail.innerHTML = VENUES.map(renderVenueCard).join('');
    }

    // 2. Render Category Pills
    const catRail = $('#glassCategoryRail');
    if (catRail && typeof FILTERS !== 'undefined') {
      catRail.innerHTML = FILTERS.map((f) => `
        <button type="button" class="glass-cat-pill ${activeFilter === f ? 'active' : ''}" data-action="filter-cat" data-cat="${esc(f)}">
          ${esc(f)}
        </button>
      `).join('');
    }

    // 3. Render Recommended Dishes
    const dishesList = $('#recommendedDishesList');
    if (dishesList && typeof ITEMS !== 'undefined') {
      let items = ITEMS.slice();
      if (activeFilter !== 'All') {
        items = items.filter((i) => i.cat === activeFilter);
      }
      if (query) {
        const q = query.trim().toLowerCase();
        items = items.filter((i) => (i.title + ' ' + (i.desc || '') + ' ' + (i.cat || '') + ' ' + (i.venueName || '')).toLowerCase().includes(q));
      }

      if (!items.length) {
        dishesList.innerHTML = `
          <div style="text-align:center;padding:40px 16px;color:var(--text-sub);">
            <p style="font-size:15px;font-weight:700;">Niciun preparat găsit pentru „${esc(query)}”</p>
            <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">Caută pizza, burgeri, paste, noodles sau clătite.</p>
          </div>
        `;
      } else {
        dishesList.innerHTML = items.slice(0, 16).map(renderDishCard).join('');
      }
    }
  }

  /* ==========================================================================
     Merchant Venue Page Engine (venue.html)
     ========================================================================== */
  function renderMerchant() {
    const heroBox = $('#mHeroContainer');
    const v = venueOf(activeVenueId);
    if (!v) {
      location.replace('index.html');
      return;
    }

    document.title = `${v.name} — Muncho Food Court Argeș Mall`;

    if (heroBox) {
      heroBox.innerHTML = `
        <div style="position:relative;">
          <div style="height:210px;overflow:hidden;position:relative;">
            <img src="${v.hero}" alt="${esc(v.name)}" style="width:100%;height:100%;object-fit:cover;" />
          </div>
          <div style="position:absolute;top:calc(12px + env(safe-area-inset-top, 0px));left:14px;right:14px;display:flex;justify-content:space-between;z-index:5;">
            <a href="index.html" class="ios-add-btn" style="width:38px;height:38px;padding:0;justify-content:center;background:rgba(255,255,255,0.9);color:var(--text-main);box-shadow:var(--shadow-glass);" aria-label="Înapoi">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </a>
            <div style="display:flex;gap:8px;">
              <button type="button" class="ios-add-btn" data-action="share" style="width:38px;height:38px;padding:0;justify-content:center;background:rgba(255,255,255,0.9);color:var(--text-main);box-shadow:var(--shadow-glass);">${ICONS.arrowRight}</button>
            </div>
          </div>
          <div style="margin:-32px 16px 0;background:rgba(255,255,255,0.95);-webkit-backdrop-filter:var(--glass-blur);backdrop-filter:var(--glass-blur);border-radius:var(--r-xl);box-shadow:var(--shadow-card);padding:18px;position:relative;z-index:4;border:1px solid var(--glass-border);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <h1 style="font-size:20px;font-weight:800;letter-spacing:-0.02em;">${esc(v.name)}</h1>
              ${v.directApi ? '<span style="font-size:10px;font-weight:800;background:rgba(6,193,103,0.15);color:var(--uber-green-dark);padding:3px 8px;border-radius:var(--r-pill);">⚡ Direct API</span>' : ''}
            </div>
            <p style="font-size:12.5px;color:var(--text-sub);margin-bottom:12px;">${esc(v.about || '')}</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              <span class="mall-location-pill" style="font-size:11.5px;padding:5px 10px;">${ICONS.star} ${esc(v.rating)} (${esc(v.reviews)})</span>
              <span class="mall-location-pill" style="font-size:11.5px;padding:5px 10px;">~${esc(v.eta)} min</span>
              <span class="mall-location-pill" style="font-size:11.5px;padding:5px 10px;">Argeș Mall Nivel 1</span>
            </div>
          </div>
        </div>
      `;
    }

    renderVenueCategoryBar();
    renderVenueMenuContent();
  }

  function renderVenueCategoryBar() {
    const bar = $('#venueCategoryRail');
    const v = venueOf(activeVenueId);
    if (!bar || !v) return;

    const sections = (typeof SECTIONS !== 'undefined' && SECTIONS[v.id]) ? SECTIONS[v.id] : [];
    bar.innerHTML = ['Toate', ...sections].map((s) => `
      <button type="button" class="glass-cat-pill ${activeFilter === s ? 'active' : ''}" data-action="venue-cat" data-cat="${esc(s)}">
        ${esc(s)}
      </button>
    `).join('');
  }

  function renderVenueMenuContent() {
    const box = $('#venueMenuContent');
    const v = venueOf(activeVenueId);
    if (!box || !v || typeof ITEMS === 'undefined') return;

    let items = itemsOfVenue(v.id);
    if (venueQuery) {
      const q = venueQuery.trim().toLowerCase();
      items = items.filter((i) => (i.title + ' ' + (i.desc || '') + ' ' + (i.cat || '')).toLowerCase().includes(q));
      box.innerHTML = `
        <div style="padding:16px;">
          <h3 style="font-size:16px;font-weight:800;margin-bottom:10px;">Rezultate (${items.length})</h3>
          <div class="dishes-stream">
            ${items.length ? items.map(renderDishCard).join('') : '<p style="color:var(--text-muted);">Niciun preparat găsit.</p>'}
          </div>
        </div>
      `;
      return;
    }

    const sections = (typeof SECTIONS !== 'undefined' && SECTIONS[v.id]) ? SECTIONS[v.id] : [];
    const displaySections = (activeFilter === 'All' || activeFilter === 'Toate') ? sections : [activeFilter];

    box.innerHTML = displaySections.map((secName) => {
      const secItems = items.filter((i) => i.cat === secName);
      if (!secItems.length) return '';
      return `
        <section style="padding:16px 0 6px;">
          <div style="padding:0 16px 10px;display:flex;justify-content:space-between;align-items:baseline;">
            <h3 style="font-size:17px;font-weight:800;">${esc(secName)}</h3>
            <span style="font-size:12px;color:var(--text-muted);font-weight:600;">${secItems.length} preparate</span>
          </div>
          <div class="dishes-stream">
            ${secItems.map(renderDishCard).join('')}
          </div>
        </section>
      `;
    }).join('');
  }

  /* ==========================================================================
     Checkout Engine (checkout.html)
     ========================================================================== */
  function renderCheckout() {
    const listEl = $('#checkoutItemsList');
    const totalsEl = $('#checkoutTotalsBox');
    const placeBtn = $('#btnSubmitOrder');
    if (!listEl || !totalsEl) return;

    const ids = Object.keys(cart);
    if (!ids.length) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:30px 10px;color:var(--text-sub);">
          <p style="font-weight:700;font-size:15px;">Coșul tău este gol</p>
          <a href="index.html" class="ios-add-btn" style="display:inline-flex;margin-top:12px;">Înapoi la meniu</a>
        </div>
      `;
      totalsEl.innerHTML = '';
      if (placeBtn) {
        placeBtn.disabled = true;
        placeBtn.textContent = 'Coș gol';
      }
      return;
    }

    listEl.innerHTML = ids.map((id) => {
      const it = itemOf(id);
      const q = cart[id];
      if (!it) return '';
      const v = venueOf(it.venue);
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
          <img src="${it.img}" alt="${esc(it.title)}" style="width:48px;height:48px;border-radius:10px;object-fit:cover;flex:none;" />
          <div style="flex:1;min-width:0;">
            <strong style="font-size:13.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(it.title)}</strong>
            <span style="font-size:11.5px;color:var(--text-muted);">${esc(v ? v.name : 'Food Court')} · ${money(it.price)} × ${q}</span>
          </div>
          <span class="num" style="font-size:14px;font-weight:800;">${money(it.price * q)}</span>
        </div>
      `;
    }).join('');

    const sub = cartSubtotal();
    const fee = cartFee();
    const total = cartTotal();

    totalsEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-sub);padding:3px 0;"><span>Subtotal preparate</span><span class="num">${money(sub)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-sub);padding:3px 0;"><span>Serviciu Food Court (5%)</span><span class="num">${money(fee)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:17px;font-weight:800;color:var(--text-main);padding-top:8px;margin-top:4px;border-top:1px solid rgba(0,0,0,0.06);"><span>Total de plată</span><span class="num">${money(total)}</span></div>
    `;

    if (placeBtn) {
      placeBtn.disabled = false;
      placeBtn.textContent = `Plată la tejghea • ${money(total)}`;
    }
  }

  // No customer form: the pickup code identifies the order.
  function readCustomerFromInputs() {
    return { name: '', phone: '', notes: '' };
  }

  function validateCustomer() {
    return null;
  }

  function buildOrderData(customerOverride) {
    const customer = customerOverride || readCustomerFromInputs();
    return {
      items: Object.entries(cart).map(([id, q]) => ({ id, item: itemOf(id), qty: q })),
      subtotal: cartSubtotal(),
      fee: cartFee(),
      total: cartTotal(),
      customer
    };
  }

  // Shared order finalization: kitchen sync + persist + success screen.
  async function finalizePaidOrder(payResult, orderData) {
    // 1. Direct Kitchen Bridge Sync with Sapori Italia
    const saporiItems = orderData.items
      .filter(x => x.item && x.item.venue === 'sapori')
      .map(x => ({ productId: x.item.id, qty: x.qty }));

    let saporiSyncResult = null;
    if (saporiItems.length && window.MunchoSaporiBridge) {
      saporiSyncResult = await window.MunchoSaporiBridge.createVirtualCart(saporiItems);
    }

    // 2. Confirm Order & Persist
    const orderCode = 'M-' + (100 + Math.floor(Math.random() * 899));
    lastPlacedOrder = {
      id: 'ord_' + Date.now(),
      code: orderCode,
      total: orderData.total,
      payMethod: (payResult && payResult.method) || selectedPayMethod,
      payTx: (payResult && payResult.transactionId) || null,
      payDemo: !!(payResult && payResult.demo),
      date: new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      itemsCount: cartItemCount(),
      items: orderData.items.map(x => ({ title: x.item.title, qty: x.qty, price: x.item.price, venue: x.item.venue })),
      customer: orderData.customer,
      saporiCartId: saporiSyncResult?.cartId || null,
      saporiUrl: saporiSyncResult?.directUrl || null,
      status: 'în bucătărie'
    };

    orders.unshift(lastPlacedOrder);
    saveOrders(orders);

    // Clear cart
    cart = {};
    saveCart();
    updateDynamicIsland();

    // 2b. Forward the order to the restaurant (ntfy push + webhook, zero-backend)
    let dispatchInfo = { delivered: false, results: [] };
    if (window.MunchoDispatch) {
      try {
        dispatchInfo = await window.MunchoDispatch.sendOrder(lastPlacedOrder);
      } catch (e) {
        dispatchInfo = { delivered: false, results: [], error: String((e && e.message) || e) };
      }
    }
    lastPlacedOrder.dispatch = dispatchInfo;

      // Show Success Screen
      $('#checkoutForm').hidden = true;
      const successScreen = $('#orderSuccessScreen');
      successScreen.hidden = false;
      successScreen.querySelector('#finalOrderCode').textContent = '#' + orderCode;

      const dispText = successScreen.querySelector('#dispatchStatusText');
      if (dispText) {
        const okCh = (dispatchInfo.results || []).filter(r => r.ok).map(r => r.channel === 'ntfy' ? 'notificare bucătărie' : r.channel);
        if (dispatchInfo.delivered) {
          dispText.textContent = '✓ Tichet trimis la bucătărie (' + okCh.join(' + ') + ').';
          dispText.style.color = 'var(--uber-green-dark)';
        } else {
          dispText.textContent = '⚠ Trimiterea automată a eșuat — folosește butonul WhatsApp de mai jos.';
          dispText.style.color = '#B42318';
        }
      }

      const cartIdRef = successScreen.querySelector('#saporiCartIdRef');
      if (cartIdRef) {
        cartIdRef.textContent = lastPlacedOrder.saporiCartId || 'Sincronizat';
      }

      renderTicketQr(lastPlacedOrder);
      renderSuccessSummary(lastPlacedOrder);

      window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleOrderSubmission() {
    if (!cartItemCount()) {
      toast('Coșul tău este gol.');
      return;
    }

    // "Plată la tejghea": save the order, show the pickup code + QR.
    const orderData = buildOrderData(readCustomerFromInputs());

    const placeBtn = $('#btnSubmitOrder');
    if (placeBtn) {
      placeBtn.disabled = true;
      placeBtn.textContent = 'Se salvează comanda...';
    }

    try {
      const payResult = {
        success: true,
        method: 'TEJ',
        transactionId: 'tej_' + Date.now().toString(36),
        paidAt: new Date().toISOString()
      };
      await finalizePaidOrder(payResult, orderData);
    } catch (err) {
      toast(err.message || 'Comanda nu a putut fi salvată.');
      if (placeBtn) {
        placeBtn.disabled = false;
        renderCheckout();
      }
    }
  }

  /* Ticket QR helpers (order code → comanda.html summary, scannable at the register) */
  function encodeTicket(order) {
    const data = {
      c: order.code,
      d: order.date,
      t: Math.round(Number(order.total) * 100) / 100,
      m: order.payMethod,
      i: (order.items || []).map(x => [String(x.title).slice(0, 44), x.qty, x.price])
    };
    const json = JSON.stringify(data);
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function ticketUrl(order) {
    const base = location.pathname.replace(/[^/]*$/, '');
    return location.origin + base + 'comanda.html#o=' + encodeTicket(order);
  }

  function renderTicketQr(order) {
    const box = document.getElementById('orderQrBox');
    if (!box) return;
    box.innerHTML = '';
    if (!window.qrcode) return;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(ticketUrl(order));
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 8, scalable: true });
      const svg = box.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.maxWidth = '220px';
        svg.style.height = 'auto';
        svg.style.display = 'block';
        svg.style.margin = '0 auto';
      }
    } catch (e) {
      box.textContent = '#' + order.code;
    }
  }

  function renderSuccessSummary(order) {
    const box = document.getElementById('successOrderSummary');
    if (!box) return;
    box.innerHTML = (order.items || []).map(x => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
        <span style="font-size:13.5px;font-weight:700;flex:1;">${esc(x.title)} <span style="color:var(--text-muted);font-weight:600;">× ${x.qty}</span></span>
        <span class="num" style="font-size:14px;font-weight:800;">${money(x.price * x.qty)}</span>
      </div>
    `).join('') + `
      <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;padding-top:10px;">
        <span>Total de plată</span><span class="num">${money(order.total)}</span>
      </div>`;
  }

  /* ==========================================================================
     Checkout wallets boot (pure static: Google Pay TEST + Apple Pay button)
     ========================================================================== */
  function initCheckoutPayments() {
    const P = window.MunchoPayments;
    if (!P || PAGE !== 'checkout') return;

    // Apple Pay button only exists once a verified merchant is configured.
    const appleBtn = $('#applePayBtn');
    const appleConfigured = !!(window.MUNCHO_CONFIG && window.MUNCHO_CONFIG.payments &&
      String(window.MUNCHO_CONFIG.payments.applePayMerchantIdentifier || '').trim());
    if (appleBtn && !appleConfigured) appleBtn.style.display = 'none';

    // Real Google Pay button (official TEST sheet on secure origins).
    if (cartItemCount()) {
      P.initGooglePay({
        amount: cartTotal(),
        getCustomer: readCustomerFromInputs,
        validateCustomer: () => null, // no customer form: the pickup code identifies the order
        onPaid: async (payResult) => {
          await finalizePaidOrder(payResult, buildOrderData(readCustomerFromInputs()));
        },
        onUnavailable: () => {}
      }).catch(() => {});
    }

    // Real Apple Pay button → genuine session attempt.
    appleBtn?.addEventListener('click', async () => {
      if (!cartItemCount()) {
        toast('Coșul tău este gol.');
        return;
      }
      appleBtn.disabled = true;
      try {
        const payResult = await P.payWithApplePay(buildOrderData(readCustomerFromInputs()));
        await finalizePaidOrder(payResult, buildOrderData(readCustomerFromInputs()));
      } catch (err) {
        if (err && err.message) toast(err.message);
        renderCheckout();
      } finally {
        appleBtn.disabled = false;
      }
    });
  }
  /* ==========================================================================
     Floating Dynamic Island & Floating Pill Nav Bar
     ========================================================================== */
  function updateDynamicIsland() {
    const count = cartItemCount();

    // Floating Cart Dynamic Island
    const island = $('#floatingCartIsland');
    if (island && (PAGE === 'feed' || PAGE === 'venue')) {
      island.classList.toggle('show', count > 0);
      const cEl = $('#cartIslandCount');
      const tEl = $('#cartIslandTotal');
      if (cEl) cEl.textContent = `${count} ${count === 1 ? 'produs' : 'produse'}`;
      if (tEl) tEl.textContent = money(cartTotal());
    }

    // Floating Pill Nav Badges
    const navCartBadge = $('#cartCountBadge');
    if (navCartBadge) {
      navCartBadge.textContent = count;
      navCartBadge.hidden = count === 0;
    }

    const ordBadge = $('#ordersCountBadge');
    if (ordBadge) {
      ordBadge.textContent = orders.length;
      ordBadge.hidden = orders.length === 0;
    }
  }

  /* Bottom Sheets Handlers */
  function openCartSheet() {
    renderCartSheetContent();
    $('#cartSheetIos')?.classList.add('open');
    $('#modalScrimIos')?.classList.add('show');
  }
  function closeCartSheet() {
    $('#cartSheetIos')?.classList.remove('open');
    checkScrim();
  }
  function renderCartSheetContent() {
    const list = $('#cartSheetList');
    const totalEl = $('#cartSheetGrandTotal');
    if (!list) return;

    const ids = Object.keys(cart);
    if (!ids.length) {
      list.innerHTML = `
        <div style="text-align:center;padding:36px 16px;color:var(--text-sub);">
          <p style="font-weight:700;font-size:15px;">Coșul tău este gol</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">Alege preparatele dorite din food court.</p>
        </div>
      `;
      if (totalEl) totalEl.textContent = '0.00 lei';
      return;
    }

    list.innerHTML = ids.map((id) => {
      const it = itemOf(id);
      const q = cart[id];
      if (!it) return '';
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
          <img src="${it.img}" alt="${esc(it.title)}" style="width:46px;height:46px;border-radius:10px;object-fit:cover;" />
          <div style="flex:1;min-width:0;">
            <strong style="font-size:13.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(it.title)}</strong>
            <span style="font-size:11.5px;color:var(--text-muted);">${money(it.price)} / buc.</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="num" style="font-size:13.5px;font-weight:800;">${money(it.price * q)}</span>
            <span class="ios-stepper">
              <button type="button" data-action="dec" data-id="${id}">−</button>
              <span class="qv num">${q}</span>
              <button type="button" data-action="inc" data-id="${id}">+</button>
            </span>
          </div>
        </div>
      `;
    }).join('');

    if (totalEl) totalEl.textContent = money(cartTotal());
  }

  function openVenuesSheet() {
    renderVenuesSheetContent();
    $('#venuesSheetIos')?.classList.add('open');
    $('#modalScrimIos')?.classList.add('show');
  }
  function closeVenuesSheet() {
    $('#venuesSheetIos')?.classList.remove('open');
    checkScrim();
  }
  function renderVenuesSheetContent() {
    const list = $('#venuesSheetList');
    if (!list || typeof VENUES === 'undefined') return;

    list.innerHTML = VENUES.map((v) => `
      <a href="venue.html?id=${encodeURIComponent(v.id)}" style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(244,246,249,0.7);border-radius:14px;margin-bottom:10px;border:1px solid var(--glass-border);">
        <img src="${v.hero || v.logo}" alt="${esc(v.name)}" style="width:52px;height:52px;border-radius:12px;object-fit:cover;" />
        <div style="flex:1;min-width:0;">
          <strong style="font-size:14.5px;display:block;">${esc(v.name)}</strong>
          <span style="font-size:11.5px;color:var(--text-sub);">${esc(v.cat)} · ~${esc(v.eta)} min</span>
        </div>
        <span style="font-size:12px;font-weight:800;color:var(--uber-green-dark);">${ICONS.arrowRight}</span>
      </a>
    `).join('');
  }

  function openOrdersSheet() {
    renderOrdersSheetContent();
    $('#ordersSheetIos')?.classList.add('open');
    $('#modalScrimIos')?.classList.add('show');
  }
  function closeOrdersSheet() {
    $('#ordersSheetIos')?.classList.remove('open');
    checkScrim();
  }
  function renderOrdersSheetContent() {
    const list = $('#ordersSheetList');
    if (!list) return;

    if (!orders.length) {
      list.innerHTML = `
        <div style="text-align:center;padding:40px 16px;color:var(--text-sub);">
          <p style="font-weight:700;font-size:15px;">Nu ai comenzi active</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">Comenzile trimise vor apărea aici pentru urmărire în timp real.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = orders.map((o) => `
      <div style="background:rgba(244,246,249,0.7);border-radius:14px;padding:14px;margin-bottom:10px;border:1px solid var(--glass-border);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:15px;">#${esc(o.code)}</strong>
          <span style="font-size:10.5px;font-weight:800;background:rgba(6,193,103,0.15);color:var(--uber-green-dark);padding:2px 8px;border-radius:999px;text-transform:uppercase;">${esc(o.status)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px;">${esc(o.date)} · ${o.itemsCount} produse · Plată: ${esc(o.payMethod)}</div>
        <div style="font-size:14px;font-weight:800;">${money(o.total)}</div>
      </div>
    `).join('');
  }

  function checkScrim() {
    const anyOpen = $('.bottom-sheet-ios.open');
    if (!anyOpen) $('#modalScrimIos')?.classList.remove('show');
  }

  function setQty(id, newQ) {
    if (newQ <= 0) {
      delete cart[id];
    } else {
      cart[id] = newQ;
    }
    saveCart();
    updateDynamicIsland();

    if ($('#cartSheetIos')?.classList.contains('open')) renderCartSheetContent();
    if (PAGE === 'feed') renderFeed();
    if (PAGE === 'venue') renderVenueMenuContent();
    if (PAGE === 'checkout') renderCheckout();
  }

  function toggleFav(id) {
    id = String(id);
    if (favs.has(id)) {
      favs.delete(id);
      toast('Eliminat din favorite');
    } else {
      favs.add(id);
      const it = itemOf(id);
      toast(`<b>+</b> ${esc(it ? it.title : 'Preparat')} salvat la favorite`);
    }
    saveFavs();
    if (PAGE === 'feed') renderFeed();
    if (PAGE === 'venue') renderVenueMenuContent();
  }

  /* ==========================================================================
     Global Event Listeners
     ========================================================================== */
  document.addEventListener('click', (e) => {
    // Action elements
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const act = actionEl.dataset.action;
      const id = actionEl.dataset.id;

      if (act === 'add' || act === 'inc') {
        const curQ = qty(id);
        setQty(id, curQ + 1);
        const it = itemOf(id);
        toast(`<b>+</b> ${esc(it ? it.title : 'Preparat')} (${curQ + 1})`);
        return;
      }
      if (act === 'dec') {
        setQty(id, qty(id) - 1);
        return;
      }
      if (act === 'fav') {
        toggleFav(id);
        return;
      }
      if (act === 'filter-cat') {
        activeFilter = actionEl.dataset.cat || 'All';
        renderFeed();
        $('#recommendedDishesList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (act === 'venue-cat') {
        activeFilter = actionEl.dataset.cat || 'Toate';
        renderVenueCategoryBar();
        renderVenueMenuContent();
        return;
      }
      if (act === 'share') {
        try { navigator.clipboard?.writeText(location.href); } catch (err) {}
        toast('Link copiat în clipboard');
        return;
      }
    }

    // Payment options in checkout (single method: save order, pay at register)
    const payBtn = e.target.closest('.pay-option-btn');
    if (payBtn) {
      selectedPayMethod = payBtn.dataset.method;
      $$('.pay-option-btn').forEach((b) => {
        const isSelected = b === payBtn;
        b.classList.toggle('active', isSelected);
        b.setAttribute('aria-checked', String(isSelected));
      });
      renderCheckout();
      return;
    }
  });

  // Search Inputs
  const searchInput = $('#searchInput');
  const searchClear = $('#searchClearBtn');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      query = e.target.value;
      if (searchClear) searchClear.classList.toggle('show', query.length > 0);
      renderFeed();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      query = '';
      searchClear.classList.remove('show');
      renderFeed();
    });
  }

  const vSearchInput = $('#venueSearchInput');
  const vSearchClear = $('#venueSearchClear');
  if (vSearchInput) {
    vSearchInput.addEventListener('input', (e) => {
      venueQuery = e.target.value;
      if (vSearchClear) vSearchClear.classList.toggle('show', venueQuery.length > 0);
      renderVenueMenuContent();
    });
  }
  if (vSearchClear) {
    vSearchClear.addEventListener('click', () => {
      if (vSearchInput) vSearchInput.value = '';
      venueQuery = '';
      vSearchClear.classList.remove('show');
      renderVenueMenuContent();
    });
  }

  // Floating Nav and Sheets triggers
  $('#cartIslandBtn')?.addEventListener('click', openCartSheet);
  $('#navCartTab')?.addEventListener('click', () => {
    if (cartItemCount()) openCartSheet();
    else toast('Coșul tău este gol');
  });
  $('#navVenuesTab')?.addEventListener('click', openVenuesSheet);
  $('#navOrdersTab')?.addEventListener('click', openOrdersSheet);
  $('#mallLocBtn')?.addEventListener('click', openVenuesSheet);

  $('#cartSheetCloseBtn')?.addEventListener('click', closeCartSheet);
  $('#venuesSheetCloseBtn')?.addEventListener('click', closeVenuesSheet);
  $('#ordersSheetCloseBtn')?.addEventListener('click', closeOrdersSheet);
  $('#modalScrimIos')?.addEventListener('click', () => {
    closeCartSheet();
    closeVenuesSheet();
    closeOrdersSheet();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCartSheet();
      closeVenuesSheet();
      closeOrdersSheet();
    }
  });

  $('#cartSheetCheckoutBtn')?.addEventListener('click', () => {
    closeCartSheet();
    location.href = 'checkout.html';
  });

  $('#btnSubmitOrder')?.addEventListener('click', handleOrderSubmission);
  $('#btnBackHome')?.addEventListener('click', () => {
    location.href = 'index.html';
  });

  // Direct Sapori WhatsApp & Call actions on success screen
  $('#btnSendWhatsAppTicket')?.addEventListener('click', () => {
    if (lastPlacedOrder && window.MunchoSaporiBridge) {
      window.MunchoSaporiBridge.dispatchToWhatsApp(lastPlacedOrder);
    }
  });

  $('#btnCallSaporiCounter')?.addEventListener('click', () => {
    if (window.MunchoSaporiBridge) {
      window.MunchoSaporiBridge.callCounter();
    }
  });

  /* ==========================================================================
     Initial Boot
     ========================================================================== */
  updateDynamicIsland();
  if (PAGE === 'feed') renderFeed();
  if (PAGE === 'venue') renderMerchant();
  if (PAGE === 'checkout') renderCheckout();
  if (PAGE === 'checkout') initCheckoutPayments();

})();
