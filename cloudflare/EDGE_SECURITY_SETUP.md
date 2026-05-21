# Cloudflare Edge Security & Traffic Configuration
## ShopSmart ERP — Zero-Trust API Protection Layer

**Stack context:** Node.js/Fastify on Render Free Tier → PostgreSQL (RLS) → React/Vite static frontend.  
**Cloudflare role:** TLS termination, WAF, DDoS absorption, edge cache, security header injection.

> **Free-tier callouts** are marked with `[FREE]`. Features requiring Pro ($20/month) or higher are marked
> with `[PRO+]` or `[ENTERPRISE]`. The guide maximises the free tier where possible and gives you an honest
> upgrade path where it cannot.

---

## Table of Contents

1. [Prerequisites & Account Setup](#1-prerequisites--account-setup)
2. [DNS Configuration (Render → Cloudflare)](#2-dns-configuration)
3. [TLS / SSL Hardening](#3-tls--ssl-hardening)
4. [WAF & Bot Protection](#4-waf--bot-protection)
5. [Cache Rules](#5-cache-rules)
6. [Security Headers via Transform Rules](#6-security-headers-via-transform-rules)
7. [Rate Limiting](#7-rate-limiting)
8. [Cache Purge API Script](#8-cache-purge-api-script)
9. [Architecture Flow](#9-architecture-flow)
10. [Verification Checklist](#10-verification-checklist)
11. [Free-Tier Limits Summary](#11-free-tier-limits-summary)

---

## 1. Prerequisites & Account Setup

### What you need before starting

| Item | Where to get it |
|---|---|
| Cloudflare account (Free plan is sufficient) | cloudflare.com |
| Domain name you own (e.g. `yourdomain.com`) | Any registrar |
| Render service URL (e.g. `shopsmart-api.onrender.com`) | Render dashboard |
| Render static site URL for the frontend | Render/Netlify/Vercel dashboard |
| Cloudflare Zone ID | CF Dashboard → your domain → Overview (right sidebar) |
| Cloudflare API Token | CF Dashboard → My Profile → API Tokens |

### Create a scoped API Token for automation

```
Cloudflare Dashboard
  → My Profile (top-right avatar)
  → API Tokens
  → Create Token
  → Use template: "Edit zone DNS"
  → Modify permissions:
      Zone → Cache Purge → Purge
      Zone → Zone → Read
  → Zone Resources: Include → Specific zone → yourdomain.com
  → Save → copy token (shown once)
```

Save this as `CF_API_TOKEN` in your Render environment variables and CI/CD secrets.

---

## 2. DNS Configuration

### 2.1 Add domain to Cloudflare

```
Cloudflare Dashboard → Add a Site → enter yourdomain.com → Free plan
→ Cloudflare scans existing DNS records
→ Review imported records
→ Change nameservers at your registrar to Cloudflare's nameservers
   (shown on-screen, e.g. vera.ns.cloudflare.com + woz.ns.cloudflare.com)
→ Wait 5–60 minutes for propagation
```

### 2.2 DNS Records

Add these records. The **orange cloud icon (proxied)** routes traffic through Cloudflare.

| Type | Name | Content | Proxy | TTL | Purpose |
|---|---|---|---|---|---|
| CNAME | `api` | `shopsmart-api.onrender.com` | **Proxied (orange)** | Auto | API backend |
| CNAME | `app` | `shopsmart-frontend.onrender.com` | **Proxied (orange)** | Auto | Frontend SPA |
| CNAME | `www` | `yourdomain.com` | **Proxied (orange)** | Auto | Root redirect |

> **Why proxied (orange cloud)?** Traffic hits Cloudflare's edge first — enabling WAF, cache, TLS
> termination, and DDoS protection. **Never use grey cloud (DNS-only) for the API subdomain.**

```
Dashboard → DNS → Records → Add record
  Type: CNAME
  Name: api
  Target: shopsmart-api.onrender.com
  Proxy status: Proxied ✓
  TTL: Auto
→ Save
```

Repeat for `app` pointing to your frontend host.

### 2.3 Custom Domain on Render

```
Render Dashboard → Your Web Service → Settings → Custom Domains
→ Add Custom Domain: api.yourdomain.com
→ Render will show a CNAME value to verify — this is what you already pointed above
→ Render auto-provisions a Let's Encrypt certificate for api.yourdomain.com
```

Render's Let's Encrypt cert is required for **Full (Strict)** mode in the next section.

---

## 3. TLS / SSL Hardening

### 3.1 Encryption Mode — Full (Strict) `[FREE]`

```
Dashboard → SSL/TLS → Overview
→ Your SSL/TLS encryption mode: Full (strict)
```

| Mode | Description | Use this? |
|---|---|---|
| Off | HTTP only | Never |
| Flexible | CF↔Client encrypted, CF↔Origin HTTP | Never — exposes origin |
| Full | CF↔Origin encrypted, cert not verified | No — MITM vulnerable |
| **Full (Strict)** | CF↔Origin encrypted, cert verified | **Yes — required** |

Full (Strict) verifies Render's Let's Encrypt certificate. Without this, a compromised CDN node could intercept the CF→Render leg.

### 3.2 Always Use HTTPS + Automatic Rewrites `[FREE]`

```
Dashboard → SSL/TLS → Edge Certificates
→ Always Use HTTPS: ON
→ Automatic HTTPS Rewrites: ON
```

- **Always Use HTTPS** issues a 301 redirect for any `http://` request before it reaches your origin.
- **Automatic HTTPS Rewrites** fixes mixed-content issues in HTML responses served through Cloudflare.

### 3.3 Minimum TLS Version `[FREE]`

```
Dashboard → SSL/TLS → Edge Certificates
→ Minimum TLS Version: TLS 1.2
```

TLS 1.0 and 1.1 are broken (POODLE, BEAST). TLS 1.2 is the minimum acceptable baseline.
Enable **TLS 1.3** as well — Cloudflare will negotiate the highest version the client supports.

### 3.4 HSTS — HTTP Strict Transport Security `[FREE]`

```
Dashboard → SSL/TLS → Edge Certificates
→ HTTP Strict Transport Security (HSTS)
→ Enable HSTS: ON
→ Max Age Header: 6 months (15768000 seconds)
→ Include Subdomains: ON
→ Preload: ON
→ No-Sniff Header: ON (we'll also set it in Transform Rules)
```

> **Warning:** Once HSTS with preload is submitted to browsers' preload lists, **reverting to HTTP is
> extremely difficult**. Only enable Preload once you are certain the domain will serve HTTPS permanently.

This injects:
```
Strict-Transport-Security: max-age=15768000; includeSubDomains; preload
```

---

## 4. WAF & Bot Protection

### 4.1 Enable Free Managed WAF Ruleset `[FREE]`

```
Dashboard → Security → WAF → Managed Rules
→ Cloudflare Free Managed Ruleset: Enabled
```

The free managed ruleset includes protections against:
- SQLi (SQL Injection)
- XSS (Cross-Site Scripting)
- Directory traversal
- Remote file inclusion
- Common CVEs in web frameworks

> Cloudflare's full OWASP Core Ruleset (all categories + tunable sensitivity) requires `[PRO+]`.

### 4.2 Bot Fight Mode `[FREE]`

```
Dashboard → Security → Bots
→ Bot Fight Mode: ON
```

Bot Fight Mode automatically blocks definitively malicious bots (credential stuffers, scrapers, vulnerability scanners) based on Cloudflare's network intelligence. It does **not** challenge ambiguous traffic.

> **Super Bot Fight Mode** (blocks likely-automated traffic, allows good bots like Googlebot) requires `[PRO+]`.

### 4.3 WAF Custom Rule — Enforce API Origin `[FREE]`

This rule challenges browser-originating requests to the API that do not come from our frontend domain.  
It stops **browser-based CORS attacks** (malicious websites making credentialed requests to your API).

**How it works:** Browsers always send an `Origin` header on cross-origin requests. Requests from our
own frontend have `Origin: https://app.yourdomain.com`. A request from a malicious site has a different
`Origin`. Server-to-server requests (curl, Postman, mobile apps) typically send **no** `Origin` header,
so they pass through unaffected.

```
Dashboard → Security → WAF → Custom Rules → Create Rule
```

**Rule name:** `API — Block Unknown Browser Origins`

**Expression (paste into "Edit expression"):**

```
(http.request.uri.path wildcard "/api/v1/*")
and (http.request.headers["origin"] ne "")
and not (
  http.request.headers["origin"] eq "https://app.yourdomain.com"
  or http.request.headers["origin"] eq "https://yourdomain.com"
  or http.request.headers["origin"] eq "https://www.yourdomain.com"
)
```

**Action:** `Managed Challenge`

> Use `Managed Challenge` rather than `Block` so legitimate users on unusual networks can still pass.
> Use `Block` if you want zero tolerance (returns HTTP 403).

**What this does NOT protect against:** Server-side scripts sending requests without an `Origin` header
(e.g., `curl`, automated scripts). Those must be stopped by the JWT validation layer in the API itself.

---

## 5. Cache Rules

Cache Rules replace the legacy Page Rules system. Free tier allows **up to 10 Cache Rules**.

```
Dashboard → Caching → Cache Rules → Create Rule
```

### Rule 1 — Bypass Cache for Dynamic Data `[FREE]`

**Rule name:** `Dynamic API — Bypass Cache`

**Order:** 1 (evaluated first)

**Expression:**

```
(http.request.uri.path wildcard "/api/v1/data/*")
or (http.request.uri.path wildcard "/api/v1/fin/*")
or (http.request.uri.path wildcard "/api/v1/auth/*")
```

**Cache settings:**

| Setting | Value |
|---|---|
| Cache Status | **Bypass** |
| Edge Cache TTL | (N/A — bypassed) |
| Browser Cache TTL | **No override** |

**Why:** Financial ledger entries and user data change on every request. Stale reads would be a security
and correctness disaster. Authentication tokens must never be cached.

---

### Rule 2 — Cache Metadata Aggressively `[FREE]`

**Rule name:** `Metadata Schema — Edge Cache 4h`

**Order:** 2

**Expression:**

```
http.request.uri.path wildcard "/api/v1/meta/*"
```

**Cache settings:**

| Setting | Value | Rationale |
|---|---|---|
| Cache Status | **Cache Everything** | Override CF's default (which skips HTML/JSON) |
| Edge Cache TTL | **4 hours (14400s)** | Metadata changes only on admin schema updates |
| Browser Cache TTL | **1 hour (3600s)** | Clients revalidate hourly; edge always has latest |
| Respect Origin headers | **Off** | Fastify sends no-store by default; we override at edge |
| Cache Key — Include headers | `Accept-Encoding` | Serve correct encoding per client |

**Why this matters for the Render Free Tier:**  
Render spins down the Node.js service after 15 minutes of inactivity. Metadata definitions (`meta.entities`,
`meta.fields`) are the heaviest read workload — every page load of the React frontend fetches them to
build dynamic forms. With a 4-hour edge cache, **the Render service can sleep indefinitely while Cloudflare
serves all schema requests from the edge at sub-10ms latency**. The service only wakes for actual data
mutations, login, and financial operations.

---

### Rule 3 — Cache the Health Endpoint `[FREE]`

**Rule name:** `Health Check — Short Cache`

**Order:** 3

**Expression:**

```
http.request.uri.path eq "/health"
```

**Cache settings:**

| Setting | Value |
|---|---|
| Cache Status | **Cache Everything** |
| Edge Cache TTL | **30 seconds** |
| Browser Cache TTL | **No override** |

External uptime monitors that ping `/health` every 30s would wake the Render service constantly.
Caching the health response for 30 seconds prevents unnecessary spin-ups while still detecting outages
within a minute.

---

## 6. Security Headers via Transform Rules

Injecting security headers at the Cloudflare edge offloads this from Node.js and ensures headers are present
on **every response** including cached ones (Fastify only sets headers on live responses).

```
Dashboard → Rules → Transform Rules → Modify Response Header → Create Rule
```

### Rule: Inject Security Headers `[FREE]`

**Rule name:** `API — Security Response Headers`

**Expression (apply to all API responses):**

```
http.host eq "api.yourdomain.com"
```

**Header modifications:**

| Operation | Header Name | Value |
|---|---|---|
| **Set** | `X-Content-Type-Options` | `nosniff` |
| **Set** | `X-Frame-Options` | `DENY` |
| **Set** | `Referrer-Policy` | `strict-origin-when-cross-origin` |
| **Set** | `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` |
| **Set** | `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` |
| **Set** | `Cross-Origin-Resource-Policy` | `cross-origin` |
| **Remove** | `Server` | *(leave value empty — CF removes the header)* |
| **Remove** | `X-Powered-By` | *(leave value empty)* |

**How to add in the dashboard:**

```
Under "Modify Response Header":
→ Click "Add modification" for each row above
→ Select "Set" or "Remove" from the Operation dropdown
→ Enter Header Name (exact, case-sensitive)
→ Enter Value (empty string for Remove operations)
→ Save and Deploy
```

**What each header does:**

| Header | Attack it prevents |
|---|---|
| `X-Content-Type-Options: nosniff` | MIME sniffing attacks — browser must use declared content-type |
| `X-Frame-Options: DENY` | Clickjacking — page cannot be embedded in iframes |
| `Referrer-Policy` | Leaking sensitive URL paths to third-party domains via Referer header |
| `Content-Security-Policy` | XSS, data injection — `none` is correct for a pure JSON API |
| `Permissions-Policy` | Prevents API responses enabling browser feature abuse |
| `Cross-Origin-Resource-Policy` | Prevents cross-origin reads of API responses from attacker pages |
| Remove `Server` | Obscures Fastify/Node.js version from fingerprinting scanners |
| Remove `X-Powered-By` | Same — Fastify sets this by default |

---

## 7. Rate Limiting

### Honest Free-Tier Assessment

Cloudflare's **Advanced Rate Limiting** (configurable thresholds, per-endpoint, per-IP) is a `[PRO+]`
feature at $20/month. The free tier does not have programmable rate limiting.

**Free-tier mitigation stack (defence in depth):**

| Layer | Tool | What it stops |
|---|---|---|
| Edge (L3/L4) | Cloudflare automatic DDoS | Volumetric floods, SYN floods |
| Edge (L7) | Bot Fight Mode | Credential stuffing bots, scrapers |
| Edge (L7) | WAF Managed Rules | SQLi/XSS payload attacks |
| API server | `@fastify/rate-limit` (in-memory) | Brute force per IP (100 req/min global, 10/min on `/auth/login`) |
| API server | Account lockout (5 failures → 15 min lock) | Password guessing even under rate limit |
| DB layer | RLS + bcrypt constant-time compare | Even if rate limiting is bypassed |

### Option A — WAF Managed Challenge Rule (Free) `[FREE]`

This challenges requests to `/auth/login` that Cloudflare's threat intelligence has already flagged.
It does not impose a strict numeric threshold but catches known bad actors.

```
Dashboard → Security → WAF → Custom Rules → Create Rule
```

**Rule name:** `Auth Login — Challenge Suspicious IPs`

**Expression:**

```
(http.request.uri.path eq "/api/v1/auth/login")
and (cf.threat_score gt 10)
```

**Action:** `Managed Challenge`

> `cf.threat_score` is Cloudflare's 0–100 reputation score for the source IP based on their global
> threat feed. Score > 10 means the IP has been seen in malicious activity.

---

### Option B — Advanced Rate Limiting `[PRO+]`

If you upgrade to the Pro plan, use the dedicated Rate Limiting product:

```
Dashboard → Security → WAF → Rate Limiting Rules → Create Rule
```

**Rule name:** `Auth Login — Hard Rate Limit`

**Expression:**

```
http.request.uri.path eq "/api/v1/auth/login"
```

**Rate characteristics:**

| Setting | Value |
|---|---|
| Requests | 10 |
| Period | 10 seconds |
| Counting expression | (same as rule expression) |
| Characteristics | IP address |
| Action | Block (HTTP 429) |
| Duration | 1 minute |
| Response | JSON: `{"error":{"statusCode":429,"message":"Too many login attempts","code":"RATE_LIMITED"}}` |

> This is significantly more effective than the WAF Custom Rule approach. At $20/month, the Pro plan
> pays for itself in reduced credential stuffing damage.

---

## 8. Cache Purge API Script

### When to purge

Purge the `/api/v1/meta/*` cache whenever:
- An admin creates, updates, or deletes a `meta.entity`
- An admin creates, updates, or deletes a `meta.field`
- A system deployment changes the platform's entity definitions

### Cloudflare Cache Purge API

Cloudflare provides a REST API for cache invalidation. The correct endpoint for each plan tier:

| Plan | Method | Free? |
|---|---|---|
| Purge by specific URL | `files: ["url1", "url2"]` | **Free** |
| Purge everything | `purge_everything: true` | **Free** |
| Purge by prefix | `prefixes: ["api.yourdomain.com/api/v1/meta/"]` | **Pro+** |
| Purge by cache tag | `tags: ["meta-cache"]` | **Enterprise** |

### How to find your Zone ID

```
Cloudflare Dashboard → your domain → Overview
→ Right sidebar → Zone ID (32-char hex string)
```

### Script: `cloudflare/scripts/purge-meta-cache.sh`

See the companion script file for the full implementation. The API call structures are:

```bash
# Free tier: purge specific known URLs
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "files": [
      "https://api.yourdomain.com/api/v1/meta/entities",
      "https://api.yourdomain.com/api/v1/meta/entities/vehicle",
      "https://api.yourdomain.com/api/v1/meta/entities/patient"
    ]
  }'

# Pro+ tier: purge by prefix (invalidates ALL /api/v1/meta/* in one call)
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "prefixes": ["api.yourdomain.com/api/v1/meta/"]
  }'
```

### Triggering purge from the Fastify API

Add this to your metadata update service (fires after any `meta.entities` or `meta.fields` mutation):

```typescript
// api/src/services/cachePurge.ts

const CF_ZONE_ID   = process.env.CF_ZONE_ID   ?? '';
const CF_API_TOKEN = process.env.CF_API_TOKEN  ?? '';
const API_BASE_URL = process.env.API_BASE_URL  ?? 'https://api.yourdomain.com';

export async function purgeMetaCache(entitySlug?: string): Promise<void> {
  if (!CF_ZONE_ID || !CF_API_TOKEN) return; // skip in local dev

  const urlsToPurge = entitySlug
    ? [
        `${API_BASE_URL}/api/v1/meta/entities`,
        `${API_BASE_URL}/api/v1/meta/entities/${entitySlug}`,
        `${API_BASE_URL}/api/v1/meta/fields/${entitySlug}`,
      ]
    : [`${API_BASE_URL}/api/v1/meta/entities`]; // broad purge

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ files: urlsToPurge }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare cache purge failed: ${body}`);
  }
}
```

---

## 9. Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REQUEST LIFECYCLE                                  │
└─────────────────────────────────────────────────────────────────────────────┘

 CLIENT (Browser / Mobile App)
       │
       │  HTTPS GET https://api.yourdomain.com/api/v1/meta/entities
       │
       ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │               CLOUDFLARE EDGE  (PoP nearest to client)          │
 │                                                                 │
 │  ① TLS TERMINATION                                             │
 │     Cloudflare presents its own cert to the client.            │
 │     HSTS header forces future requests to HTTPS.               │
 │                                                                 │
 │  ② DDoS ABSORPTION (always-on, L3/L4/L7)                      │
 │     Volumetric floods absorbed before reaching WAF.            │
 │                                                                 │
 │  ③ BOT FIGHT MODE                                              │
 │     Known malicious bots → blocked or JS challenge.            │
 │                                                                 │
 │  ④ WAF MANAGED RULES                                           │
 │     SQLi, XSS, directory traversal, common CVEs → blocked.    │
 │                                                                 │
 │  ⑤ WAF CUSTOM RULES (evaluated top to bottom)                  │
 │     Rule A: Unknown Origin on /api/v1/* → Managed Challenge.  │
 │     Rule B: High threat score on /auth/login → Challenge.     │
 │                                                                 │
 │  ⑥ CACHE EVALUATION                                            │
 │     Path: /api/v1/meta/*                                       │
 │     ┌─────────────────────────────────────────────────────┐   │
 │     │  CACHE HIT? ────────────────────────────────────┐   │   │
 │     │  (within 4-hour Edge TTL)                       │   │   │
 │     │                                            YES  │   │   │
 │     │         ┌──────────────────────────────────────►│   │   │
 │     │         │  Serve from edge — 0 origin hits      │   │   │
 │     │         │  Latency: ~5ms                        │   │   │
 │     │  NO ────┘                                       │   │   │
 │     │  Forward to origin (step ⑦)                    │   │   │
 │     └─────────────────────────────────────────────────┘   │   │
 │                                                             │   │
 │     Path: /api/v1/data/* or /fin/* or /auth/*              │   │
 │     → BYPASS — always forwarded to origin.                 │   │
 │                                                                 │
 │  ⑦ ORIGIN REQUEST (only on cache miss or bypass)               │
 │     CF opens a mTLS connection to Render using Render's cert.  │
 │     Full (Strict) verifies the cert — no MITM possible.        │
 │                                                                 │
 │  ⑧ RESPONSE PROCESSING                                         │
 │     Transform Rule injects security headers on every response: │
 │     X-Content-Type-Options, X-Frame-Options, CSP, etc.        │
 │     Removes: Server, X-Powered-By.                            │
 │     If cacheable: stores response in edge cache for 4h.       │
 │                                                                 │
 │     Response → Client                                          │
 └─────────────────────────────────────────────────────────────────┘
       │                           │ (cache miss only)
       │                           ▼
       │                 ┌─────────────────────┐
       │                 │   RENDER ORIGIN      │
       │                 │   (Free Tier)        │
       │                 │                     │
       │                 │  Node.js / Fastify  │
       │                 │  ├ JWT verification │
       │                 │  ├ RLS transaction  │
       │                 │  │  SET LOCAL       │
       │                 │  │  tenant_id       │
       │                 │  └ Route handler   │
       │                 │         │          │
       │                 │         ▼          │
       │                 │   PostgreSQL (RLS) │
       │                 └─────────────────────┘
       │
       ▼
 CLIENT receives response with security headers.
 Browser caches /meta/* for 1 hour (Browser Cache TTL).
```

### The Free-Tier Efficiency Story

```
WITHOUT Cloudflare edge cache:
  Every page load → 1 Render wake-up → 1 DB query for meta.entities + meta.fields
  If Render is asleep: +3 second cold start penalty per user
  Database: N queries/minute (one per user page load)

WITH Cloudflare edge cache (4h TTL):
  First request in 4h window → wakes Render → fetches from DB → stored at CF edge
  ALL subsequent requests in 4h window → served from CF edge in ~5ms
  Render stays asleep unless someone is actively mutating data or authenticating
  Database: ~6 meta queries per 24 hours regardless of user count
```

This is the single most impactful optimisation for the Render free tier.

---

## 10. Verification Checklist

Run these after completing setup:

### TLS & Headers

```bash
# Check TLS version and certificate
curl -vI https://api.yourdomain.com/health 2>&1 | grep -E "TLS|SSL|subject|issuer|Server:|strict"

# Check all security headers are present
curl -sI https://api.yourdomain.com/health | grep -E \
  "strict-transport|x-content-type|x-frame|referrer-policy|content-security|permissions-policy"

# Confirm Server and X-Powered-By are removed
curl -sI https://api.yourdomain.com/health | grep -iE "^server:|^x-powered-by:"
# Expected: no output (headers removed by Transform Rule)
```

### Cache Behaviour

```bash
# First request — should be CF-Cache-Status: MISS
curl -sI "https://api.yourdomain.com/api/v1/meta/entities" | grep -i "cf-cache-status"
# Expected: CF-Cache-Status: MISS

# Second request — should be HIT
curl -sI "https://api.yourdomain.com/api/v1/meta/entities" | grep -i "cf-cache-status"
# Expected: CF-Cache-Status: HIT

# Dynamic data should always BYPASS
curl -sI -H "Authorization: Bearer <token>" \
  "https://api.yourdomain.com/api/v1/data/vehicle" | grep -i "cf-cache-status"
# Expected: CF-Cache-Status: BYPASS
```

### WAF Origin Enforcement

```bash
# Request with unknown Origin should get Managed Challenge (403 or JS challenge page)
curl -s -o /dev/null -w "%{http_code}" \
  -H "Origin: https://malicious-site.com" \
  "https://api.yourdomain.com/api/v1/data/vehicle"
# Expected: 403 (or 429 if challenge fails)

# Request with no Origin should pass (server-to-server)
curl -s -o /dev/null -w "%{http_code}" \
  "https://api.yourdomain.com/health"
# Expected: 200
```

---

## 11. Free-Tier Limits Summary

| Feature | Free Tier | Limit | Upgrade if... |
|---|---|---|---|
| WAF Custom Rules | ✅ Free | 5 rules | You need >5 custom policies |
| Managed WAF Rules | ✅ Free (subset) | Limited categories | You need full OWASP coverage |
| Cache Rules | ✅ Free | 10 rules | You need >10 rules |
| Transform Rules (headers) | ✅ Free | 10 rules | You need >10 rules |
| Bot Fight Mode | ✅ Free | Basic only | High-value API being scraped |
| HSTS + Always HTTPS | ✅ Free | ✅ | — |
| Full (Strict) TLS | ✅ Free | ✅ | — |
| URL Cache Purge (API) | ✅ Free | 30,000/month | High-frequency schema changes |
| **Advanced Rate Limiting** | ❌ Pro+ ($20/mo) | — | Auth brute force is a real threat |
| **Super Bot Fight Mode** | ❌ Pro+ ($20/mo) | — | Sophisticated scraping detected |
| **Prefix Cache Purge** | ❌ Pro+ ($20/mo) | — | Many meta entity types |
| **Cache Tags** | ❌ Enterprise | — | Surgical per-entity invalidation |
| **Cloudflare Access** (mTLS API auth) | ✅ Free (50 users) | 50 seats | Internal admin API protection |

### Recommended Pro upgrade trigger

Upgrade to Pro ($20/month) when **any two** of these are true:
1. You see credential stuffing attempts in Render logs (repeated login failures from rotating IPs)
2. Your Render service is waking up despite edge caching (bot traffic bypassing cache)
3. You have more than 5 WAF Custom Rule slots filled
4. You have more than ~10 entity types in `meta.entities` (prefix purge becomes necessary)
