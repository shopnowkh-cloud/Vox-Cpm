# VoxCPM2 Telegram Bot

Telegram TTS Bot powered by VoxCPM2, running entirely on Cloudflare Worker. Replit is used only for editing code and deploying to Cloudflare.

## Run & Operate

- **Deploy:** Run workflow **"Deploy to Cloudflare"** after every code change
- **Set/update secrets on Cloudflare:** `cd worker && echo "<value>" | CLOUDFLARE_API_TOKEN=$CF_API_TOKEN ./node_modules/.bin/wrangler secret put <KEY>`
- **Install worker deps (first time):** `cd worker && npm install`

## Stack

- Cloudflare Worker (JavaScript) — `worker/src/index.js`
- Telegram Bot API (webhook mode)
- HuggingFace Gradio Space (`OpenBMB/VoxCPM-Demo`) for TTS inference
- Cloudflare KV (`BOT_KV`) for user state storage

## Where things live

- `worker/src/index.js` — all bot logic (webhook handler, TTS, audio conversion)
- `worker/wrangler.toml` — Cloudflare Worker config (account ID, KV binding)
- `bot/bot.py` — legacy Python bot (not in use; CF Worker is the active bot)
- `VoxCPM/` — Python model source (reference only)

## Architecture decisions

- Bot runs as a Cloudflare Worker (serverless, no Replit server needed)
- Webhook mode: Telegram pushes updates to `https://voxcpm2-bot.limsovannrady9mm.workers.dev`
- Audio is converted WAV→OGG Opus inside the Worker using `opusscript`

## Secrets

- `CF_API_TOKEN` — Replit secret, used by wrangler to deploy
- `BOT_TOKEN` — Cloudflare Worker secret (set via wrangler, not Replit)
- `BOT_KV` — Cloudflare KV namespace binding

## User preferences

- Replit is edit + deploy only; no web server runs on Replit
- Always deploy via "Deploy to Cloudflare" workflow after edits
