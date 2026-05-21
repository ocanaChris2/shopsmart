#!/usr/bin/env bash
# =============================================================================
#  Render Build Script — ShopSmart ERP
#  Called by: render.yaml buildCommand
# =============================================================================
set -euo pipefail

echo "[build] ── API ──────────────────────────────────────────"
npm install --prefix api
npm run build --prefix api

echo "[build] ── Worker ──────────────────────────────────────"
npm install --prefix worker
npm run build --prefix worker

echo "[build] ✓ Done"
