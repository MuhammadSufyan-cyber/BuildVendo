# Putting BuildVendo online (GitHub, Render, Vercel)

The website (`frontend/`) goes on **Vercel**. The API (`backend/`) is a normal Node server, so it goes on **Render**
(Railway or Fly.io also work). The database stays on **MongoDB Atlas**.

## 1. GitHub
Push this repository. After that, every `git push` to `main` rebuilds the website and the API automatically.

## 2. Atlas: allow the API server
The live site uses its own database called `buildvendo` (set in `render.yaml`) on the same cluster, so it starts clean: no test stores or test accounts, and your Super Admin is the one you choose below. Atlas creates the database automatically on first use.

Atlas -> Network Access -> Add IP Address. Render's free plan has no fixed address, so add `0.0.0.0/0` (anywhere).
The database is still protected by its password. A paid Render plan gives fixed addresses you can list instead.

## 3. Render: the API
1. Render dashboard -> **New -> Blueprint** -> choose this repo. It reads `render.yaml`.
2. Fill in `MONGODB_URI` (your Atlas string), and choose your Super Admin sign-in: `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (12+ characters). Leave `FRONTEND_URL` and `ROOT_DOMAIN` for now.
3. When it finishes, copy the API address (for example `https://buildvendo-api.onrender.com`) and open `/api/health`.
   It should answer `{"status":"ok", ... "database":"up"}`.

## 4. Vercel: the website
1. Vercel -> **Add New -> Project** -> import the repo.
2. **Root Directory:** `frontend`.
3. Environment variables (add them before the first build):
   - `BACKEND_URL` = the Render address from step 3
   - `ROOT_DOMAIN` = the website host without `https://`, for example `buildvendo.vercel.app`
4. Deploy. Open the website.

## 5. Tell the API where the website is
Back in Render -> Environment: set `FRONTEND_URL` (`https://buildvendo.vercel.app`) and `ROOT_DOMAIN` (`buildvendo.vercel.app`), then redeploy.

## 6. First data
The first API start creates the packages and your Super Admin (the email and password you set in step 3). No demo store or test accounts are created on a real server.
Sign in at `/login?scope=platform`. You can remove `SEED_ADMIN_PASSWORD` from Render afterwards. Then add your payment accounts in Super Admin -> Payments.

## 7. Email (required on a real server)
New stores must confirm their email, and in production the confirmation link is only sent by email (the on-screen "confirm" button exists only in development).
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` on Render. For Gmail: host `smtp.gmail.com`, port `587`,
your Gmail address as user, and a 16-character **app password** (Google account -> Security -> 2-Step Verification -> App passwords).
Render's free plan blocks the usual email ports, which is one more reason `render.yaml` uses the paid always-on Starter plan.

## 8. Your own domain
Add the domain in Vercel (and `*.yourdomain.com` if stores should get subdomains). Then change `ROOT_DOMAIN` on both Vercel and Render.

## Good to know on the free plans
- The API goes to sleep when nobody uses it, so the first request after a rest takes a while.
- Uploaded photos are saved on the API's disk. The free plan loses that disk on every redeploy, so before real stores upload photos,
  move uploads to cloud storage (Vercel Blob or Cloudinary) or use a Render disk.
- Background jobs (the AI builder) run inside the API process. That is fine for now; use a queue later for heavy use.
- Keep `REQUIRE_2FA_PLATFORM=1` for the Super Admin once you have set up two-factor login.

## Settings reference
`backend/.env.example` and `frontend/.env.example` list every setting with a short explanation.
