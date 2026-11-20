/**
 * Cloudflare Email Worker that delivers every mail sent to your domain into PKJ Mails.
 * Full step-by-step guide: docs/OWN-DOMAIN.md
 *
 * 1. Cloudflare dashboard > your domain > Email > Email Routing: turn it on.
 * 2. Workers & Pages > Create > Worker. Paste this file. Deploy.
 * 3. Worker > Settings > Variables and Secrets: add
 *      PKJ_URL     = https://your-pkj-mails-site/api/inbound
 *      PKJ_SECRET  = the same text as INBOUND_SECRET in your .env   (type: Secret)
 *      FALLBACK    = (optional) an address verified in Email Routing > Destination addresses.
 *                    If PKJ Mails can't be reached, the mail is forwarded there instead of bounced.
 * 4. Email Routing > Routing rules: "Catch-all" (or one address) > action "Send to a Worker" > pick this worker.
 */
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // A sleeping free server can take a while to wake up, so try a few times.
    let status = 0;
    for (const pause of [0, 8000, 20000]) {
      if (pause) await wait(pause);
      try {
        const res = await fetch(env.PKJ_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'message/rfc822', Authorization: 'Bearer ' + env.PKJ_SECRET },
          body: raw
        });
        status = res.status;
        if (res.ok) return;
        if (status === 401 || status === 403 || status === 413) break; // retrying will not help
      } catch (e) {
        status = 0; // network error or timeout: try again
      }
    }

    // Not delivered: keep the mail if a backup address is set, otherwise tell the sender.
    if (env.FALLBACK) {
      await message.forward(env.FALLBACK);
      return;
    }
    message.setReject('Mailbox temporarily unavailable (' + (status || 'no answer') + '). Please try again later.');
  }
};
