# Home Assistant AI Helper Add-on

Lightweight and secure AI agent companion for Home Assistant.

## How to Configure

1. Navigate to the **Configuration** tab in this add-on.
2. In the **api_key** field, enter a secure random secret key (e.g., a 32+ character alphanumeric string).
3. Click **Save** and **Start** the add-on.
4. Provide this API key and the add-on URL (`http://<your-ha-ip>:8099`) to your MCP client configuration (`ADDON_KEY` and `ADDON_URL`).

## Security Features

- **Jailed File Access**: All file reads and writes are strictly isolated to `/config`.
- **Protected Secrets**: Sensitive files like `secrets.yaml` and `.storage/core.auth` cannot be read or overwritten.
- **Automatic Snapshots**: Every file modification automatically creates a timestamped safety backup in `/config/.snapshots/`.
