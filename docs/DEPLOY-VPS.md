# Put PKJ Mails on your own VPS (Ubuntu)

Works on any Ubuntu 22.04 / 24.04 server (DigitalOcean, Hetzner, AWS Lightsail, Oracle free tier...). SQLite works well here because the disk is yours.

You need: a server, its IP address, and (for https) a domain name pointing to that IP (an **A record**, e.g. `mail.example.com`).

## Step 1. Connect to the server

```bash
ssh root@YOUR_SERVER_IP
```

## Step 2. Install Node.js 22, git, nginx

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx
node -v
```

## Step 3. Download and set up PKJ Mails

```bash
sudo adduser --system --group --home /opt/pkj-mails pkjmails
sudo git clone https://github.com/pankaj-pkj/pkj-mails.git /opt/pkj-mails/app
cd /opt/pkj-mails/app
sudo npm install --omit=dev
sudo cp .env.example .env
sudo nano .env
```

In `nano`, fill `APP_SECRET` (make one with `openssl rand -hex 32`), keep `DB_TYPE=sqlite`, set `SETUP_CODE` to a word you choose and `TRUST_PROXY=1`. Save with `Ctrl+O`, Enter, then `Ctrl+X`.

```bash
sudo chown -R pkjmails:pkjmails /opt/pkj-mails
sudo chmod 600 /opt/pkj-mails/app/.env
```

## Step 4. Keep it running (systemd)

```bash
sudo tee /etc/systemd/system/pkj-mails.service > /dev/null <<'EOF'
[Unit]
Description=PKJ Mails
After=network.target

[Service]
User=pkjmails
WorkingDirectory=/opt/pkj-mails/app
ExecStart=/usr/bin/node src/server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now pkj-mails
sudo journalctl -u pkj-mails -n 20     # shows the log and the setup code
```

## Step 5. Nginx + free https

```bash
sudo tee /etc/nginx/sites-available/pkj-mails > /dev/null <<'EOF'
server {
  server_name mail.example.com;
  client_max_body_size 40m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
sudo ln -s /etc/nginx/sites-available/pkj-mails /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mail.example.com
```

(Replace `mail.example.com` with your domain in both places.)

Open `https://mail.example.com` and finish the setup page.

## Updating

```bash
cd /opt/pkj-mails/app
sudo -u pkjmails git pull
sudo -u pkjmails npm install --omit=dev
sudo systemctl restart pkj-mails
```

## Backups

Your mail is in `/opt/pkj-mails/app/data/pkj-mails.db`. Copy it somewhere safe now and then:

```bash
sudo cp /opt/pkj-mails/app/data/pkj-mails.db ~/pkj-mails-backup-$(date +%F).db
```

## Firewall (recommended)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```
