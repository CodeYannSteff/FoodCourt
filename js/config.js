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
  // Flow: the customer saves the order and gets a pickup code + QR ticket.
  // The cashier scans the code (comanda.html) to see the summary and take
  // payment at the register. Google Pay / Apple Pay buttons are offered as
  // express options on top. The finalized order (with its payment reference)
  // is POSTed to YOUR api below — that webhook is the integration point for
  // the restaurant's real order/billing system.
  payments: {
    // Google Pay: official test environment. The Google Pay sheet opens
    // (secure origins: https://… or http://localhost). No money moves —
    // Google returns a test token that is stored as the payment reference.
    googlePayEnvironment: 'TEST', // 'TEST' now, 'PRODUCTION' only with a live processor
    merchantName: 'Muncho Food Court',
    countryCode: 'RO',
    currencyCode: 'RON',

    // Apple Pay: the button appears only when a Merchant ID is set, and the
    // real sheet additionally needs a verified HTTPS domain (see README).
    applePayMerchantIdentifier: '', // e.g. 'merchant.ro.muncho.foodcourt'

    enableGooglePay: true,
    enableApplePay: true,
    enableSaveOrder: true // "Salvează Comanda" → pickup code + QR, pay at register
  },

  // Where saved orders go — all zero-backend, all optional:
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
