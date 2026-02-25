# disciplr-backend

API and milestone engine for Disciplr: programmable time-locked capital vaults on Stellar.

## What it does

- `GET /api/health`: service status and timestamp
- `GET /api/vaults`: list all vaults (currently in-memory placeholder)
- `POST /api/vaults`: create a vault
- `GET /api/vaults/:id`: get a vault by id

## Tech stack

- Node.js + TypeScript
- Express
- Helmet + CORS
- PostgreSQL migrations via Knex

## Local setup

Prerequisites:

- Node.js 18+
- npm

Install and run:

```bash
npm install
npm run dev
```

API runs at `http://localhost:3000`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run with tsx watch |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled `dist/index.js` |
| `npm run lint` | Run ESLint on `src` |
| `npm run migrate:make <name>` | Create migration file in `db/migrations` |
| `npm run migrate:latest` | Apply all pending migrations |
| `npm run migrate:rollback` | Roll back the latest migration batch |
| `npm run migrate:status` | Show migration status |

## Database migrations

Migration tooling is standardized with Knex and PostgreSQL.

- Config: `knexfile.cjs`
- Baseline migration: `db/migrations/20260225190000_initial_baseline.cjs`
- Full process (authoring, rollout, rollback, CI/CD): `docs/database-migrations.md`

Required env var:

- `DATABASE_URL` (PostgreSQL connection string)

Quick start:

```bash
npm run migrate:latest
npm run migrate:status
```
