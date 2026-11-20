# Your own email address: `you@yourdomain.com`

This guide gives you a real email address on your own domain — for example
`hello@mybrand.com` — that you read and send from **PKJ Mails**.
No coding needed. Every step is clicking and copy-paste.

**Time:** about 45 minutes, once. **Cost:** only your domain (the services below have free plans).

```
 Someone writes to hello@mybrand.com
          │
          ▼
 Cloudflare Email Routing (free) ──► Cloudflare Worker ──► your PKJ Mails ──► Inbox ✅

 You press Send in PKJ Mails ──► Resend (free) ──► arrives as hello@mybrand.com ✅
```

## Before you start

You need:

1. **A domain** you own (from GoDaddy, Namecheap, Hostinger, Cloudflare…).
2. **PKJ Mails online** with a public `https://` link — follow [DEPLOY-RENDER.md](DEPLOY-RENDER.md) or [DEPLOY-VPS.md](DEPLOY-VPS.md) first.
   Receiving needs the app reachable from the internet; `http://localhost` will not work for this guide.
3. A free **Cloudflare** account and a free **Resend** account.

> **Already have mail on this domain** (Google Workspace, Zoho, Hostinger mail…)? Email Routing will replace it.
> Either use a domain without mail, or skip Part 2 and just read that mailbox with IMAP (Settings → Receiving).

---

## Part 1 — Put your domain on Cloudflare (10 min)

Skip this part if your domain already uses Cloudflare.

1. Sign up at **https://dash.cloudflare.com** and click **Add a domain**. Type your domain, choose the **Free** plan.
2. Cloudflare shows **two nameservers** (like `ada.ns.cloudflare.com`).
3. Open the website where you bought the domain → **DNS / Nameservers** → choose **Custom nameservers** → paste the two Cloudflare names → save.
4. Back in Cloudflare, wait for the green **Active** status. Usually minutes, sometimes a few hours.

---

## Part 2 — Receive mail (15 min)

### 2.1 Give PKJ Mails a secret for incoming mail

Incoming mail is delivered to your app at `/api/inbound`, protected by a secret.

- **Render:** your service → **Environment** → if `INBOUND_SECRET` is not there, add it with a long random value
  (Render's *Generate* button works). Save — Render restarts the app.
- **VPS / your computer:** add `INBOUND_SECRET=<long random text>` to `.env` and restart.

Copy the value; you need it in 2.3.

### 2.2 Turn on Email Routing

1. Cloudflare → your domain → **Email** → **Email Routing** → **Get started / Enable**.
2. Cloudflare asks to add its mail records (**MX** and **TXT**). Click **Add records and enable**.

### 2.3 Create the Worker that hands mail to PKJ Mails

1. Cloudflare → **Workers & Pages** → **Create** → **Create Worker** → give it a name like `pkj-mail-in` → **Deploy**.
2. Click **Edit code**, delete everything, paste the whole file
   [`docs/cloudflare-email-worker.js`](cloudflare-email-worker.js) → **Deploy**.
3. Worker → **Settings** → **Variables and Secrets** → add:

   | Type | Name | Value |
   |---|---|---|
   | Text | `PKJ_URL` | `https://YOUR-PKJ-MAILS-LINK/api/inbound` |
   | Secret | `PKJ_SECRET` | the `INBOUND_SECRET` from 2.1 |
   | Text *(optional)* | `FALLBACK` | your Gmail address — used only if PKJ Mails can't be reached, so no mail is lost |

   Click **Deploy** again.

   Using `FALLBACK`? Add that Gmail under **Email Routing → Destination addresses** and click the link
   Cloudflare mails you, so Cloudflare is allowed to forward to it.

### 2.4 Send your domain's mail to the Worker

Cloudflare → **Email** → **Email Routing** → **Routing rules**:

- **One address:** *Create address* → custom address `hello` → action **Send to a Worker** → `pkj-mail-in`.
- **Every address (catch-all):** *Catch-all address* → **Edit** → action **Send to a Worker** → `pkj-mail-in` → enable.

**Test:** from your phone's Gmail, send a mail to `hello@yourdomain.com`. It appears in PKJ Mails within seconds. 🎉

---

## Part 3 — Send as `you@yourdomain.com` (15 min)

Gmail's SMTP can only send as your Gmail address. To send **as your domain**, use a sending service that
verifies your domain. We use **Resend** (free plan: about 3,000 mails a month). Brevo works too.

### 3.1 Verify your domain in Resend

1. Sign up at **https://resend.com** → **Domains** → **Add Domain** → type your domain.
2. Resend lists a few DNS records (an **MX** and a **TXT** for `send`, and a **TXT** for `resend._domainkey`).
3. In Cloudflare → your domain → **DNS** → **Records** → **Add record** for each one, copying *Type*, *Name* and *Value* exactly.
   Set **Proxy status** to **DNS only** (grey cloud) if Cloudflare offers it.
4. Back in Resend press **Verify**. Wait for **Verified** (minutes, sometimes up to an hour).

> These records live on the `send.` part of your domain, so they don't disturb the receiving records from Part 2.

### 3.2 Create an API key

Resend → **API Keys** → **Create API Key** → permission **Sending access** → copy the key (starts with `re_`).

### 3.3 Put it into PKJ Mails

PKJ Mails → **Settings** (gear) → **Sending** (or the setup page) → click **Resend**, then:

| Field | Value |
|---|---|
| Username | `resend` |
| Password | your API key (`re_...`) |
| From address | `hello@yourdomain.com` |
| Your name | the name people should see |

Press **Send a test mail**. A green tick means it works.

---

## Part 4 — Land in the inbox, not spam (5 min)

Add one more record in Cloudflare → **DNS** → **Add record**:

| Type | Name | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@yourdomain.com` |

Then send a test to **https://www.mail-tester.com** — a score of 8/10 or more is good.

Tips:
- New domains need a few days of normal use before every provider fully trusts them.
- Write like a person; avoid all-caps subjects and only-image mails.
- Keep only **one** `v=spf1` TXT record on the root of your domain. If you added another provider before, merge them into one line.

---

## Problems?

| What happens | Fix |
|---|---|
| Mail to your domain never arrives | Email Routing → **Activity log**. "Dropped" = the rule isn't set to the Worker. "Error" = check `PKJ_URL` (must end with `/api/inbound`) and that `PKJ_SECRET` equals `INBOUND_SECRET` exactly. |
| Worker log shows **401** | The secrets don't match. Copy them again, no spaces. |
| First mail after a quiet hour is late | Free Render apps sleep; the Worker waits and retries for about 30 seconds. Set `FALLBACK` so nothing is ever lost, and for daily use keep the app awake (paid instance or a VPS). |
| `Send a test mail` fails with Resend | Username must be exactly `resend`; the From address must use the verified domain. |
| Mails go to spam | Do Part 4, wait for Resend to show the domain **Verified**, and check mail-tester.com. |
| Domain "Pending" on Cloudflare for long | The nameservers at your domain seller are not saved yet, or old ones are still listed. Keep only the two Cloudflare ones. |

More fixes: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
