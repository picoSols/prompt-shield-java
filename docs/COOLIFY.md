# Deploying to Coolify

This repo is Docker-Compose-first. Coolify can consume `docker-compose.yml` directly.

## One-time VPS setup

1. Provision a small VPS (Hetzner CPX11 ~$5/mo, DigitalOcean $6/mo, or similar). Ubuntu 22.04+ is easiest.
2. Install Coolify: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash`
3. Open Coolify's web UI, finish first-run setup, attach a domain (e.g. `coolify.yourdomain.com`).
4. Point the DNS `A` record for `prompt-shield.yourdomain.com` at the VPS IP.

## Create the application

1. In Coolify, **+ New Resource → Docker Compose → Public Repository**.
2. Paste this repo URL, branch `main`, compose path `docker-compose.yml`.
3. Add environment variables (the ones in `.env.example`). At minimum:

   | Variable | Example |
   |---|---|
   | `MYSQL_ROOT_PASSWORD` | `a long random string` |
   | `MYSQL_DATABASE` | `prompt_shield` |
   | `MYSQL_USER` | `shield` |
   | `MYSQL_PASSWORD` | `a second long random string` |
   | `SHIELD_AUDIT_STORE_RAW` | `false` |
   | `ANTHROPIC_API_KEY` | optional, only if you enable the LLM judge |

4. Under **Domains**, bind `prompt-shield.yourdomain.com` to the `frontend` service on port 80 only. The frontend nginx proxies `/scan` and `/audit` to the backend over the internal compose network, so a single domain is enough. Coolify will provision Let's Encrypt automatically.

   (The SPA honours `window.__API_BASE__` at runtime if you ever want to point it somewhere else. **Do not** expose the `backend` service on 8080 publicly as-is — it serves `/audit` and the full Spring Boot Actuator surface without authentication. If you need either publicly, add header-auth to `ScanController#recent` and trim `management.endpoints.web.exposure.include` in `application.yml` first.)

5. Click **Deploy**.

## Zero-downtime updates

Coolify watches the branch. Push to `main` → build + roll new container → old one drains. No downtime for the two-container stack.

## What Coolify gives you over plain Docker

- Free HTTPS via Caddy
- Managed `.env` UI per-service
- Build logs and container logs in the browser
- One-click rollbacks
- Scheduled backups of the MySQL volume

## Production hardening checklist

Before you send the live URL to a recruiter:

- [ ] Rotate MySQL passwords (not the placeholders)
- [ ] Remove the `127.0.0.1:3306:3306` host binding on the `mysql` service so it's reachable only on the compose network
- [ ] Set `SHIELD_AUDIT_STORE_RAW=false` (default)
- [ ] Consider rate-limiting `/scan` (nginx `limit_req` in front of the SPA, or add `resilience4j` to the backend)
- [ ] Lock down `/audit` behind a simple API key, or remove the endpoint for the public demo
- [ ] Set a Coolify backup schedule on the `mysql_data` volume
