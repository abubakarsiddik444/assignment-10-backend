# RecipeHub Backend

RecipeHub's backend is a Node.js and Express API. It stores users, recipes,
favorites, reports, and payments in MongoDB. The Next.js frontend calls it
through a same-origin API proxy.

## What the API does

- Registers and authenticates users; verifies JWTs and checks admin permissions.
- Reads and updates profile details.
- Lists, searches, filters, and paginates published recipes.
- Lets signed-in users submit recipes, manage their own recipes, like, favorite,
  and report published recipes.
- Keeps regular-user submissions pending until an admin approves them.
- Enforces the free account limit of three non-deleted recipes; Premium
  accounts have no submission limit.
- Provides user dashboard totals, saved recipes, and purchased recipe history.
- Creates and verifies Stripe Checkout payments for Premium membership and
  individual recipes.
- Provides admin totals, user role and block controls, recipe moderation,
  featured recipes, report review, and transaction history.
- Seeds sample recipes and an optional first admin when MongoDB connects.

## Requirements

- Node.js 20 or newer
- MongoDB (Atlas or local)
- A Stripe secret key for checkout and payment features

## Start the API

Configure the backend's private environment and MongoDB connection, then run
these commands from the backend folder:

```powershell
npm ci
npm run dev
```

The API listens on `http://localhost:5000` by default. For production:

```powershell
npm ci --omit=dev
npm start
```

Run the syntax check from this folder:

```powershell
npm run check
```

## API guide

All routes below are served by this backend. Authenticated requests from the
frontend are proxied with a short-lived JWT.

| Area | Routes | Purpose |
|---|---|---|
| Status | `GET /`, `GET /health` | Basic response and MongoDB readiness |
| Accounts | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/users/me` | Sign-in, session lookup, and profile updates |
| Recipes | `GET /api/recipes`, `GET /api/recipes/:id`, `GET /api/recipes/my`, `POST /api/recipes`, `PATCH /api/recipes/:id`, `DELETE /api/recipes/:id` | Public browsing and owner recipe management |
| Recipe actions | `GET/POST /api/recipes/:id/like`, `GET/POST/PUT/DELETE /api/recipes/:id/favorite`, `POST /api/recipes/:id/report` | Likes, saved recipes, and reports |
| User dashboard | `GET /api/dashboard/overview`, `GET /api/favorites`, `GET /api/payments/my-recipes` | Account totals, favorites, and purchased recipes |
| Payments | `POST /api/payments/create-checkout-session`, `POST /api/payments/confirm` | Start Checkout and verify payment with Stripe |
| Admin | `/api/admin/overview`, `/api/admin/users`, `/api/admin/recipes`, `/api/admin/reports`, `/api/admin/transactions` | Admin summaries and review queues |
| Admin actions | `PATCH /api/admin/users/:id/role`, `PATCH /api/admin/users/:id/block`, `PATCH /api/admin/recipes/:id/status`, `PATCH /api/admin/recipes/:id/feature`, `PATCH /api/admin/reports/:id`, `DELETE /api/admin/recipes/:id` | Manage users and moderate site content |

`GET /api/recipes` accepts `page`, `limit`, `category`, `search`, `sort`, and
`featured` query parameters. Public recipe results include approved recipes
only. Admin routes require an admin account.

## Project layout

```text
index.js          Express app, API routes, authentication, and MongoDB lifecycle
data/recipes.json Starter recipe data
package.json      Start and validation scripts
```

The API code is intentionally kept in `index.js`; short section comments mark
configuration, shared helpers, route groups, and database startup.

## MongoDB availability

The API starts even when MongoDB is temporarily unavailable and retries
connecting with backoff. While disconnected:

- `GET /` remains available.
- `GET /health` returns HTTP 503 with database status.
- `/api/*` requests return HTTP 503.

Once connected, the API creates indexes and inserts seed records that are not
already present, then `/health` returns `{"status":"ok","database":"connected"}`.

If Atlas reports `bad auth` or code 8000, verify the Atlas Database Access
username and password, update `MONGODB_URI` in both private environment files,
and allow the development IP. Restarting Node cannot fix rejected credentials.
