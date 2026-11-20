<p align="center"><img src="public/logo.svg" width="72" alt="PKJ Mails logo"></p>
<h1 align="center">PKJ Mails</h1>
<p align="center">Your own webmail. A clean, familiar inbox you can run on your computer or any server.<br>Works with <b>SQLite, MongoDB, PostgreSQL, MySQL or Firebase</b>. Sends with any SMTP provider.</p>

---

> 📸 *Screenshot placeholder: Inbox screenshot*

## What you get

- **Inbox that feels familiar**: Compose, Inbox, Starred, Sent, Drafts, Spam, Trash and your own Labels.
- Mail list with checkboxes, stars, sender, subject, preview and time. Unread mail is **bold**.
- Reading pane (side by side on big screens), reply, reply all, forward, attachments.
- Compose window in the bottom-right corner (minimise, full screen, drafts save by themselves).
- Search like `from:ana is:unread has:attachment invoice`.
- Works on phones. Light and dark mode.
- Keyboard shortcuts: `c` compose, `/` search, `j`/`k` next/previous, `r` reply, `s` star, `#` delete, `u` back.
- **Any database**: change one line in `.env`.
- **Send** through Gmail, Outlook, Zoho, Brevo, Resend or any SMTP server.
- **Receive** by IMAP (checks your mailbox every minute) and/or a webhook.
- A **setup page** on first start that asks for your login and mail settings and tests them.
- Safe by default: hashed password, sessions, rate limits, CSRF protection, mail HTML cleaned of scripts and shown in a locked frame.

---

## Quick start (about 10 minutes)

You do **not** need to know programming. Follow the steps one by one.

### Step 1. Install Node.js

1. Open **https://nodejs.org**
2. Download the **LTS** version (22 or newer) and install it. Keep clicking "Next".
3. To check, open a terminal:
   - **Windows**: press the Windows key, type `cmd`, press Enter.
   - **Mac**: open the **Terminal** app.
   - Type `node -v` and press Enter. You should see something like `v22.11.0`.

> 📸 *Screenshot placeholder: Node version screenshot*

### Step 2. Download PKJ Mails

**Easy way:** on this GitHub page click the green **Code** button, then **Download ZIP**. Unzip it (right click > Extract all).

**Or with git:**

```bash
git clone https://github.com/pankaj-pkj/pkj-mails.git
```

### Step 3. Open the folder in the terminal

```bash
cd pkj-mails
```

(If you downloaded the ZIP, the folder may be called `pkj-mails-main`. Tip on Windows: open the folder, click the address bar, type `cmd`, press Enter.)

### Step 4. Make your `.env` file

Copy the example settings file:

- **Windows:** `copy .env.example .env`
- **Mac / Linux:** `cp .env.example .env`

Open `.env` in Notepad (or any text editor) and fill:

| Setting | What to put |
|---|---|
| `APP_SECRET` | A long random text. Make one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the result. |
| `DB_TYPE` | Keep `sqlite` to start. Nothing else to install. |
| `DATABASE_URL` | Only if you choose mongodb, postgres or mysql (see "Choose a database" below). |
| `SETUP_CODE` | Optional: any word you like. You will type it on the setup page. |

Save the file. **Never share `.env` or upload it to GitHub.** It is already in `.gitignore`.

### Step 5. Install and start

```bash
npm install
npm start
```

You will see:

```
  PKJ Mails is running
  Open:     http://localhost:3000
  Database: sqlite

  Setup code: 3f9a1c2b   (the setup page asks for it)
```

### Step 6. Finish setup in the browser

1. Open **http://localhost:3000**
2. Type the **setup code** from the terminal.
3. Create your **admin login** (email + password, 10+ characters).
4. **Sending**: click your provider (Gmail, Outlook, Brevo...), fill username and password, press **Send a test mail**. Green tick = it works.
5. **Receiving** (optional): fill the IMAP box and press **Test receiving**. You can skip and do this later in Settings.
6. Press **Finish setup**, then sign in. Done! 🎉

> 📸 *Screenshot placeholder: Setup screenshot*

To stop the app press `Ctrl + C` in the terminal. To start again: `npm start`.

---

## Using Gmail to send and receive

Gmail does not accept your normal password from apps. You need an **App password**:

1. Turn on **2-Step Verification**: https://myaccount.google.com/security
2. Open https://myaccount.google.com/apppasswords
3. Name it "PKJ Mails", press **Create**, copy the 16-letter password.
4. On the setup page click **Gmail**, and use:
   - Username: your full Gmail address
   - Password: the 16-letter app password
   - IMAP: same username and app password
5. In Gmail settings > **Forwarding and POP/IMAP**, make sure **IMAP is enabled**.

Other providers: Outlook (`smtp-mail.outlook.com`, 587), Zoho (`smtp.zoho.com`, 465), Brevo (`smtp-relay.brevo.com`, 587, SMTP key as password), Resend (`smtp.resend.com`, 465, user `resend`, API key as password). The setup page fills these for you.

---

## Choose a database

Change `DB_TYPE` in `.env`, then restart (`Ctrl + C`, then `npm start`). Tables are created by themselves.

