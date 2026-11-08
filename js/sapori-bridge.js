/**
 * Muncho — Direct Integration with the Argeș Mall restaurant
 * Pizzeria Sapori Italia — https://pizzeria-sapori-italia.ro/AppMenu/
 *
 * When an order is confirmed, its lines are POSTed to the restaurant's own
 * integration API (Roweb createvirtualcart) — the same API that powers
 * the restaurant's AppMenu. The response carries a real cartId; the ticket
 * the cashier sees and the kitchen ticket are both keyed on it.
 *
 * No WhatsApp, no fallback fabrications: if the API does not confirm,
 * the caller shows a retry — the order stays valid locally meanwhile.
 */

(function () {
  'use strict';

  const SAPORI_CONFIG = {
    apiKey: 'bf026006-7d01-41bf-ae76-ab0fba3d4c80',
    apiUrl: 'https://api.rpd.roweb.ro/api/product/integration/createvirtualcart',
    origin: 'https://pizzeria-sapori-italia.ro',
    storeLocation: 'Food Court Argeș Mall, Nivel 1, Pitești'
  };

  const METHOD_LABELS = {
    TEJ: 'Plată la tejghea',
    'GOOGLE PAY': 'Google Pay',
    'APPLE PAY': 'Apple Pay',
    CASH: 'Numerar'
  };

  const SaporiBridge = {
    config: SAPORI_CONFIG,

    payLabel: function (method) {
      return METHOD_LABELS[method] || method || '—';
    },

    /**
     * Send the confirmed order to the restaurant's API (AppMenu backend).
     * @param {Array} products - Array of { productId, qty }
     * @returns {Promise<{ok: boolean, cartId?: string, directUrl?: string, error?: string}>}
     */
    createVirtualCart: async function (products) {
      if (!products || !products.length) return { ok: false, skipped: true };

      const payloadProducts = products.map((item) => ({
        productId: Number(item.productId || item.id),
        qty: Number(item.qty || 1),
        selectedVariation: item.selectedVariation || '',
        addons: item.addons || []
      }));

      try {
        const response = await fetch(SAPORI_CONFIG.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ApiKey': SAPORI_CONFIG.apiKey
          },
          body: JSON.stringify({
            virtualCart: JSON.stringify(payloadProducts)
          })
        });

        if (response.ok) {
          const resData = await response.json();
          if (resData && resData.data && resData.data.id) {
            return {
              ok: true,
              cartId: String(resData.data.id),
              directUrl: 'https://pizzeria-sapori-italia.ro/add-to-cart/?cartId=' + resData.data.id
            };
          }
          return { ok: false, error: 'Răspuns API fără ID de comandă.' };
        }
        return { ok: false, error: 'API restaurant: HTTP ' + response.status };
      } catch (err) {
        return { ok: false, error: err.message || 'rețea indisponibilă' };
      }
    }
  };

  window.MunchoSaporiBridge = SaporiBridge;
})();
