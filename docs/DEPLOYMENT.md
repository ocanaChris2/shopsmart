# Deployment Guide — ShopSmart Universal ERP
## Cloudflare → Render → Supabase (All Free Tiers)

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       PRODUCTION ARCHITECTURE                              │
│                                                                            │
│  Browser / Mobile App                                                      │
│       │ HTTPS                                                              │
│       ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                  CLOUDFLARE EDGE (Free Tier)                         │  │
│  │   TLS Termination · WAF · DDoS · Cache · HSTS · Transform Rules     │  │
│  │                                                                      │  │
│  │  app.yourdomain.com ────────────────→  Render Static Site           │  │
│  │  api.yourdomain.com ────────────────→  Render Web Service           │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                              │ HTTPS (Full Strict)                         │
│                              ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │              RENDER WEB SERVICE (Free Tier, 512 MB)                  │  │
│  │                                                                      │  │
│  │  ┌───────────────────────┐     ┌──────────────────────────────┐    │  │
│  │  │   PM2 Process 1       │     │   PM2 Process 2               │    │  │
│  │  │   Fastify REST API    │     │   pg-boss Background Worker   │    │  │
│  │  │   Port :3000          │     │   (no inbound port)           │    │  │
│  │  │   Memory ≤ 210 MB     │     │   Memory ≤ 180 MB             │    │  │
│  │  └───────────────────────┘     └──────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                              │                                             │
│              ┌───────────────┴──────────────────────────┐                 │
│              │  Supabase SESSION POOLER  (IPv4, port 6543)│                │
│              │  aws-0-[region].pooler.supabase.com        │                │
│              │  SSL=required · max 11 connections total   │                │
│              └──────────────────────────────────────────-┘                │
│                              │                                             │
│                              ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                 SUPABASE POSTGRESQL (Free Tier, 500 MB)              │  │
│  │                                                                      │  │
│  │  pgboss.* · public.* · meta.* · core.* · fin.* · audit.*           │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  EXTERNAL                                                                  │
│  cron-job.org ─── every 10 min ──→ api.yourdomain.com/health/keep-alive  │
│                                     (keeps Render warm + Supabase un-paused)│
└────────────────────────────────────────────────────────────────────────────┘
```

### Critical Routing Rule: IPv4 and the Session Pooler

| Connection Type | URL | Port | IPv4? | Use for |
|---|---|---|---|---|
| **Direct** | `db.[ref].supabase.co` | 5432 | **No (IPv6)** | Local dev, GitHub Actions migrations |
| **Session Pooler** | `aws-0-[region].pooler.supabase.com` | **6543** | **Yes** | Render API + Worker (production) |
| Transaction Pooler | `aws-0-[region].pooler.supabase.com` | 5432 | Yes | NOT used — breaks `LISTEN/NOTIFY` |

**Rule:** `DATABASE_URL` in Render **always** points to the Session Pooler (port 6543). The Direct Connection URL is never stored in Render.

---

## Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| `node` ≥ 20 | Runtime | [nodejs.org](https://nodejs.org) |
| `psql` client | DB migrations | `brew install postgresql` |
| `git` | Version control | Pre-installed |
| Supabase account | Database | [supabase.com](https://supabase.com) |
| Render account | Hosting | [render.com](https://render.com) |
| Cloudflare account | DNS/CDN/WAF | [cloudflare.com](https://cloudflare.com) |
| cron-job.org account | Keep-alive cron | [cron-job.org](https://cron-job.org) |
| GitHub account | CI/CD (migrations) | [github.com](https://github.com) |

---

## Step 1 — Supabase Project Setup

### 1.1 Create Project

1. Log in to [app.supabase.com](https://app.supabase.com)
2. **New Project** → choose org → name it `shopsmart` → set a strong DB password → **Create project**
3. Wait ~2 min for provisioning

### 1.2 Collect Connection Strings

Navigate to **Project Settings → Database → Connection string**.

```
Direct Connection (for migrations only):
  postgresql://postgres.[PROJECT_REF]:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres

Session Pooler (for Render — IPv4 compatible):
  postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

Save both securely. You will need them in later steps.

### 1.3 Run the Initial Schema Migration

Because Render cannot reach the Direct Connection (port 5432), run this **from your local machine**:

