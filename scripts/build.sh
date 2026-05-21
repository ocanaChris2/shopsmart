#!/usr/bin/env bash
# =============================================================================
#  Render Build Script — ShopSmart ERP
# =============================================================================
set -euo pipefail

echo "[build] ── API ──────────────────────────────────────────"
# --include=dev forces devDependencies (@types/*, ts-node-dev, typescript) to
# install even when NODE_ENV=production, which Render sets by default.
# TypeScript needs @types/node, @types/pg, @types/bcryptjs to compile.
npm install --prefix api --include=dev
npm run build --prefix api

echo "[build] ── Worker ──────────────────────────────────────"
npm install --prefix worker --include=dev
npm run build --prefix worker

echo "[build] ✓ Done"
