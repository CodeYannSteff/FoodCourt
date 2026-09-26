/**
 * Muncho order dispatch — sends the saved order to the restaurant
 * with pure frontend code (no backend, FTP / GitHub Pages safe).
 *
 * Channels (all optional, configured in js/config.js → dispatch):
 *  1) ntfy.sh push: POSTs a kitchen ticket to https://ntfy.sh/<topic>.
 *     The counter opens the ntfy app (or the web URL) and every order
 *     pops up live with sound. No account, no keys.
 *  2) Generic webhook: POSTs the order JSON to orderWebhookUrl when set —
 *     plug in the restaurant's real order system later without touching UI code.
 *  3) WhatsApp ticket: already handled by MunchoSaporiBridge (manual button).
 */

(function () {
  'use strict';

  function getCfg() {
    return (window.MUNCHO_CONFIG && window.MUNCHO_CONFIG.dispatch) || {};
  }

  const METHOD_LABELS = {
    TEJ: 'Plată la tejghea',
    'GOOGLE PAY': 'Google Pay',
    'APPLE PAY': 'Apple Pay',
    CASH: 'Numerar'
  };

  function plainTicket(order) {
    const lines = (order.items || []).map((i) => `• ${i.qty}x ${i.title} (${Number(i.price * i.qty).toFixed(2)} lei)`);
    return [
      `COMANDA MUNCHO #${order.code} — ${order.date || ''}`,
      `Plata la casa: ${METHOD_LABELS[order.payMethod] || order.payMethod || '-'}${order.payTx ? ' (' + order.payTx + ')' : ''}`,
      `Produse:\n${lines.join('\n')}`,
      `TOTAL: ${Number(order.total).toFixed(2)} lei`
    ].join('\n');
  }

  async function sendNtfy(order) {
    const topic = String(getCfg().ntfyTopic || '').trim();
    if (!topic) return { channel: 'ntfy', skipped: true };
    try {
      const res = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), {
        method: 'POST',
        headers: {
          'Title': ('Comanda #' + order.code + ' — ' + Number(order.total).toFixed(2) + ' lei').substring(0, 100),
          'Tags': 'pizza,moneybag',
          'Priority': 'high'
        },
        body: plainTicket(order)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return { channel: 'ntfy', ok: true, topic };
    } catch (e) {
      return { channel: 'ntfy', ok: false, error: e.message };
    }
  }

  async function sendWebhook(order) {
    const url = String(getCfg().orderWebhookUrl || '').trim();
    if (!url) return { channel: 'webhook', skipped: true };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'muncho-foodcourt', order })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return { channel: 'webhook', ok: true };
    } catch (e) {
      return { channel: 'webhook', ok: false, error: e.message };
    }
  }

  const Dispatch = {
    /**
     * Forward the finalized order to the restaurant. Never throws —
     * returns per-channel results for the success screen.
     */
    sendOrder: async function (order) {
      const results = await Promise.all([sendNtfy(order), sendWebhook(order)]);
      const delivered = results.some((r) => r.ok);
      try {
        const key = 'fc-dispatch-log';
        const log = JSON.parse(localStorage.getItem(key) || '[]');
        log.unshift({ at: new Date().toISOString(), code: order.code, results });
        localStorage.setItem(key, JSON.stringify(log.slice(0, 50)));
      } catch (e) {}
      return { delivered, results };
    }
  };

  window.MunchoDispatch = Dispatch;
})();