```bash
# Set your direct connection URL
export DIRECT_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"

# Verify connection
psql "$DIRECT_URL" -c "SELECT current_database(), now();"

# Apply schema (init.sql is idempotent only on first run — see note below)
psql "$DIRECT_URL" -f db/init.sql

# Verify tables were created
psql "$DIRECT_URL" -c "\dt meta.*" -c "\dt core.*" -c "\dt fin.*" -c "\dt audit.*"
```

> **Note:** `db/init.sql` is written for a **fresh database**. If the database already has tables, you will see errors on the `CREATE TABLE` statements. For incremental schema changes, create numbered migration files in `db/migrations/` and apply them one at a time.

### 1.4 Install AI Agent Skills for Supabase (Developer Experience)

From the project root, add Supabase-specific coding instructions so that AI tools (Cursor, Copilot, Claude Code) understand the Supabase platform:

```bash
npx skills add supabase/agent-skills
```

This installs ready-made agent prompts that teach AI coding assistants about Supabase Row Level Security, connection pooling, Edge Functions, and Supabase-specific SQL patterns. It makes AI pair-programming with Supabase dramatically more accurate.

---

## Step 2 — Local Development Setup

### 2.1 Clone and Install

```bash
git clone https://github.com/your-org/shopsmart-erp.git
cd shopsmart-erp

# Install root dependencies (includes pm2)
npm install

# Install all service dependencies
cd api    && npm install && cd ..
cd worker && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2.2 Configure Environment Variables

```bash
# API service
cp api/.env.example api/.env

# Worker service
cp worker/.env.example worker/.env

# Frontend
cp frontend/.env.example frontend/.env.local
```

Edit `api/.env`:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
JWT_SECRET=<openssl rand -hex 32>
JWT_EXPIRES_IN=24h
DB_POOL_MAX=3
LOG_LEVEL=debug
```

Edit `frontend/.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:3000
```

### 2.3 Run Locally

```bash
# Terminal 1: API
npm run dev:api

# Terminal 2: Worker
npm run dev:worker

# Terminal 3: Frontend
cd frontend && npm run dev
```

---

## Step 3 — GitHub Repository & CI Setup

### 3.1 Add Secrets

Go to **GitHub → Your Repo → Settings → Secrets and Variables → Actions → New repository secret**:

| Secret Name | Value |
|---|---|
| `SUPABASE_DIRECT_URL` | The full Direct Connection URL (port 5432) |

This secret is used **only** by the `migrate.yml` GitHub Actions workflow. It is never stored in Render.

### 3.2 Verify Migration Workflow

```bash
git add db/init.sql
git commit -m "add: initial database schema"
git push origin main
```

Watch **GitHub → Actions → Database Migration** to confirm the schema applies successfully.

---

## Step 4 — Render Deployment

### 4.1 Deploy via Blueprint

1. **Render Dashboard → Blueprints → New Blueprint Instance**
2. Connect your GitHub repository
3. Render detects `render.yaml` automatically
4. Click **Apply** — Render will prompt for the `sync: false` environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Session Pooler URL (port **6543**) |
| `JWT_SECRET` | Same value as local, or generate new |
| `CF_ZONE_ID` | Cloudflare Zone ID (from Step 5) |
| `CF_API_TOKEN` | Cloudflare Cache Purge token (from Step 5) |
| `API_BASE_URL` | `https://api.yourdomain.com` |
| `VITE_API_BASE_URL` | `https://api.yourdomain.com` |

> **Double-check**: `DATABASE_URL` must use port **6543** (Session Pooler). Port 5432 will fail with a connection timeout on Render's free tier.

### 4.2 Verify Deployment

```bash
# Health check (no DB query — fast, used by Render's probe)
curl https://shopsmart-app-worker.onrender.com/health

# DB keep-alive (queries Supabase — proves end-to-end connectivity)
curl https://shopsmart-app-worker.onrender.com/health/keep-alive
```

Expected response for `/health/keep-alive`:
```json
{
  "status": "ok",
  "db": "connected",
  "latencyMs": 45,
  "ts": "2025-01-01T00:00:00.000Z"
}
```

---

## Step 5 — Cloudflare DNS & Security

