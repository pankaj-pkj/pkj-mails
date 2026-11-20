# Put PKJ Mails online with Render (free)

Render runs the app for you. No server to manage. Takes about 15 minutes.

> Render's free disk is wiped on every restart, so **do not use SQLite here**. Use a free MongoDB Atlas or Neon Postgres database (steps below).

## Step 1. Get a free database

**Option A: MongoDB Atlas**
1. Sign up at https://www.mongodb.com/cloud/atlas and create a **free M0** cluster.
2. **Database Access** > Add user > set a username and password.
3. **Network Access** > Add IP Address > **Allow access from anywhere** (`0.0.0.0/0`).
4. **Connect** > Drivers > copy the link. It looks like
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true`
5. Add a database name before the `?`: `...mongodb.net/pkjmails?retryWrites=true`

**Option B: Neon Postgres**
1. Sign up at https://neon.tech and create a project.
2. Copy the connection string (`postgres://...sslmode=require`).

## Step 2. Put the code on your GitHub
1. Sign in to GitHub and open https://github.com/pankaj-pkj/pkj-mails
2. Click **Fork** (top right). You now have your own copy.

## Step 3. Create the web service
1. Sign up at https://render.com with your GitHub account.
2. **New +** > **Web Service** > pick your `pkj-mails` fork.
3. Fill:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Open **Environment** and add:

| Key | Value |
|---|---|
| `APP_SECRET` | a long random text (64 letters/numbers) |
| `DB_TYPE` | `mongodb` (or `postgres`) |
| `DATABASE_URL` | the link from Step 1 |
| `SETUP_CODE` | a long word only you know (8+ characters), e.g. `blue-tiger-river-42` |
| `TRUST_PROXY` | `1` |
| `NODE_VERSION` | `22` |

5. Click **Create Web Service**. Wait until the log says `PKJ Mails is running`.

> 📸 *Screenshot placeholder: Render environment screenshot*

Tip: the repo has a `render.yaml`, so you can also use **New + > Blueprint** and only fill the secret values.

## Step 4. Finish setup
1. Open your Render link, e.g. `https://pkj-mails-xxxx.onrender.com`
2. Type your `SETUP_CODE`, create your login, fill the mail settings and test them.

## Notes
- Free Render apps sleep after 15 minutes without visits; the first visit then takes ~30 seconds. IMAP checking also pauses while asleep and catches up when it wakes. A paid instance stays awake.
- Your own domain: Render > Settings > Custom Domains.
- To update: on your fork click **Sync fork**; Render redeploys by itself.
