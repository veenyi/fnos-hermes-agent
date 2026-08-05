# Named Tunnel

Named Tunnel maps a fixed hostname such as `app.example.com` to a local service through Cloudflare Tunnel.

Use it when the user needs:

- a stable public URL
- webhook registration
- repeatable client previews
- a custom domain
- a long-lived public mapping

Prerequisites:

- `cloudflared` is installed.
- The user has a Cloudflare account.
- The domain is active in Cloudflare DNS.
- The user can complete browser login or provide an approved tunnel token through Cloudflare's normal mechanisms.

## Locally Managed Flow

Login:

```bash
cloudflared tunnel login
```

Create the tunnel:

```bash
cloudflared tunnel create <TUNNEL_NAME>
```

Route DNS:

```bash
cloudflared tunnel route dns <TUNNEL_NAME> <HOSTNAME>
```

Generate local config:

```bash
python3 scripts/tunnel_helper.py named-config \
  --name <TUNNEL_NAME> \
  --hostname <HOSTNAME> \
  --url http://localhost:<PORT>
```

Run:

```bash
cloudflared tunnel --config .cloudflare-tunnel/<TUNNEL_NAME>.yml run <TUNNEL_NAME>
```

## Config Shape

The helper generates:

```yaml
tunnel: <TUNNEL_NAME>

ingress:
  - hostname: app.example.com
    service: http://localhost:3000
  - service: http_status:404
```

For many local setups this is enough because `cloudflared` can resolve credentials from the user's existing Cloudflare configuration. If a credentials file is required, add:

```yaml
credentials-file: /Users/<user>/.cloudflared/<TUNNEL_ID>.json
```

## Token-Based Remotely Managed Tunnels

If the user creates a remotely managed tunnel in the Cloudflare dashboard, they may receive a run command using a token:

```bash
cloudflared tunnel run --token <TOKEN>
```

Do not print, commit, or store this token in repo files. If automation is needed, keep it in an environment variable or a local secret manager.

## Verification

Verify the local service first:

```bash
curl -I http://localhost:<PORT>
```

Then verify the hostname:

```bash
curl -I https://<HOSTNAME>
```

If the hostname fails immediately after DNS routing, wait briefly and retry. DNS and edge propagation may take time.