### 5.1 Add Domain to Cloudflare

1. **Cloudflare Dashboard → Add a Site** → enter your domain → Free plan
2. Update nameservers at your registrar to Cloudflare's provided nameservers
3. Wait up to 60 minutes for propagation

### 5.2 DNS Records

| Type | Name | Target | Proxied |
|---|---|---|---|
| CNAME | `api` | `shopsmart-app-worker.onrender.com` | **Yes (orange)** |
| CNAME | `app` | `shopsmart-frontend.onrender.com` | **Yes (orange)** |

### 5.3 SSL/TLS Configuration

```
SSL/TLS → Overview → Full (strict)
SSL/TLS → Edge Certificates → Always Use HTTPS: ON
SSL/TLS → Edge Certificates → HSTS: max-age=15768000, includeSubDomains, preload
SSL/TLS → Edge Certificates → Minimum TLS: 1.2
```

### 5.4 Add Custom Domains on Render

For each Render service, add the custom domain:
- **API service** → Settings → Custom Domains → `api.yourdomain.com`
- **Static site** → Settings → Custom Domains → `app.yourdomain.com`

### 5.5 Configure WAF, Cache Rules, and Transform Rules

Follow `cloudflare/EDGE_SECURITY_SETUP.md` for the complete Cloudflare configuration guide.

---

## Step 6 — Keep-Alive Cron Job

