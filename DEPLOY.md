# TheGavel — Deployment Guide

Rebuilt from a React 19 + Vite + Tailwind v4 auction simulator. This version is
**rebranded to TheGavel**, ships with **light + dark mode** (toggle in the
top-right), and runs with **zero backend** — solo auctions work 100% in the
browser against 9 AI bot franchises, no servers, no keys, no cost.

Everything below is $0.

---

## 1. Run it locally

```bash
npm install
npm run dev        # dev server
npm run build      # production build -> dist/
npm test           # 109 unit tests
```

On first load with no `.env`, the app is in offline/solo mode:
- Multiplayer surfaces (server switcher, public lobbies, cloud history) are hidden.
- The "Start Solo Auction" button works immediately against the local bot engine.
- A new manager identity is created in `localStorage` (device-local, no account).

---

## 2. Push to GitHub under your account

```bash
cd ipl-auction
git remote remove origin          # drop the friend's repo
git remote add origin https://github.com/harshavardhan/the-gavel
git add -A
git commit -m "Rebrand to TheGavel: light/dark theme, zero-backend solo deploy"
git push -u origin main
```

> The repo is `Apache-2.0` licensed (from the original), so this rebrand/fork is
> fully permitted. The name, logo, labels and CSS are all original to this copy.

---

## 3. Deploy free on Cloudflare Pages (recommended)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create application → Pages → Connect to Git**.
2. Authorize GitHub, pick the `harshavardhan/the-gavel` repo (create it as **the-gavel** so the name is yours).
3. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node version:** `20`
4. Leave environment variables **empty** for the solo build.
5. **Deploy site.** Cloudflare auto-deploys on every `git push` afterwards.

SPA routing already works: the repo ships `public/_redirects` (Cloudflare Pages)
and `netlify.toml` (if you prefer Netlify, same `npm run build` / `dist`).
Vercel: set Build Command `npm run build`, Output `dist`, and add the
`vercel.json` below.

`vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

---

## 4. Optional: enable multiplayer later (still free)

Multiplayer + the public lobby directory use Firebase Realtime Database and a
Cloudflare D1 worker. When you're ready, you'll need two free accounts:

- **Firebase** (free Spark tier) — one project is enough; the app reads its keys
  from environment variables.
- **Cloudflare** — a Pages site hosting the directory worker (see `cloudflare/`).

Then set these in your Pages dashboard (Settings → Environment variables) and
re-deploy; the multiplayer UI automatically reappears:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_DIRECTORY_API_URL
```

Until then, the app stays solo-only and never hangs on a missing backend.

---

## 5. Optional: enable ads later

Ad slots are off by default so nothing loads. To turn them on, set your own
publisher id in Pages env vars (`VITE_ADSENSE_CLIENT_ID` + slot vars, see
`.env.example`) and re-deploy. The friend's AdSense id was removed.

---

## What changed vs. the original

| Area | Original | This build |
|------|----------|-----------|
| Name / logo / labels | CrickAuction, cricket ball | TheGavel, gavel logo |
| Theming | dark-only | light + dark with persisted toggle |
| Backend | Firebase + Cloudflare required | zero-backend; solo works out of the box |
| Auth | Firebase anonymous/Google | device-local identity when no keys |
| Multiplayer UI | always shown | auto-hidden when no keys configured |
| Ads / analytics | friend's AdSense + CF beacon | removed (opt-in later via env) |
| Hosting | friend's stack | Cloudflare Pages / Netlify / Vercel, all free |
