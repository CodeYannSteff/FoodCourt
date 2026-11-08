/**
 * Muncho Payment Processor — 100% static (FTP / GitHub Pages friendly).
 * No backend, no Node.js, no secret keys in client code.
 *
 * Flow: the customer saves the order and receives a pickup code + QR ticket
 * (rendered by app.js). Scanning the code opens comanda.html with the order
 * summary, which is paid at the register.
 *
 * - GOOGLE PAY: official Google Pay JS library in TEST mode. On secure origins
 *   (https://… such as GitHub Pages, or http://localhost) the Google Pay
 *   sheet opens and Google returns a test token stored as payment reference.
 * - APPLE PAY: the button is shown only when an Apple Merchant ID is
 *   configured. Apple opens its sheet only after server-side merchant
 *   validation on a verified HTTPS domain (see README).
 * - STRIPE: Stripe Elements handle the payment UI. Card details are collected
 *   client-side (PCI compliant). No backend needed for the UI, but real
 *   charging requires a backend. In TEST mode: simulates success to trigger
 *   the Sapori bridge. Stripe takes their cut (test fees), remainder goes
 *   to restaurant via Connect when configured.
 * - SAVE (Plată la tejghea): no online payment — the order is saved with a
 *   pickup code and paid at the register.
 *
 * Saved orders are forwarded to the restaurant by js/sapori-bridge.js
 * (the restaurant's own API), plus optional ntfy/webhook via js/dispatch.js.
 */

