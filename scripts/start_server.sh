#!/usr/bin/env bash
cd /home/grem3/gravityrem3
export PORT=8787
export CDP_TARGET=vm
export NODE_ENV=production
export PATH="/home/grem3/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

exec /usr/bin/node /home/grem3/gravityrem3/server.mjs
