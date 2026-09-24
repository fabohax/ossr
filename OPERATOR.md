The clean setup is:

```text
relay.ossr.network
        ↓ DNS
Public VPS / server
        ↓ HTTPS via Caddy
127.0.0.1:3002
        ↓
OSSR relay + synchronized Stacks Core follower
```

Do not expose port `3002` directly. The current relay is testnet-only and lacks built-in TLS, rate limiting, and denial-of-service protection.

## 1. Prepare a public server

Use a Linux VPS with:

- A stable public IPv4 address
- Node.js and npm
- Caddy
- Ports `80` and `443` open
- Enough resources for the relay and its Stacks Core simulation follower

Clone and install:

```bash
sudo mkdir -p /opt/ossr
sudo chown "$USER":"$USER" /opt/ossr
git clone https://github.com/fabohax/ossr.git /opt/ossr
cd /opt/ossr
npm ci
```

Copy the populated `.env.local` securely to `/opt/ossr/.env.local`. Do not transfer it through Git.

Important production-facing settings:

```dotenv
OPERATOR_HOST=127.0.0.1
OPERATOR_PORT=3002

RELAY_ID=relay-ossr-network
OSSR_API_URL=https://relay.ossr.network

# Replace with the exact deployed UI origins:
OSSR_CORS_ALLOWED_ORIGINS=https://ossr.network,https://www.ossr.network

STACKS_SIMULATION_API_URL=http://127.0.0.1:20443
STACKS_SIMULATION_AUTH_TOKEN=your-secret-token
```

Keep `OPERATOR_HOST=127.0.0.1`; Caddy will be the only public entry point.

Protect the configuration:

```bash
chmod 600 /opt/ossr/.env.local
```

## 2. Run the relay persistently

Create `/etc/systemd/system/ossr-relay.service`:

```ini
[Unit]
Description=OSSR testnet relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ossr
Group=ossr
WorkingDirectory=/opt/ossr
ExecStart=/usr/bin/npm run operator:serve
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/ossr/.ossr

[Install]
WantedBy=multi-user.target
```

This assumes you create an `ossr` system user and make `/opt/ossr` accessible to it. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ossr-relay
sudo systemctl status ossr-relay
sudo journalctl -u ossr-relay -f
```

Verify locally on the server:

```bash
curl -fsS http://127.0.0.1:3002/health/live
curl -fsS http://127.0.0.1:3002/health/ready
curl -fsS http://127.0.0.1:3002/v1/info
```

Readiness must return HTTP 200. The synchronized Stacks Core simulation follower remains mandatory.

## 3. Add the DNS record

At the DNS provider for `ossr.network`, create:

| Type | Name | Value |
|---|---|---|
| `A` | `relay` | Your server’s public IPv4 |
| `AAAA` | `relay` | Public IPv6, if correctly configured |

Confirm propagation:

```bash
dig +short relay.ossr.network A
```

It should return the server’s public IP.

## 4. Put Caddy in front

Create `/etc/caddy/Caddyfile`:

```caddy
relay.ossr.network {
    encode zstd gzip

    request_body {
        max_size 1MB
    }

    reverse_proxy 127.0.0.1:3002 {
        health_uri /health/live
        health_interval 30s
        health_timeout 5s
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        -Server
    }

    log {
        output file /var/log/caddy/ossr-relay-access.log
    }
}
```

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy automatically provisions and renews HTTPS certificates when DNS points to the server and ports 80/443 are reachable. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) and [reverse-proxy documentation](https://caddyserver.com/docs/quick-starts/reverse-proxy) cover this behavior.

## 5. Lock down the firewall

Only expose SSH, HTTP, and HTTPS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Do not allow public traffic to `3002` or the Stacks Core RPC port `20443`.

## 6. Point the UI at the public relay

In the UI deployment environment:

```dotenv
NEXT_PUBLIC_OSSR_RELAY_URL=https://relay.ossr.network
```

Because this is a public Next.js environment variable, rebuild/redeploy the UI after changing it.

Then test externally:

```bash
curl -fsS https://relay.ossr.network/health/live
curl -fsS https://relay.ossr.network/health/ready
curl -fsS https://relay.ossr.network/v1/info
```

Before inviting public traffic, add proxy-level rate limiting or a CDN/WAF. The repository explicitly identifies missing rate limiting, abuse controls, hardened key custody, and external security review as prerequisites beyond the current testnet prototype.