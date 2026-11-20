/**
 * Cloudflare Email Worker that forwards every mail sent to your domain into PKJ Mails.
 *
 * 1. Cloudflare dashboard > your domain > Email > Email Routing: turn it on.
 * 2. Workers & Pages > Create > Worker. Paste this file. Deploy.
 * 3. Worker > Settings > Variables: add
 *      PKJ_URL     = https://your-pkj-mails-site/api/inbound
 *      PKJ_SECRET  = the same text as INBOUND_SECRET in your .env   (as an encrypted "Secret")
 * 4. Email Routing > Routing rules: "Catch-all" (or one address) > action "Send to a Worker" > pick this worker.
 */
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const res = await fetch(env.PKJ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'message/rfc822', Authorization: 'Bearer ' + env.PKJ_SECRET },
      body: raw
    });
    if (!res.ok) {
      // Cloudflare tells the sender it failed, so no mail is lost silently
      message.setReject('Mailbox temporarily unavailable (' + res.status + ')');
    }
  }
};
