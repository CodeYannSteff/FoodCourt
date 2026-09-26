/**
 * Muncho Payment Processor — 100% static (FTP / GitHub Pages friendly).
 * No backend, no Node.js, no secret keys.
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
 * - SAVE (Plată la tejghea): no online payment — the order is saved with a
 *   pickup code and paid at the register.
 *
 * Saved orders are forwarded to the restaurant by js/dispatch.js
 * (ntfy push + optional webhook + WhatsApp ticket).
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
  // The wallet buttons NEVER disappear: if the official button can't render
  // (plain http:// LAN, desktop browser…), a branded fallback button stays
  // visible and explains exactly what's needed on tap.
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
          // TEST gateway: Google returns a TEST token, no real charge.
          // For PRODUCTION with a live processor, replace with your gateway.
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

  // One shared sheet attempt, called from genuine user taps
  // (official button OR branded fallback button).
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
      // User closed the sheet: stay silent, unless readiness already failed —
      // then say why instead of a dead click.
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
        return; // nothing charged (TEST token) — customer fixes name/phone and retries
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

  function showGoogleFallback(reason) {
    const fallback = document.getElementById('googlePayFallbackBtn');
    const mount = document.getElementById('googlePayMount');
    if (mount) mount.innerHTML = '';
    if (fallback) {
      fallback.style.display = 'flex';
      fallback.onclick = () => {
        // Genuine user tap: retry the real sheet if a client exists,
        // otherwise explain what's missing.
        if (gpClient) attemptGooglePaySheet();
        else showPayError(reason);
      };
    }
    return reason;
  }

  /**
   * Mount the REAL Google Pay button. opts:
   * { amount, getCustomer, validateCustomer, onPaid(payResult), onUnavailable(reason) }
   * The section always stays visible — official button when renderable,
   * branded fallback button otherwise.
   */
  async function initGooglePay(opts) {
    opts = opts || {};
    gpLastOpts = opts;
    const mount = document.getElementById('googlePayMount');
    const fallback = document.getElementById('googlePayFallbackBtn');
    const box = document.getElementById('googlePayBox');
    if (box) box.hidden = false;
    if (mount) mount.innerHTML = '';
    if (fallback) fallback.style.display = 'none';

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
      // Typical on plain http:// LAN origins: Google Pay needs a secure context.
      gpClient = null;
      return unavailable('Google Pay necesită HTTPS (ex: GitHub Pages) sau localhost. Pe rețeaua locală http, salvează comanda pentru plata la tejghea.');
    }

    if (mount) {
      const button = gpClient.createButton({ onClick: attemptGooglePaySheet });
      mount.appendChild(button);
    }
    if (fallback) fallback.style.display = 'none';
    return { available: true };
  }

  // ── Apple Pay (real session path; static hosts can't pass merchant validation) ──
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

  /**
   * Real Apple Pay attempt. Resolves only from a genuine session;
   * on static hosts it explains the live setup instead.
   */
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
      // No verified merchant on this host: explain instead of a fake sheet.
      return showApplePaySetupModal();
    }

    // Merchant ID configured (future live setup): run the real session.
    // NOTE: on a purely static host this still stops at merchant validation
    // (Apple requires a server call) — the code is ready for the live domain.
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

  const PaymentProcessor = {
    cardUtils: CardUtils,

    googlePayEnvironment: function () { return GP_ENV; },
    applePayCanPresent: applePayCanPresent,
    initGooglePay: initGooglePay,
    payWithApplePay: payWithApplePay,

    payWithGooglePay: async function (orderData, opts) {
      // Compat path (the old method radios were removed from the UI).
      // Point the user at the always-visible wallet buttons above.
      const box = document.getElementById('googlePayBox');
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
    }
  };

  window.MunchoPayments = PaymentProcessor;
})();
