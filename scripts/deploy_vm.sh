#!/usr/bin/env bash
# scripts/deploy_vm.sh — Synchronize and reload GravityRem3 on VM 10.20.102.138

set -e
VM_HOST="10.20.102.138"
VM_USER="grem3"
VM_PASS="bismilah"
LOCAL_DIR="/home/absolut7/Documents/26apps/gravityrem3/"
REMOTE_DIR="/home/grem3/gravityrem3/"

echo "🚀 Deploying GravityRem3 to ${VM_USER}@${VM_HOST}..."

# 1. Sync files
sshpass -p "$VM_PASS" rsync -avz --exclude 'node_modules' --exclude '.git' "$LOCAL_DIR" "${VM_USER}@${VM_HOST}:${REMOTE_DIR}"

# 2. Restart service
sshpass -p "$VM_PASS" ssh "${VM_USER}@${VM_HOST}" "
echo '$VM_PASS' | sudo -S systemctl restart gravityrem3.service
sleep 1
echo '$VM_PASS' | sudo -S systemctl status gravityrem3.service --no-pager
"

echo "✅ Deployment complete! Available at http://${VM_HOST}:8787"