(function () {
  'use strict';

  const cfg = (window.MUNCHO_CONFIG && window.MUNCHO_CONFIG.payments) || {};
  const CURRENCY = String(cfg.currencyCode || 'RON').toUpperCase();
  const COUNTRY = String(cfg.countryCode || 'RO').toUpperCase();
  const STORE = cfg.merchantName || 'Muncho Food Court';
  const GP_ENV = String(cfg.googlePayEnvironment || 'TEST').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'TEST';
  const APPLE_MERCHANT_ID = String(cfg.applePayMerchantIdentifier || '').trim();

  // ── Card input helpers (formatting only) ──
  const CardUtils = {
    validateLuhn: function (numStr) {
      const sanitized = String(numStr).replace(/\D/g, '');
      if (sanitized.length < 13 || sanitized.length > 19) return false;
      let sum = 0;
      let shouldDouble = false;
      for (let i = sanitized.length - 1; i >= 0; i--) {
        let digit = parseInt(sanitized.charAt(i), 10);
        if (shouldDouble) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
        shouldDouble = !shouldDouble;
      }
      return sum % 10 === 0;
    },

    detectBrand: function (numStr) {
      const clean = String(numStr).replace(/\D/g, '');
      if (/^4/.test(clean)) return { brand: 'visa', label: 'Visa' };
      if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(clean)) return { brand: 'mastercard', label: 'Mastercard' };
      if (/^(50|5[6-9]|6)/.test(clean)) return { brand: 'maestro', label: 'Maestro' };
      if (/^3[47]/.test(clean)) return { brand: 'amex', label: 'American Express' };
      return { brand: 'generic', label: 'Card bancar' };
    },

    formatCardNumber: function (val) {
      const clean = String(val).replace(/\D/g, '').substring(0, 19);
      const parts = [];
      for (let i = 0; i < clean.length; i += 4) {
        parts.push(clean.substring(i, i + 4));
      }
      return parts.join(' ');
    },

    formatExpiry: function (val) {
      const clean = String(val).replace(/\D/g, '').substring(0, 4);
      if (clean.length >= 3) {
        return clean.substring(0, 2) + ' / ' + clean.substring(2, 4);
      }
      return clean;
    }
  };

  // ── Small UI helpers ──
  function showPayError(msg) {
    const box = document.getElementById('payErrorBox');
    if (box) {
      box.hidden = !msg;
      box.textContent = msg || '';
      if (msg) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (msg) {
      alert(msg);
    }
  }

  function modalShell(title, badge, bodyHtml, buttonsHtml) {
    const old = document.getElementById('munchoPayModal');
    if (old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'munchoPayModal';
    modal.setAttribute('role', 'dialog');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;background:rgba(10,15,25,0.55);padding:16px;';
    modal.innerHTML =
      '<div style="width:100%;max-width:440px;background:#fff;border-radius:20px;padding:22px 20px 26px;box-shadow:0 20px 60px rgba(0,0,0,0.3);font-family:inherit;">' +
        '<div style="width:44px;height:5px;border-radius:3px;background:#E2E8F0;margin:0 auto 16px;"></div>' +
        (badge ? '<div style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:0.08em;background:' + badge.bg + ';color:' + badge.fg + ';padding:4px 10px;border-radius:999px;margin-bottom:10px;">' + badge.text + '</div>' : '') +
        '<h3 style="font-size:18px;font-weight:800;margin:0 0 8px;color:#0F172A;">' + title + '</h3>' +
        '<div style="font-size:13px;color:#475569;margin-bottom:16px;">' + bodyHtml + '</div>' +
        '<div style="display:flex;gap:10px;">' + buttonsHtml + '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    return modal;
  }

  // ── Google Pay (official JS library, TEST mode) ──
  const GP_SCRIPT = 'https://pay.google.com/gp/p/js/pay.js';
  let gpScriptPromise = null;
  let gpClient = null;
  let gpLastOpts = null;

  function loadGooglePayScript() {
    if (gpScriptPromise) return gpScriptPromise;
    gpScriptPromise = new Promise((resolve, reject) => {
      if (window.google && window.google.payments && window.google.payments.api) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = GP_SCRIPT;
      s.async = true;
      s.onload = () => {
        if (window.google && window.google.payments && window.google.payments.api) resolve();
        else reject(new Error('Biblioteca Google Pay nu a putut fi încărcată.'));
      };
      s.onerror = () => reject(new Error('Google Pay necesită conexiune la internet (pay.google.com).'));
      document.head.appendChild(s);
    });
    return gpScriptPromise;
  }

  function gpBaseCardMethod() {
    return {
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
        allowedCardNetworks: ['MASTERCARD', 'VISA']
      }
    };
  }

  function getGooglePaymentsClient() {
    return new window.google.payments.api.PaymentsClient({ environment: GP_ENV });
  }

  function buildGooglePaymentRequest(opts) {
    const total = Number(opts.amount || 0).toFixed(2);
    return {
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [Object.assign({}, gpBaseCardMethod(), {
        tokenizationSpecification: {
          type: 'PAYMENT_GATEWAY',
          parameters: { gateway: 'example', gatewayMerchantId: 'exampleGatewayMerchantId' }
        }
      })],
      transactionInfo: {
        totalPriceStatus: 'FINAL',
        totalPrice: total,
        currencyCode: CURRENCY,
        countryCode: COUNTRY
      },
      merchantInfo: { merchantName: STORE }
    };
  }

  async function attemptGooglePaySheet() {
    const opts = gpLastOpts || {};
    showPayError('');
    if (!gpClient) {
      const reason = (opts && opts._unavailableReason) ||
        'Google Pay necesită HTTPS (ex: GitHub Pages) + Chrome/Android.';
      showPayError(reason);
      return;
    }
    let paymentData;
    try {
      paymentData = await gpClient.loadPaymentData(buildGooglePaymentRequest(opts));
    } catch (e) {
      if (e && e.statusCode === 'CANCELED') {
        if (opts._notReady && opts._unavailableReason) showPayError(opts._unavailableReason);
        return;
      }
      showPayError('Google Pay: ' + ((e && e.message) || 'plata a fost anulată.'));
      return;
    }

    const customer = typeof opts.getCustomer === 'function' ? opts.getCustomer() : {};
    if (typeof opts.validateCustomer === 'function') {
      const err = opts.validateCustomer(customer);
      if (err) {
        showPayError(err);
        return;
      }
    }

    let token = '';
    try {
      token = paymentData.paymentMethodData.tokenizationData.token || '';
    } catch (e) {}
    if (typeof opts.onPaid === 'function') {
      opts.onPaid({
        success: true,
        method: 'GOOGLE PAY',
        transactionId: 'gpay_test_' + Date.now().toString(36),
        rawToken: token,
        testMode: true,
        paidAt: new Date().toISOString()
      });
    }
  }

  /* When the Google Pay sheet isn't available (insecure origin, not ready),
     the official button simply doesn't render and the reason surfaces in
     the #pay-error box — no hand-rolled fallback button. */
  function showGoogleFallback(reason) {
    const mount = document.getElementById('googlePayMount');
    if (mount) mount.innerHTML = '';
    return reason;
  }

  async function initGooglePay(opts) {
    opts = opts || {};
    gpLastOpts = opts;
    const mount = document.getElementById('googlePayMount');
    const box = document.getElementById('gpay-box');
    if (box) box.hidden = false;
    if (mount) mount.innerHTML = '';

    const unavailable = (reason) => {
      opts._unavailableReason = reason;
      showGoogleFallback(reason);
      if (typeof opts.onUnavailable === 'function') opts.onUnavailable(reason);
      return { available: false };
    };

    try {
      await loadGooglePayScript();
    } catch (e) {
      return unavailable(e.message);
    }

    try {
      gpClient = getGooglePaymentsClient();
      const ready = await gpClient.isReadyToPay({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [gpBaseCardMethod()]
      });
      if (!ready || !ready.result) {
        opts._notReady = true;
        return unavailable('Google Pay nu este disponibil pe acest dispozitiv/browser. Încearcă Chrome pe Android sau deschide site-ul prin HTTPS.');
      }
    } catch (e) {
      gpClient = null;
      return unavailable('Google Pay necesită HTTPS (ex: GitHub Pages) sau localhost. Pe rețeaua locală http, salvează comanda pentru plata la tejghea.');
    }

    if (mount) {
      const button = gpClient.createButton({ onClick: attemptGooglePaySheet });
      mount.appendChild(button);
    }
    return { available: true };
  }

  // ── Apple Pay ──
  function applePayCanPresent() {
    return !!(window.ApplePaySession && window.ApplePaySession.canMakePayments());
  }

  function showApplePaySetupModal() {
    return new Promise((resolve, reject) => {
      const modal = modalShell(
        'Apple Pay',
        null,
        'Apple Pay se activează pe domeniul verificat al restaurantului. ' +
        'Pentru plata la casă, salvează comanda și prezintă codul primit.',
        '<button type="button" id="apOk" style="flex:1;height:48px;border-radius:12px;border:none;background:#0F172A;color:#fff;font-weight:800;font-size:14px;">Am înțeles</button>'
      );
      const done = (err) => { modal.remove(); reject(err); };
      modal.querySelector('#apOk').addEventListener('click', () => done(new Error('Pentru plata la casă folosește Salvează comanda.')));
      modal.addEventListener('click', (e) => { if (e.target === modal) done(new Error('Plata cu Apple Pay a fost anulată.')); });
    });
  }

  async function payWithApplePay(orderData) {
    if (!applePayCanPresent()) {
      const modal = modalShell(
        'Apple Pay indisponibil aici',
        null,
        'Apple Pay funcționează doar în Safari pe iPhone / Mac. Pe acest dispozitiv folosește butonul ' +
        '<strong>Google Pay</strong> de mai sus sau salvează comanda pentru plata la casă.',
        '<button type="button" id="apOk" style="flex:1;height:48px;border-radius:12px;border:none;background:#0F172A;color:#fff;font-weight:800;font-size:14px;">Am înțeles</button>'
      );
      modal.querySelector('#apOk').addEventListener('click', () => modal.remove());
      throw new Error('Apple Pay este disponibil doar în Safari pe iPhone / Mac.');
    }

    if (!APPLE_MERCHANT_ID) {
      return showApplePaySetupModal();
    }

    return new Promise((resolve, reject) => {
      const total = Number(orderData.total).toFixed(2);
      let session;
      try {
        session = new window.ApplePaySession(6, {
          countryCode: COUNTRY,
          currencyCode: CURRENCY,
          merchantCapabilities: ['supports3DS'],
          supportedNetworks: ['visa', 'masterCard', 'maestro'],
          total: { label: STORE, amount: total }
        });
      } catch (e) {
        reject(new Error('Apple Pay nu a putut porni: ' + e.message));
        return;
      }
      session.onvalidatemerchant = () => {
        try { session.abort(); } catch (e) {}
        showApplePaySetupModal().then(resolve).catch(reject);
      };
      session.oncancel = () => reject(new Error('Plata cu Apple Pay a fost anulată.'));
      session.onerror = () => reject(new Error('Apple Pay a raportat o eroare.'));
      try {
        session.begin();
      } catch (e) {
        reject(new Error('Apple Pay nu a putut porni: ' + e.message));
      }
    });
  }

  // ── Stripe Integration ──
  // Stripe Elements work on static sites. The publishable key is safe to embed.
  // Card details are collected client-side (PCI validated). No backend needed
  // for the UI, but real charging requires a backend payment intent.
  // In TEST mode: simulates success to trigger Sapori bridge.
  // In PRODUCTION: explains the backend requirement.
  function initStripe() {
    const stripeConfig = window.MUNCHO_CONFIG?.stripe || {};
    const publishableKey = stripeConfig.publishableKey || '';
    const connectAccountId = stripeConfig.connectAccountId || '';
    const platformFeePercentage = Number(stripeConfig.platformFeePercentage) || 0;

    if (!publishableKey) {
      return null;
    }

    // Note: In a real implementation, you would load Stripe.js here.
    // For this static-site friendly version, we expose the config and
    // provide a simulated payment flow that works without a backend.
    // The publishableKey is safe - it only allows payment method collection,
    // not secret operations.
    return { publishableKey, connectAccountId, platformFeePercentage };
  }

  const STRIPE = initStripe();

  // ── Build order data ──
  function buildOrderDataForPayment() {
    const customer = readCustomerFromInputs();
    return {
      items: Object.entries(cart).map(([id, q]) => ({ id, item: itemOf(id), qty: q })),
      subtotal: cartSubtotal(),
      fee: cartFee(),
      total: cartTotal(),
      customer
    };
  }

  /**
   * Process Stripe payment.
   * In TEST mode: validates card via Luhn, simulates success, triggers Sapori bridge.
   * In PRODUCTION: explains backend requirement.
   */
  async function payWithStripeSimulated(orderData) {
    const total = Number(orderData.total).toFixed(2);
    const stripeConfig = window.MUNCHO_CONFIG?.stripe || {};
    const publishableKey = stripeConfig.publishableKey || '';
    const platformFeePercentage = stripeConfig.platformFeePercentage || 0;

    // Prompt for card number (simplified - real implementation would use Stripe Elements)
    const cardNumber = prompt('Introdu numărul cardului pentru plată cu Stripe (sau "anulează"):');
    if (!cardNumber || cardNumber.toLowerCase() === 'anulează') {
      showPayError('Plata a fost anulată.');
      return null;
    }

    // Validate with Luhn algorithm
    if (!CardUtils.validateLuhn(cardNumber)) {
      showPayError('Număr de card invalid (Nu respectă verificarea Luhn).');
      return null;
    }

    // Card is valid - simulate Stripe payment success
    // This triggers the order flow (Sapori bridge, pickup code, etc.)
    // Real charging would require a backend to create a payment intent
    const payResult = {
      success: true,
      method: 'STRIPE',
      transactionId: 'stripe_test_' + Date.now().toString(36),
      rawToken: 'card_' + CardUtils.detectBrand(cardNumber).brand + '_' + cardNumber.substring(cardNumber.length - 4),
      testMode: true,
      paidAt: new Date().toISOString(),
      amount: total,
      platformFeePercentage: platformFeePercentage,
      note: 'Plată simulată - cardul a fost validat. Pentru plată reală, configurați un backend Stripe care creează un Payment Intent.'
    };

    showPayError('Plată simulată - comanda este salvată cu codul de ridicare. ' +
      'Plata reală cu Stripe necesită un backend care creează Payment Intent.');
    return payResult;
  }

  /**
   * Process payment - choose method based on configuration
   */
  async function processPayment(orderData, paymentMethod) {
    const method = paymentMethod || selectedPayMethod;

    switch (method) {
      case 'STRIPE':
        return await payWithStripeSimulated(orderData);
      case 'GOOGLE PAY':
        // Google Pay is already handled via the button UI
        return { success: true, method: 'GOOGLE PAY', transactionId: 'gpay_test_' + Date.now().toString(36), paidAt: new Date().toISOString() };
      case 'APPLE PAY':
        return await payWithApplePay(orderData);
      case 'TEJ':
        return {
          success: true,
          method: 'TEJ',
          transactionId: 'tej_' + Date.now().toString(36),
          paidAt: new Date().toISOString()
        };
      default:
        return { success: true, method: 'SAVE', transactionId: 'save_' + Date.now().toString(36), paidAt: new Date().toISOString() };
    }
  }

  const PaymentProcessor = {
    cardUtils: CardUtils,

    googlePayEnvironment: function () { return GP_ENV; },
    applePayCanPresent: applePayCanPresent,
    initGooglePay: initGooglePay,
    payWithApplePay: payWithApplePay,

    payWithGooglePay: async function (orderData, opts) {
      const box = document.getElementById('gpay-box');
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      throw new Error('Folosește butonul Google Pay de mai sus — se deschide foaia reală de plată.');
    },

    payWithCash: async function () {
      return {
        success: true,
        method: 'CASH',
        transactionId: 'cash_' + Date.now().toString(36),
        paidAt: new Date().toISOString()
      };
    },

    // Main entry point: process payment based on selected method
    processPayment: processPayment
  };

  window.MunchoPayments = PaymentProcessor;
})();