| DB_TYPE | Good for | What to fill | Free option |
|---|---|---|---|
| `sqlite` | Your own computer or a VPS. Zero setup. | nothing (file is `data/pkj-mails.db`) | built in |
| `mongodb` | Hosting sites like Render | `DATABASE_URL=mongodb+srv://user:pass@cluster.mongodb.net/pkjmails` | MongoDB Atlas free tier |
| `postgres` | Hosting sites | `DATABASE_URL=postgres://user:pass@host:5432/pkjmails` | Neon, Supabase |
| `mysql` | Shared hosting, cPanel | `DATABASE_URL=mysql://user:pass@host:3306/pkjmails` | many hosts include it |
| `firebase` | If you already use Firebase | `FIREBASE_DB_URL` and `FIREBASE_DB_SECRET` | Firebase Spark plan |

> **Important for Render / Railway / Heroku-style hosts:** their disk is wiped on every restart, so SQLite would lose your mail. Use MongoDB, Postgres, MySQL or Firebase there (or add a paid persistent disk).

**Firebase:** create a Realtime Database, then Project settings > Service accounts > **Database secrets** > copy the secret into `FIREBASE_DB_SECRET`. Keep your database rules locked (`".read": false, ".write": false`); the secret still works.

**Add your own database:** copy `src/db/memory.js`, fill the same methods, and add it to `src/db/index.js`.

---

## Receiving mail

PKJ Mails can get new mail two ways. Use one or both.

### A. IMAP (easiest)
Fill IMAP on the setup page or in **Settings > Receiving**. The app checks the mailbox every 60 seconds (`IMAP_POLL_SECONDS`) and copies new mail to your inbox. The first time it only copies the newest 50 mails. Mail stays in your original mailbox too.

### B. Webhook (for your own domain)
1. Put `INBOUND_SECRET=<a long random text>` in `.env` and restart.
2. Send each incoming mail to `POST https://your-site/api/inbound` with the header `Authorization: Bearer <INBOUND_SECRET>` (or `?key=<INBOUND_SECRET>` in the link).
3. The body can be the **raw mail** (`Content-Type: message/rfc822`) or **JSON**: `{ "from": "...", "to": "...", "subject": "...", "text": "...", "html": "..." }` or `{ "raw": "<base64 raw mail>", "encoding": "base64" }`.

Ready-made example for **Cloudflare Email Routing** (free, for your own domain): [`docs/cloudflare-email-worker.js`](docs/cloudflare-email-worker.js).

---

## Deploying online

- **Render (free, click-through):** [docs/DEPLOY-RENDER.md](docs/DEPLOY-RENDER.md)
- **Your own VPS (DigitalOcean, Hetzner, AWS Lightsail…):** [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md)

Always use **https** online, so your password and mail are encrypted on the way.

---

## Something went wrong?

See **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**. The most common ones:

| You see | Fix |
|---|---|
| `'node' is not recognized` | Install Node.js (Step 1), then close and reopen the terminal. |
| `PKJ Mails needs Node.js 22 or newer` | Install the latest LTS from nodejs.org. |
| `Port 3000 is already in use` | Put `PORT=3001` in `.env`, or close the other app. |
| `SMTP login failed` | Wrong username/password. For Gmail use an **App password**. |
| `SMTP server did not answer` | Port and Secure switch don't match: 465 = Secure ON, 587 = Secure OFF. |
| `The setup code is wrong` | Look in the terminal for `Setup code: ...`, or set `SETUP_CODE` in `.env`. |
| `Could not open the database` | Check `DB_TYPE` and `DATABASE_URL` in `.env`. |

### Reset the admin password
Stop the app, add these two lines to `.env`, start again and sign in with them:

```
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=your-new-long-password
```

While these are set they win over the password saved by the setup page.

---

## Security notes

- Your password is stored hashed (scrypt). Saved SMTP/IMAP passwords are encrypted with `APP_SECRET` (AES-256-GCM).
- Sessions are random tokens in an HttpOnly, SameSite=Strict cookie; only their hash is stored.
- Every change needs a CSRF token and a custom header; other websites cannot act for you.
- Sign-in tries, setup-code tries, sending and the webhook are rate limited.
- Mail HTML is cleaned (no scripts, forms, event handlers or `javascript:` links) and shown in a sandboxed frame that cannot run scripts. Attachments always download, never open inside the app.
- Secrets live only in `.env` (git-ignored) or encrypted in your database.
- If you change `APP_SECRET`, saved mail passwords can no longer be read; enter them again in Settings.

Found a security problem? Please open a private security advisory on GitHub instead of a public issue.

---

## For developers

```bash
npm test         # adapter + API tests (memory and SQLite always; others with TEST_*_URL)
npm run dev      # restarts on file changes
```

Run the adapter tests against real databases (use **empty** test databases):

```bash
TEST_POSTGRES_URL=postgres://... TEST_MYSQL_URL=mysql://... TEST_MONGODB_URL=mongodb://... npm test
```

Project layout:

```
src/server.js         starts the app, reads .env
src/app.js            the API (/api/...)
src/security.js       passwords, sessions, rate limits, encryption
src/db/               storage adapters: sql.js (sqlite/postgres/mysql), mongo.js, firebase.js, memory.js
src/mail/             mime parser, HTML sanitizer, SMTP/IMAP, settings
public/               the inbox page (plain JavaScript, no build step)
test/                 node:test tests
```

## License

MIT. Free to use, change and share. See [LICENSE](LICENSE).

PKJ Mails is an independent project and is not affiliated with Google or Gmail.
