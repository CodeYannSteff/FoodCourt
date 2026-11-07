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

  // Booking ("Airbnb for your food"): reserve dishes for a pickup slot.
  // Slots are generated between open/close, on a 15-minute grid after the
  // venue's prep lead time. The customer arrives at the chosen time.
  booking: {
    open: '10:00',
    close: '22:00',
    slotMinutes: 15,       // grid size for slots
    minLeadMinutes: 20,    // earliest a reservation can be made from now
    slotCount: 10          // how many future slots to offer
  },

  // Payment & wallet settings (pure frontend — NO backend exists or is needed).
  //
  // Flow: the customer reserves the order for a pickup slot and gets a
  // pickup code + QR ticket. The cashier scans the code (comanda.html) to
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

    // Apple Pay: the button appears only when a Merchant ID is set, and the
    // real sheet additionally needs a verified HTTPS domain (see README).
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
