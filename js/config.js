/**
 * Muncho — Configuration & Store Settings
 *
 * 100% static: this site runs on any FTP server or GitHub Pages.
 * No build step, no backend, no Node.js required.
 */
window.MUNCHO_CONFIG = {
  // Store details
  storeName: 'Muncho · Food Court Argeș Mall',
  storeLocation: 'Argeș Mall, Nivel 1 · Food Court, Pitești',
  storeHours: 'Luni – Duminică · 10:00 – 22:00',
  defaultEta: '20-30 min',
  currency: 'lei',
  serviceFeeRate: 0.05, // 5% service fee

  // Payment & wallet settings (pure frontend — NO backend exists or is needed).
  //
  // Honest processor note: no reputable processor (Stripe, Netopia, PayU,
  // Revolut…) can take REAL card/Apple Pay charges from a purely static page —
  // secret keys must stay server-side and amounts must be validated there.
  // So this site runs:
  //  - Google Pay TEST (real sheet, test token, no money moves) for demos, and
  //  - clearly-labeled demo flows for card/Apple Pay.
  // The finalized order (with its payment reference) is POSTed to YOUR api
  // below — that webhook is the integration point for the restaurant's real
  // order/billing system, no UI changes needed when you plug it in.
  payments: {
    // Google Pay: official test environment. The REAL Google Pay sheet opens
    // (secure origins: https://… or http://localhost). No real money moves —
    // Google returns a TEST token, perfect for demos.
    googlePayEnvironment: 'TEST', // 'TEST' for demos, 'PRODUCTION' only with a live processor
    merchantName: 'Muncho Food Court',
    countryCode: 'RO',
    currencyCode: 'RON',

    // Apple Pay: the REAL Apple Pay sheet can only open once this site runs on
    // a verified HTTPS domain with an Apple Merchant ID (see README).
    // Leave empty for demo mode (the button explains the one-time setup).
    applePayMerchantIdentifier: '', // e.g. 'merchant.ro.muncho.foodcourt'

    enableGooglePay: true,
    enableApplePay: true,
    enableCard: true, // demo card form (clearly labeled, no real charge)
    enableCash: true  // Numerar la tejghea
  },

  // Where paid/demo orders go — all zero-backend, all optional:
  dispatch: {
    // 1) Instant push to the counter: the restaurant opens
    //    https://ntfy.sh/muncho-sapori-comenzi (or the ntfy app) and every
    //    order pops up live. Change the topic to something private.
    ntfyTopic: 'muncho-sapori-comenzi',

    // 2) Your real order-system API (webhook): POSTs the full order JSON
    //    (code, items, total, customer, payment method + reference) to
    //    orderWebhookUrl when set. Point it at any HTTPS endpoint and the
    //    restaurant's system receives every order — this is the "api".
    //    Example: 'https://comenzi.restaurantul-meu.ro/api/orders'
    orderWebhookUrl: ''
  }
};
