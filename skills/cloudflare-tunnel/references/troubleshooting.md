# Troubleshooting

## `cloudflared` Missing

Check:

```bash
cloudflared --version
```

Install:

```bash
brew install cloudflared
```

Windows:

```powershell
winget install --id Cloudflare.cloudflared
```

Linux installation varies by distribution. Prefer Cloudflare's official package instructions when possible.

## No `trycloudflare.com` URL Appears

Try HTTP/2 and an empty config:

```bash
printf '' > /tmp/cloudflared-empty.yml
cloudflared --config /tmp/cloudflared-empty.yml tunnel --no-autoupdate --protocol http2 --url http://localhost:<PORT>
```

If the helper is running:

```bash
tail -n 80 .cloudflare-tunnel/quick.log
```

## Public URL Returns 404

An existing Cloudflare config can interfere with Quick Tunnel ingress rules. Use an empty config file:

```bash
cloudflared --config /tmp/cloudflared-empty.yml tunnel --no-autoupdate --protocol http2 --url http://localhost:<PORT>
```

## Public URL Returns 502 / Bad Gateway

Cloudflare reached the tunnel connector, but the local service did not respond.

Check:

```bash
curl -I http://localhost:<PORT>
```

Fix the local app before debugging Cloudflare.

## Local HTTPS Uses a Self-Signed Certificate

Use:

```bash
cloudflared tunnel --no-autoupdate --protocol http2 --no-tls-verify --url https://localhost:<PORT>
```

## Phone Cannot Open the App

Make sure the phone is opening the public URL:

```text
https://xxxx.trycloudflare.com
```

Not:

```text
http://localhost:<PORT>
```

## Named Tunnel DNS Fails

Check:

```bash
cloudflared tunnel list
cloudflared tunnel route dns <TUNNEL_NAME> <HOSTNAME>
```

Also confirm the domain is active in Cloudflare and the hostname is not already occupied by another DNS record.

## Login Does Not Open Browser

Run:

```bash
cloudflared tunnel login
```

Copy the printed URL into a browser manually, choose the correct Cloudflare zone, then rerun the tunnel commands.
