# Security

Cloudflare Tunnel exposes a local service to the public internet. Treat the public URL as reachable by anyone who obtains it unless Cloudflare Access or application authentication is configured.

## Ask Before Exposing

Pause and confirm with the user before exposing:

- admin dashboards
- database consoles
- Docker daemon APIs
- Redis, Postgres, MySQL, Elasticsearch, or similar data services
- internal company tools
- apps containing API keys, cookies, bearer tokens, session dumps, or private files
- unauthenticated write APIs
- local development apps with debug consoles enabled

## Safer Defaults

- Prefer quick mode only for short-lived demos.
- Prefer named mode plus Cloudflare Access for stable internal tools.
- Do not expose raw databases or private network services.
- Do not commit generated Cloudflare credentials or tunnel tokens.
- Stop quick tunnels after the demo.
- Verify what the public URL returns before sharing it.

## Cloudflare Access

If the user wants to expose a sensitive app with a stable hostname, recommend protecting it with Cloudflare Access or application-level authentication before sharing the URL.

This skill can help create the tunnel, but it should not silently publish a sensitive service without an access control decision.
