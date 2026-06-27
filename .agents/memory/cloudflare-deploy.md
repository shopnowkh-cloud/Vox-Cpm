---
name: Cloudflare Worker deploy workflow
description: How this project is structured — Cloudflare runs the bot, Replit is edit + deploy only.
---

## Setup

- **Bot code:** `worker/src/index.js` (Telegram bot + Gradio TTS)
- **Deploy command:** `cd worker && CLOUDFLARE_API_TOKEN=$CF_API_TOKEN ./node_modules/.bin/wrangler deploy`
- **Replit workflow:** "Deploy to Cloudflare" (run this after every edit)
- **Live URL:** `https://voxcpm2-bot.limsovannrady9mm.workers.dev`
- **Cloudflare account ID:** `d8849271816bf8825908efa8edc58162`
- **KV namespace:** `BOT_KV` (id: `5e0fc5717c684f97b17f0e184ad962dc`)

## Workflow

1. Edit `worker/src/index.js` in Replit
2. Run workflow **"Deploy to Cloudflare"** ▶
3. Cloudflare Worker updates live in ~10 seconds
4. Replit does NOT need to be running for the bot to work

**Why:** Bot is a Cloudflare Worker (serverless), Replit is only the IDE + deploy trigger.

## Secrets

- `CF_API_TOKEN` — stored in Replit secrets, used for wrangler deploy
- `BOT_TOKEN` — stored in Cloudflare Worker environment secrets (not Replit)
- `BOT_KV` — KV binding for user state storage

## Gradio error fix

- `gradioGenerate()` retries up to 3 times with wake-up call when HF Space returns `event: error` with null data
- Error "Gradio error: null" = HuggingFace Space sleeping — retry handles it automatically
