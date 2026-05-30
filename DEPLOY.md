# Deploying the LCARS Tactical Grid 🖖

The app is a zero-dependency Node server (`server.js`) that serves the game from
`public/` and stores config + scores as JSON files in a data directory.

The **only** thing to get right in production is **persistence**: cloud hosts wipe
the local filesystem on every redeploy/restart. The server reads its data path
from the `DATA_DIR` environment variable, so point that at a **mounted volume**.

```
DATA_DIR  → directory for config.json / scores.json   (default: ./data)
PORT      → injected automatically by the host         (default: 3000)
```

---

## Option A — Railway (recommended: free tier supports persistent volumes)

1. Push this folder to a GitHub repo.
2. Go to https://railway.app → **New Project → Deploy from GitHub repo** → pick the repo.
   Railway auto-detects Node and runs `npm start`.
3. Add persistence: open the service → **Variables/Settings → Volumes → New Volume**,
   set the **mount path** to `/data`.
4. Add an environment variable: **`DATA_DIR` = `/data`** (matches the volume mount).
5. Open **Settings → Networking → Generate Domain**. Your game is live at that URL.

Redeploys now keep your config and scoreboard because they live on the volume.

---

## Option B — Render

1. Push to GitHub.
2. https://render.com → **New → Blueprint**, select the repo (uses `render.yaml`).
3. The blueprint provisions a 1 GB disk mounted at `/var/data` and sets
   `DATA_DIR=/var/data`.

> ⚠️ Persistent disks on Render require a **paid** instance type. For a *free*
> Render instance, delete the `disk:` block and the `DATA_DIR` var from
> `render.yaml` — the game still runs, but data resets on restart. For free
> persistence, use Railway (Option A).

---

## Option C — Docker (Fly.io, a VPS, or anywhere)

A `Dockerfile` is included.

```bash
# Build
docker build -t kobayashi-maru .

# Run with a persistent named volume mounted at /data
docker run -p 3000:3000 -v ttt-data:/data kobayashi-maru
# → http://localhost:3000
```

On **Fly.io**: `fly launch` (it detects the Dockerfile), then
`fly volumes create data --size 1` and add to `fly.toml`:

```toml
[env]
  DATA_DIR = "/data"

[mounts]
  source = "data"
  destination = "/data"
```

---

## A note on shared state

Config and scores are **global** — there's a single config and one scoreboard for
the whole deployment, so all visitors share them. That's fine for personal use or a
single-player kiosk. If you later want **per-visitor** settings or a **competitive
leaderboard across players**, that's a small redesign — ask and I'll wire it up.

---

## Custom domain & HTTPS

All three hosts give you free HTTPS automatically. To use your own domain
(e.g. `kobayashimaru.example.com`), add it in the host's dashboard under
Custom Domains and follow their DNS (CNAME) instructions.
