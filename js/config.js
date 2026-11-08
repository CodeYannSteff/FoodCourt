/**
 * Muncho — Configuration & Store Settings
 *
 * 100% static: this site runs on any FTP server or GitHub Pages.
 * No build step, no backend, no Node.js required.
 */
window.MUNCHO_CONFIG = {
  // Store details
  storeName: 'Muncho — Food Court Argeș Mall',
  storeLocation: 'Argeș Mall, Nivel 1 · Food Court, Pitești',
  storeHours: 'Luni – Duminică · 10:00 – 22:00',
  defaultEta: '20-30 min',
  currency: 'lei',
  serviceFeeRate: 0.05, // 5% service fee

  // Payment & wallet settings (pure frontend — NO backend exists or is needed).
  //
  // Flow: the order is sent instantly to the kitchen; the customer gets a
  // pickup code + QR ticket with a ready-in estimate. The cashier scans the
  // code (comanda.html) to
  // see the summary and takes payment at the register. Google Pay / Apple
  // Pay buttons are offered as express options on top. The finalized order
  // (with its payment reference) is POSTed to the webhook below — that is
  // the integration point for the restaurant's real order system.
  payments: {
    // Google Pay: official test environment. The Google Pay sheet opens
    // (secure origins: https://… or http://localhost). No money moves —
    // Google returns a test token that is stored as the payment reference.
    googlePayEnvironment: 'TEST', // 'TEST' now, 'PRODUCTION' only with a live processor
    merchantName: 'Muncho Food Court',
    countryCode: 'RO',
    currencyCode: 'RON',

    // Apple Pay: the button is always shown next to Google Pay; the real
    // sheet additionally needs a Merchant ID + verified HTTPS domain (see
    // README) — where payment isn't possible, tapping it explains why.
    applePayMerchantIdentifier: '', // e.g. 'merchant.ro.muncho.foodcourt'

    enableGooglePay: true,
    enableApplePay: true,
    enableSaveOrder: true // "Plată la tejghea" → pickup code + QR, pay at register
  },

  // Where saved orders go — all zero-backend, all optional:
  dispatch: {
    // 1) Instant push to the counter: the restaurant opens
    //    https://ntfy.sh/muncho-sapori-comenzi (or the ntfy app) and every
    //    order pops up live. Change the topic to something private.
    ntfyTopic: 'muncho-sapori-comenzi',

    // 2) Your real order-system API (webhook): POSTs the full order JSON
    //    (code, items, total, customer, payment method + reference) to
    //    orderWebhookUrl when set — plug in the restaurant's real order system
    //    later without touching UI code.
    //    Example: 'https://comenzi.restaurantul-meu.ro/api/orders'
    orderWebhookUrl: ''
  },

  // Stripe configuration — payment processing handled by Stripe's hosted checkout.
  // No backend needed: Stripe manages the payment flow, takes their cut,
  // and can split the remainder to the restaurant via Connect.
  stripe: {
    // Your Stripe Publishable Key (get from Stripe Dashboard)
    publishableKey: '', // e.g. 'pk_test_XXX...'

    // Stripe Connect account ID for the restaurant (to split payments).
    // When set, Stripe will split: platform fee + restaurant remainder.
    connectAccountId: '', // e.g. 'acct_XXX...'

    // Optional platform fee percentage (0-100) that the platform takes
    // before sending the remainder to the restaurant
    platformFeePercentage: 5.0 // 5% platform fee by default
  }
};
