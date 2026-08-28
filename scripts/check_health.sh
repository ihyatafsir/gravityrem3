#!/usr/bin/env bash
# scripts/check_health.sh — Comprehensive Health Inspector for GravityRem3

echo "=== GRAVITYREM3 HEALTH AUDIT ==="
echo ""
echo "1. Host Local Port (8787):"
curl -s http://localhost:8787/api/status | jq . || echo "❌ Local port 8787 unreachable"

echo ""
echo "2. Host CDP Port (9222):"
curl -s http://localhost:9222/json/version | jq . || echo "❌ Local CDP port 9222 unreachable"

echo ""
echo "3. Remote VM (10.20.102.138:8787):"
curl -s http://10.20.102.138:8787/api/status | jq . || echo "❌ Remote VM port 8787 unreachable"
