# Troubleshooting

Find the message you see, then follow the fix. Messages appear in the terminal (where you ran `npm start`), on Render's **Logs** tab, or on the page itself.

## Installing and starting

**`'node' is not recognized` / `command not found: node`**
Node.js is not installed, or the terminal was open before you installed it. Install the LTS from https://nodejs.org, then close and reopen the terminal.

**`PKJ Mails needs Node.js 22 or newer`**
Install the newest LTS from https://nodejs.org (it replaces the old one).

**`npm install` shows red `ERR!` lines**
- Check your internet connection and run `npm install` again.
- Warnings in yellow (`WARN`) are fine.
- If an *optional* package (mongodb, pg, mysql2, imapflow) fails, the app still works with SQLite. Install the one you need by hand, e.g. `npm install pg`.

**`Port 3000 is already in use`**
Another app (or another copy of PKJ Mails) uses that port. Close it, or put `PORT=3001` in `.env` and open http://localhost:3001.

**The page says "Cannot reach the server"**
The app is not running. Look at the terminal: start it with `npm start`, and read any red message.

## Setup page

**`The setup code is wrong`**
Look in the terminal (or Render Logs) for the line `Setup code: xxxxxxxx`. The code changes on every restart unless you set `SETUP_CODE=...` in `.env`.

**`Setup is already finished. Sign in instead.`**
Setup only runs once. To start completely fresh with SQLite: stop the app, delete the file `data/pkj-mails.db`, start again. (This deletes all mail in it.)

**Forgot the admin password**
Put `ADMIN_EMAIL=...` and `ADMIN_PASSWORD=...` in `.env` and restart. Those win over the saved login.

## Sending mail (SMTP)

**`SMTP login failed`**
- Username or password is wrong.
- **Gmail / Yahoo:** you must use an **App password**, not your normal password (see README).
- **Brevo:** the password is an **SMTP key** (Brevo > SMTP & API), not your Brevo login password.
- **Resend:** username is `resend`, password is your API key.

**`SMTP server did not answer` / `wrong version number`**
The port and the **Secure** switch must match:
- port **465** → Secure **ON**
- port **587** → Secure **OFF** (the connection is upgraded automatically)
Some hosts (and some home internet providers) block port 25/465/587. Try the other port, or a provider that offers port 2525 (Brevo does).

**`The provider did not accept the "From" address`**
Most providers only send from addresses or domains you have verified with them. Use your own login address as "Send from", or verify your domain at the provider.

**Mail goes to the receiver's spam folder**
Use a real provider (not a home server), verify your domain with it, and add the SPF/DKIM DNS records it gives you.

## Receiving mail (IMAP)

**`IMAP login failed`**
Same as SMTP: Gmail/Yahoo need an App password, and IMAP must be enabled in the mailbox settings (Gmail: Settings > Forwarding and POP/IMAP > Enable IMAP).

**New mail does not show up**
- Wait one minute (`IMAP_POLL_SECONDS`), then press the refresh button.
- On free Render the app sleeps; mail is fetched when it wakes.
- Only mail in the **INBOX** folder of the mailbox is copied.

## Webhook (`/api/inbound`)

| Answer | Meaning |
|---|---|
| `503 Inbound mail is off` | Set `INBOUND_SECRET` (16+ characters) in `.env` and restart. |
| `401 Wrong inbound key` | The `Authorization: Bearer ...` header or `?key=` does not match `INBOUND_SECRET`. |
| `413 That is too big` | The mail is over 30 MB. |
| `{ "duplicate": true }` | That mail (same Message-ID) is already stored. Not an error. |

## Database

**`Could not open the database`**
- `DB_TYPE` must be one of `sqlite`, `mongodb`, `postgres`, `mysql`, `firebase`.
- `DATABASE_URL` must be the full link, including user, password and database name.
- **MongoDB Atlas:** add `0.0.0.0/0` under Network Access. Special characters in the password (`@ : / ?`) must be written as `%40 %3A %2F %3F`.
- **Postgres (Neon/Supabase):** keep `?sslmode=require` at the end of the link.
- **MySQL:** the database (schema) must exist first: `CREATE DATABASE pkjmails;`
- **Firebase:** `FIREBASE_DB_URL` must look like `https://your-project-default-rtdb.firebaseio.com`, and `FIREBASE_DB_SECRET` must be a Database secret.

**`needs the "pg" package` (or mongodb / mysql2)**
Run the `npm install ...` command shown in the message, then `npm start` again.

**All mail is gone after a restart on Render**
Render's free disk is temporary. Use MongoDB/Postgres/MySQL/Firebase there (see DEPLOY-RENDER.md).

## Signing in

**`Too many sign-in tries`**
Wait 15 minutes. This protects you from password guessing.

**`Your session token is out of date. Reload the page.`**
Reload the page (F5). It happens after signing in on another tab.

**Saved SMTP/IMAP password stopped working after I changed `APP_SECRET`**
Saved passwords are encrypted with `APP_SECRET`. Open Settings and type them again.

Still stuck? Open an issue on GitHub with the exact message (remove any passwords first).
