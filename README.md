# BuildVendo: multi-tenant e-commerce SaaS with an AI Store Builder

Built from `SRS_MultiTenant_Ecommerce_Platform.docx`.

- `backend/`  Node.js + Express API, MongoDB native driver (no ORM), Zod validation
- `frontend/` Next.js 16 app: home page and sign-up (`/`, `/start`), Super Admin panel (`/platform`),
  store dashboard (`/dashboard`), storefronts (`/s/<store-id>`, `<store-id>.<ROOT_DOMAIN>`, custom domains)

## Run it locally

```powershell
npm install
npm run dev          # backend on 5000 + frontend on 3000
```

Open http://localhost:3000. Test accounts are written to `backend/.seed-credentials.txt` on first start (never committed).

Try a store on its own address: http://demo.localhost:3000

Tests (backend must be running): `npm run test:smoke --workspace backend` (API, 150+ checks) and
`npm run test:stripe --workspace backend` (signed Stripe webhook events, no Stripe account needed).

## Configure

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local`.

| What | Setting | Without it |
|---|---|---|
| Database | `MONGODB_URI` (Atlas) | a temporary local test database in `backend/.data` |
| Email | `SMTP_*` | emails are printed in the backend console; the sign-up page shows a "confirm" button |
| Platform billing | none needed (manual transfers, see above). Optional: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | stores pay by transfer and the Super Admin approves |
| Store card payments | optional: each store pastes its own Stripe key in Settings | stores use transfers / payment links; a fake "test card" exists only in development |
| AI builder | `ANTHROPIC_API_KEY` | an offline keyword generator builds the draft |
| Platform staff 2FA | `REQUIRE_2FA_PLATFORM=1` | optional |

## What is built

Multi-tenancy with a tenant-scoped data layer; Super Admin (tenants, packages, 103 feature toggles with kill switch, per-tenant
overrides, impersonation with reason, broadcasts, support inbox, audit log, analytics); self-service sign-up with email confirmation
and a 14-day trial; AI Store Builder (describe, preview, change by chat, publish, roll back); invite/reset flows, Argon2id passwords,
lockout, two-factor login (authenticator app + recovery codes); RBAC with custom roles; package limits enforced on the server;
products, variants, photos, inventory, orders, refunds, POS, discounts (codes and automatic), customers, reports; storefront
(cart, checkout, accounts, wishlist, reviews, tracking); Stripe subscriptions for stores and Stripe payments to each store;
subdomains and verified custom domains; custom CSS; sign-in IP allow-list; GDPR export and erase; outgoing signed webhooks.

About 30 of the 103 feature toggles now control real behaviour. The rest are switches waiting for their feature to be built.

## Store features (Dashboard)

- **Store pictures** (Settings): logo, home banner and category pictures; product photos with a gallery on the product page.
- **Blog** (Basic and above): write posts, publish them at `/s/<store-id>/blog`. Posts are plain text only, never HTML.
- **Returns** (Pro and above): shoppers request a return at `/s/<store-id>/returns` with their order number and email (within 30 days); the store approves, rejects or refunds (fully or partly, optionally restocking).
- **Shipping by country** (Settings): zones with their own fee and free-shipping threshold; other countries use the default fee.
- **Loyalty points** (Premium): points earned on paid orders and spent as money off at checkout; points return if an order using them is cancelled.

## Online payments without a payment provider (default)

Stripe is optional and switched off unless you add keys. The built-in way to take payments is an admin portal that confirms them by hand.

**Shoppers pay a store** (Dashboard -> Payments):
- The store adds its bank / JazzCash / Easypaisa / wallet accounts and/or a payment-page link (any gateway), then turns them on.
- At checkout the shopper picks a method, sees the account details on the order page, pays, and sends a reference and/or screenshot.
- The store admin opens **Verify payments**, checks the money arrived, and presses Approve (order becomes paid, customer is emailed) or Reject with a reason (customer can resend).
- Orders nobody pays within 48 hours are cancelled automatically and the stock is released. Screenshots are private, never public files.

**Stores pay the platform** (Super Admin -> Payments):
- The Super Admin enters the platform bank / wallet accounts under **My payment accounts**.
- A store opens **Plan & usage**, picks a package, sees those accounts, pays, and sends proof.
- The Super Admin reviews the proof under **Payment requests** and approves: the package is active for 30 days (or 1 year) and renewals extend it.
- When the period ends plus 3 days of grace, the store moves to the Free package by itself (nothing is deleted). Owners see a renewal banner in the last 7 days.

## Put it online

Step by step, all free (GitHub, two Vercel projects, MongoDB Atlas): see **DEPLOY.md**.

## Not built yet

- Multi-currency and multi-language storefronts, a drag-and-drop page builder, live carrier rates, SMS.
- SSO, a public REST API with API keys, staged rollouts, dedicated database per Enterprise tenant, status page.
- A background job queue (jobs run inside the backend process), file storage on Blob/Cloudinary, Redis-based rate limits.
- Storefront pages render in the browser, so search-engine ranking is weaker than with server rendering.
- AI builder generates configuration only (never code); without an API key it uses a keyword generator.