Configure two cron jobs at [cron-job.org](https://cron-job.org) (free):

### Job 1 — Keep Render Web Service Warm

| Setting | Value |
|---|---|
| URL | `https://api.yourdomain.com/health/keep-alive` |
| Method | GET |
| Schedule | Every **10 minutes** |
| Timeout | 30 seconds |
| Expected status | 200 |

### Job 2 — Keep Supabase DB Un-paused

| Setting | Value |
|---|---|
| URL | `https://api.yourdomain.com/health/keep-alive` |
| Method | GET |
| Schedule | Every **5 days** (120 hours) |

> **Why 5 days?** Supabase pauses after 7 days of inactivity. Pinging every 5 days gives a 2-day buffer against cron delays or Render cold-start failures.

The `/health/keep-alive` route executes `SELECT 1` against the Supabase database. This single query is sufficient to reset the 7-day pause timer.

---

## Step 7 — Post-Deployment Verification

Run this checklist after every deployment:

```bash
# 1. Render health probe endpoint
curl -s https://api.yourdomain.com/health | jq .

# 2. DB keep-alive (end-to-end Supabase connectivity)
curl -s https://api.yourdomain.com/health/keep-alive | jq .

# 3. Auth flow
curl -s -X POST https://api.yourdomain.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"wrong"}' | jq .
# Expected: 401 Unauthorized

# 4. Protected route without token
curl -s https://api.yourdomain.com/api/v1/data/test | jq .
# Expected: 401 Unauthorized

# 5. TLS and security headers
curl -sI https://api.yourdomain.com/health | grep -E "strict-transport|x-content-type|cf-ray"
# Expected: HSTS present, cf-ray present (proves Cloudflare is routing)

# 6. Frontend loads
curl -s -o /dev/null -w "%{http_code}" https://app.yourdomain.com
# Expected: 200
```

---

## Environment Variables Reference

### Render Web Service (`shopsmart-app-worker`)

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `production` |
| `DATABASE_URL` | **Yes** | **Session Pooler URL — port 6543 — NEVER port 5432** |
| `JWT_SECRET` | Yes | Min 32-char random string (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | Yes | Token expiry (`24h`) |
| `DB_POOL_MAX` | Yes | `5` (API pool; Worker uses separate env) |
| `LOG_LEVEL` | Yes | `info` |
| `RATE_LIMIT_MAX` | Yes | `100` |
| `RATE_LIMIT_WINDOW_MS` | Yes | `60000` |
| `AUTH_RATE_LIMIT_MAX` | Yes | `10` |
| `CF_ZONE_ID` | Optional | Cloudflare zone ID for cache purge |
| `CF_API_TOKEN` | Optional | Cloudflare Cache Purge API token |
| `API_BASE_URL` | Optional | `https://api.yourdomain.com` |
| `STORAGE_BASE_URL` | Optional | Base URL for exported files |
| `JOB_POLL_INTERVAL_SECONDS` | Yes | `5` |

### Render Static Site (`shopsmart-frontend`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | `https://api.yourdomain.com` |
| `VITE_APP_NAME` | No | `ShopSmart ERP` |

### Local Development Only (never in Render)

| Variable | Where | Description |
|---|---|---|
| `DIRECT_URL` | Local `.env` / GH Secrets | Direct Connection URL (port 5432) for migrations |

### GitHub Actions Secrets

| Secret | Description |
|---|---|
| `SUPABASE_DIRECT_URL` | Direct connection URL for schema migrations |

---

## Supabase Free Tier Constraints

| Constraint | Limit | Our Mitigation |
|---|---|---|
| Storage | 500 MB | JSONB compression; no file storage in DB |
| Connections (via pooler) | 60 total server connections | API pool ≤ 5, Worker pool ≤ 3, pg-boss ≤ 3 → **11 total** |
| DB inactivity pause | 7 days | cron-job.org pings `/health/keep-alive` every 5 days |
| CPU | Shared | Heavy queries use the Worker (background), not the API |
| Egress | 2 GB/month | Most reads served from Cloudflare edge cache |

---

## Render Free Tier Constraints

| Constraint | Limit | Our Mitigation |
|---|---|---|
| RAM | 512 MB | PM2 memory budgeting (API ≤ 210 MB, Worker ≤ 180 MB) |
| Web Service spin-down | 15 min inactivity | cron-job.org pings `/health/keep-alive` every 10 min |
| Services | 1 Web Service, 1 Static Site | PM2 runs API + Worker in one service |
| Build time | 400 min/month | `npm ci` caching; `dist/` committed if needed |

---

## Troubleshooting

### "Connection refused" / "ETIMEDOUT" from Render to Supabase

- **Cause:** `DATABASE_URL` points to port 5432 (Direct Connection) or uses the wrong host.
- **Fix:** Verify `DATABASE_URL` uses port **6543** and host `aws-0-[region].pooler.supabase.com`.

```bash
# Extract host and port from DATABASE_URL to verify
node -e "const u = new URL(process.env.DATABASE_URL); console.log(u.host);"
# Expected output: aws-0-us-east-1.pooler.supabase.com:6543
```

### Supabase returns "Project is paused"

- **Cause:** No query reached the database in the past 7 days.
- **Fix:** Visit [app.supabase.com](https://app.supabase.com) → **Restore project** (takes ~30 s). Then verify the keep-alive cron is running correctly.
- **Prevention:** Ensure the cron-job.org job is active and the Render service is not also sleeping (check `/health` first).

### `SET LOCAL` not working / RLS not filtering

- **Cause:** Using `SET` or `SET SESSION` instead of `SET LOCAL`, OR the query runs outside the transaction.
- **Verify:** All data queries must run AFTER `BEGIN` and `SET LOCAL` in the same client connection. Check `rlsTransaction.ts` to confirm the lifecycle.
- **Diagnose:**
  ```sql
  -- Run this in a transaction to verify RLS is active
  BEGIN;
  SET LOCAL app.current_tenant_id = 'xxxxxxxx-0000-0000-0000-000000000001';
  SELECT current_setting('app.current_tenant_id');
  ROLLBACK;
  ```

### pg-boss "No LISTEN support" or worker not picking up jobs

- **Cause:** Connecting via Transaction Pooler (port 5432) instead of Session Pooler (port 6543).
- **Fix:** `DATABASE_URL` in the Worker service must use port **6543**.

### PM2 process restarting in a loop (memory)

- **Cause:** One of the processes is exceeding its `max_memory_restart` threshold.
- **Diagnose:** Check Render logs for `PM2 | [App] App has exceeded...` messages.
- **Fix:** Reduce `DB_POOL_MAX`, or look for memory leaks in request handlers. Consider adding `--max-old-space-size=200` to Node.js via `NODE_OPTIONS` env var.

### GitHub Actions migration fails with "role does not exist"

- **Cause:** The `SUPABASE_DIRECT_URL` secret uses the wrong format or the database user needs privileges.
- **Fix:** Ensure the URL uses `postgres` as the username (Supabase's superuser). Verify the password has no special characters that need URL-encoding.
