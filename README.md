# RecipeHub API

Express API for RecipeHub. The API serves a plain-text `Hello World!` response
at `/`, reports MongoDB readiness at `/health`, and exposes recipe, account,
dashboard, moderation, and Stripe Checkout routes under `/api`.

## Local setup

Run these commands from the backend folder:

```powershell
npm ci
Copy-Item .env.example .env
```

Fill in `.env` before starting the API:

- `MONGODB_URI`: MongoDB Atlas connection string using a **Database Access**
  user, not the Atlas website login.
- `DB_NAME`: database name (defaults to `assignment-10`).
- `JWT_SECRET`: a private secret with at least 32 characters. It must match the
  frontend server's `JWT_SECRET`.
- `CLIENT_ORIGIN`: frontend origin (defaults to `http://localhost:3000`).
- `STRIPE_SECRET_KEY`: optional until Stripe Checkout is used; keep it only in
  this backend `.env`.

Allow the development machine's IP under Atlas Network Access. If the database
user password contains URI-reserved characters, percent-encode them in the
connection string. Never use `NEXT_PUBLIC_` for the MongoDB URI, JWT secret,
Google client secret, or Stripe secret key.

## Run

```powershell
npm run dev
```

For production:

```powershell
npm ci --omit=dev
npm start
```

`npm run check` validates the entry point's JavaScript syntax. The API starts
even if MongoDB is unavailable and retries its connection with backoff. In
that state `/` still responds with `Hello World!`, `/health` responds with
HTTP 503 and a database status, and `/api/*` requests respond with HTTP 503.
Once MongoDB is reachable with valid credentials, the API seeds sample
recipes and marks `/health` as ready.

An Atlas `bad auth` / code 8000 response means the server is reachable but
rejects the database-user credentials. Reset or verify that database user in
Atlas Database Access, update `MONGODB_URI` in both private environment files,
and allow the client IP. Restarting Node cannot repair invalid Atlas
credentials.
