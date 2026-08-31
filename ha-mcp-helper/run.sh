#!/bin/sh
set -e

OPTIONS_FILE="/data/options.json"

if [ -f "$OPTIONS_FILE" ]; then
    API_KEY=$(jq --raw-output '.api_key // empty' "$OPTIONS_FILE")
    if [ -n "$API_KEY" ]; then
        export ADDON_API_KEY="$API_KEY"
    fi
fi

if [ -z "$ADDON_API_KEY" ]; then
    echo "[WARNING] No ADDON_API_KEY configured in /data/options.json or environment!"
    echo "[WARNING] Please configure an api_key in the add-on configuration."
fi

if [ -d "/homeassistant_config" ]; then
    export CONFIG_ROOT="/homeassistant_config"
else
    export CONFIG_ROOT="${CONFIG_ROOT:-/config}"
fi

echo "[INFO] Starting Home Assistant AI Helper Addon..."
echo "[INFO] Config Root: ${CONFIG_ROOT}"
echo "[INFO] Listening on port 8099..."

exec uvicorn app.main:app --host 0.0.0.0 --port 8099
