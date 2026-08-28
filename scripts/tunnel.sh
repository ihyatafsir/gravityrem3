#!/usr/bin/env bash
# scripts/tunnel.sh — Persistent reverse tunnel from host port 9222 to VM port 9223

VM_HOST="10.20.102.138"
VM_USER="grem3"
VM_PASS="bismilah"

while true; do
  echo "[TUNNEL] Establishing reverse tunnel from Host:9222 to ${VM_USER}@${VM_HOST}:9223..."
  sshpass -p "$VM_PASS" ssh -N \
    -o ServerAliveInterval=10 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -o StrictHostKeyChecking=no \
    -R 9223:localhost:9222 \
    "${VM_USER}@${VM_HOST}" || true
  echo "[TUNNEL] Connection closed, retrying in 3s..."
  sleep 3
done
