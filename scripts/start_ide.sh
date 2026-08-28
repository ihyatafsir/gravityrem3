#!/usr/bin/env bash
export WAYLAND_DISPLAY=wayland-0
export DISPLAY=:0
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"

exec /home/grem3/.local/share/antigravity/antigravity-ide   --ozone-platform=wayland   --disable-gpu   --no-sandbox   --remote-debugging-port=9222   --user-data-dir="/home/grem3/.config/Antigravity IDE"   --extensions-dir="/home/grem3/.antigravity/extensions"   /home/grem3/gravityrem3
