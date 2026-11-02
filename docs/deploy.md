# Deploy

Push to `main` runs `.github/workflows/deploy-vps.yml`. Markdown-only pushes do not deploy. **Run workflow** on the Actions tab rebuilds the current `main`.

Public site: https://blackhistory.360web.cloud  
Container: black-history-pomodoro-app  
Loopback on the VPS: 127.0.0.1:8037  
VPS directory: /opt/360ws/clients/docker-app/black-history-pomodoro/  
Proxy forwards to http://black-history-pomodoro-app:8080 on Docker network `360ws-network`.

After `up`: none.

Persistent media cache lives in the Docker volume `media-cache` mounted at `/data/cache/media`. rsync excludes `.env` and `node_modules`; the VPS `.env` is created once and kept across deploys.

Secrets (GitHub Actions): `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. Optional: `VPS_SSH_PORT`, `SLACK_WEBHOOK`.

Optional VPS `/opt/360ws/clients/docker-app/black-history-pomodoro/.env`:

```dotenv
BLACK_HISTORY_API_KEY=
BLACK_HISTORY_BASE_URL=https://rest.blackhistoryapi.io/v2
PUBLIC_API_ORIGIN=https://blackhistory.360web.cloud
RATE_LIMIT_PER_MINUTE=30
```
