# Putting BuildVendo online, free: GitHub + Vercel + MongoDB Atlas

Everything runs on Vercel as **two projects from the same GitHub repository**:
- **buildvendo** (the website): Root Directory `frontend`
- **buildvendo-api** (the backend API): Root Directory `backend`

The database is MongoDB Atlas (free M0). Photos and payment screenshots are stored in the database, so no extra storage account is needed.

## 1. GitHub
The code is in your repository. Every `git push` to `main` rebuilds both Vercel projects automatically.

## 2. Atlas: let Vercel connect
Atlas -> Network Access -> Add IP Address -> **Allow Access from Anywhere** (`0.0.0.0/0`).
Vercel functions have no fixed address. The database is still protected by its username and password.

## 3. Vercel project 1: the API (create this first)
1. Vercel -> **Add New -> Project** -> import the BuildVendo repository.
2. **Root Directory:** `backend`. **Framework Preset:** Other.
3. Environment variables:

| Name | Value |
|---|---|
| `MONGODB_URI` | your Atlas connection string |
| `DB_NAME` | `buildvendo` (a clean database for the live site) |
| `JWT_SECRET` | a long random value (see below) |
| `PASSWORD_PEPPER` | another long random value |
| `ENCRYPTION_KEY` | a third long random value |
| `SEED_ADMIN_EMAIL` | your own email: your Super Admin login |
| `SEED_ADMIN_PASSWORD` | a new password, 12+ characters: write it down |
| `FRONTEND_URL` | `https://buildvendo.vercel.app` |
| `ROOT_DOMAIN` | `buildvendo.vercel.app` |
| `PLATFORM_CURRENCY` | `PKR` |
| `TRUST_PROXY_HOPS` | `2` (see step 5) |
| `DB_POOL` | `5` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | your email settings (step 6) |

To make a random value, run this in a terminal and paste the result (do it three times):
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

4. Deploy. Open `https://<your-api-project>.vercel.app/api/health`. It should show `"database":"up"`.
   Note this address: it is your **API address**.

## 4. Vercel project 2: the website
1. **Add New -> Project** -> import the same repository again.
2. **Root Directory:** `frontend`.
3. Environment variables (add them before the first build):
   - `BACKEND_URL` = the API address from step 3
   - `ROOT_DOMAIN` = `buildvendo.vercel.app`
4. Deploy. If you changed `BACKEND_URL` later, press **Redeploy**: the address is built into the site.

## 5. Check the visitor address setting
Open `https://buildvendo.vercel.app/api/health`. The line `yourAddressAsSeenByApi` should be **your own public address**
(search "what is my IP"). If it shows something else, change `TRUST_PROXY_HOPS` in the API project (try `1`, `2`, `3`) and redeploy the API.
This matters for rate limits and the sign-in IP allow-list.

## 6. Email (required)
New stores confirm their email, and on a real server the link is only sent by email. For Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
`SMTP_USER` = your Gmail address, `SMTP_PASS` = a 16-character app password (Google account -> Security -> 2-Step Verification -> App passwords),
`MAIL_FROM=BuildVendo <your Gmail address>`.

## 7. First data
The first request creates the packages and your Super Admin from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. No demo store or test accounts are created.
Sign in at `/login?scope=platform`. Then add your payment accounts in Super Admin -> Payments.

## 8. Your own domain (optional)
Add the domain in the website project, then change `ROOT_DOMAIN` on **both** projects and redeploy.

## Limits of the free setup
- **Vercel Hobby is for personal, non-commercial use.** When BuildVendo earns money from stores, move to a paid Vercel plan.
- Uploaded images are limited to about 2.5 MB each and are stored in the database; Atlas free has 512 MB in total.
- Each API call can start "cold" (a short delay after a quiet period).
- The AI builder and emails finish in the background, up to 60 seconds per request.
- Rate limits and sign-in lockouts are counted per running copy of the API, so they are less strict than on a single server.
- Free Atlas allows 500 connections; `DB_POOL=5` keeps each API copy small.

## Settings reference
`backend/.env.example` and `frontend/.env.example` list every setting with a short explanation.
