# Deploy

Push to `main` runs `.github/workflows/deploy-vps.yml`. Markdown-only pushes do not deploy. **Run workflow** on the Actions tab rebuilds the current `main`.

Public site: https://blackhistory.360web.cloud  
Container: black-history-pomodoro-app  
Loopback on the VPS: 127.0.0.1:8037  
VPS directory: /opt/360ws/clients/docker-app/black-history-pomodoro/  
Proxy forwards to http://black-history-pomodoro-app:8080 on Docker network `360ws-network`.

After `up`: none.

Persistent media cache lives in the Docker volume `media-cache` mounted at `/data/cache/media`. rsync excludes `.env` and `node_modules`.

## Secrets (GitHub Actions)

Required:

| Secret | Purpose |
| --- | --- |
| `VPS_HOST` | Public VPS address for deploy SSH |
| `VPS_USER` | SSH user |
| `VPS_SSH_KEY` | Deploy private key |
| `BLACK_HISTORY_API_KEY` | Server-side Black History API key; written to VPS `.env` on each deploy |

Optional: `VPS_SSH_PORT`, `SLACK_WEBHOOK`.

Set or rotate the history API key:

```bash
gh secret set BLACK_HISTORY_API_KEY --repo mitchelldawkinsjr/Black-History-Pomodoro
```

The deploy job writes `/opt/360ws/clients/docker-app/black-history-pomodoro/.env` from these secrets (mode `600`). Do not commit `.env`. Without `BLACK_HISTORY_API_KEY`, the workflow fails before rebuild.
