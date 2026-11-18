# Running the Bristol Brief on the VPS

The site moves from Vercel to the VPS that already runs Frontier. Editing is the
same: admin saves still commit to `main` through the GitHub API. The hourly
ingest still runs in GitHub Actions, but it publishes the data to a separate
`data` branch instead of `main`. The VPS checks `main` once a minute and, when
it has moved (a code change or an admin save), builds the new commit (about 10
seconds) and switches to it. Headline, alert and tide updates never need a
build: the Node server reads the current data from the `data` branch at most
once a minute.

```
GitHub Actions ingest ─► `data` branch ──────────────┐ (read at runtime, about once a minute)
admin saves ────────┐                                 ▼
code changes ───────┴─► main ─► VPS deploy timer ─► .releases/<sha> ─► node :4322 ─► nginx (3 min page cache)
```

- The Node server (`bristolbrief.service`, port 4322, localhost only) renders
  every page. It needs outbound HTTPS to `raw.githubusercontent.com` for the
  data; if that is unreachable it uses the copy bundled with the last build.
  `DATA_BASE_URL` in `/etc/bristolbrief.env` points it somewhere else.
- nginx serves the build's static files from disk and caches rendered pages for
  3 minutes (the `X-Cache` header shows HIT or MISS). `/admin` and `/api/*`
  are never cached, apart from the 5-minute flood-data cache.
- The last five builds stay on disk under `/var/www/bristolbrief/.releases/`,
  so a rollback takes about a second.

Vercel keeps working the whole time: `astro.config.mjs` only switches to the
Node adapter when `DEPLOY_TARGET=node`, so DNS can point at either host.

## 1. Install (as root on the VPS, after this branch is merged to `main`)

```sh
# A user for the site, so it doesn't run as root
useradd --system --create-home --home-dir /var/lib/bristolbrief --shell /usr/sbin/nologin bristolbrief

# The code (public repo, so no key needed to pull)
git clone --depth 1 https://github.com/soupsoup/bristolbrief /var/www/bristolbrief
chown -R bristolbrief:bristolbrief /var/www/bristolbrief

# Let the deploy job restart the site, and nothing else
echo 'bristolbrief ALL=(root) NOPASSWD: /usr/bin/systemctl restart bristolbrief' > /etc/sudoers.d/bristolbrief
chmod 440 /etc/sudoers.d/bristolbrief && visudo -cf /etc/sudoers.d/bristolbrief

# Secrets
install -m 640 -o root -g bristolbrief /var/www/bristolbrief/deploy/vps/bristolbrief.env.example /etc/bristolbrief.env
nano /etc/bristolbrief.env
```

Fill `/etc/bristolbrief.env` with the values from the Vercel project
(Settings → Environment Variables). On your Mac, inside the repo,
`vercel env pull .env.vps --environment=production` writes them to a file.
Variables marked **Sensitive** in Vercel come back empty; for those, make a new
GitHub token (fine-grained, `soupsoup/bristolbrief` only, Contents: read and
write) and reuse or reset the admin password. Delete `.env.vps` afterward.

```sh
# Services
cp /var/www/bristolbrief/deploy/vps/bristolbrief.service \
   /var/www/bristolbrief/deploy/vps/bristolbrief-deploy.service \
   /var/www/bristolbrief/deploy/vps/bristolbrief-deploy.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable bristolbrief

# First build; this also starts the site
systemctl start bristolbrief-deploy
journalctl -u bristolbrief-deploy -n 20 --no-pager    # expect "Deployed <sha> ... in Ns"
systemctl status bristolbrief --no-pager              # expect active (running)

# From now on, check main every minute
systemctl enable --now bristolbrief-deploy.timer

# nginx
mkdir -p /var/cache/nginx/bristolbrief
cp /var/www/bristolbrief/deploy/vps/nginx-bristolbrief.conf /etc/nginx/sites-available/bristolbrief
ln -s /etc/nginx/sites-available/bristolbrief /etc/nginx/sites-enabled/bristolbrief
nginx -t && systemctl reload nginx
```

## 2. Test before touching DNS

From your Mac (replace `VPS_IP`):

```sh
curl -s -o /dev/null -w "%{http_code}\n" --resolve bristolbrief.com:80:VPS_IP http://bristolbrief.com/
# The home page must be 200 too: it is a directory on disk, and a missing index.html is a 403
curl -s -o /dev/null -w "%{http_code}\n" --resolve bristolbrief.com:80:VPS_IP http://bristolbrief.com/news/
curl -sI --resolve bristolbrief.com:80:VPS_IP http://bristolbrief.com/api/flood-data.json | grep -i x-cache
curl -sI --resolve bristolbrief.com:80:VPS_IP http://bristolbrief.com/news/ | grep -i x-cache   # MISS, then HIT on the second request
```

To click around, including signing in to `/admin/`, add `VPS_IP bristolbrief.com`
to `/etc/hosts` on the Mac, browse to **http**://bristolbrief.com, then remove
the line.

## 3. Cut over

1. In **Hover** (the domain's DNS), set the `A` record for `bristolbrief.com`
   and for `www` to the VPS's IP. Remove any `CNAME` for `www` pointing at
   Vercel. Wait until `dig +short bristolbrief.com` returns the VPS IP.
2. On the VPS:
   `certbot --nginx -d bristolbrief.com -d www.bristolbrief.com --redirect`
   (the site is plain HTTP for the minute or two between steps 1 and 2).
3. Check https://bristolbrief.com/, sign in to the admin, save something
   small, and watch it go live: `journalctl -u bristolbrief-deploy -f`.
4. In Vercel, open the bristolbrief project → Settings → Git →
   **Disconnect**. This stops the builds on every headline commit, which is
   the point of the move. Keep the project for a week as a fallback (point
   DNS back to undo), then delete it.

## Day to day

| Task | Command |
|---|---|
| See deploys | `journalctl -u bristolbrief-deploy -f` |
| Site logs | `journalctl -u bristolbrief -f` |
| Rebuild now | `sudo -u bristolbrief env SITE_URL=https://bristolbrief.com /var/www/bristolbrief/deploy/vps/deploy.sh --force` |
| Roll back | `ls /var/www/bristolbrief/.releases`, then `sudo -u bristolbrief /var/www/bristolbrief/deploy/vps/deploy.sh --rollback <sha>` |
| Pause deploys | `systemctl stop bristolbrief-deploy.timer` |

A rollback holds only until the next commit lands on `main`. To stay on an old
release, stop the timer first.

A failed build never replaces the running site; the journal shows the error.
