# Setup

## DNS (required before HTTPS works)

`360web.cloud` uses Hostinger (`dns-parking.com`). Each subdomain is explicit — there is no wildcard.

Add this record in Hostinger DNS for `360web.cloud`:

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| CNAME | `blackhistory` | `360web.cloud` | 300 |
| or A | `blackhistory` | `82.25.91.63` | 300 |

Match other live hosts (`grow`, `wellness`, `thinker`): they are CNAMEs to `360web.cloud`.

After DNS resolves publicly, re-run TLS provisioning:

```bash
bash ~/.cursor/skills/mitch-cloud-deploy/scripts/provision.sh \
  --repo mitchelldawkinsjr/Black-History-Pomodoro \
  --domain blackhistory.360web.cloud \
  --forward-host black-history-pomodoro-app \
  --forward-port 8080
```

## Project API

Production API: `https://blackhistory.360web.cloud`

- Health: `GET /healthz`
- Next discovery: `GET /v1/discoveries/next?exclude=id1,id2`
- Discovery by id: `GET /v1/discoveries/:id`
- Media: `GET /v1/media/:assetId`

Deploy details: [deploy.md](deploy.md).

### Secrets (server only)

1. Create a key at https://www.blackhistoryapi.io/
2. Store it as a GitHub Actions secret (never in the extension, README, or git):

```bash
gh secret set BLACK_HISTORY_API_KEY --repo mitchelldawkinsjr/Black-History-Pomodoro
```

3. Each deploy writes that value into the VPS `.env` for the container. See [deploy.md](deploy.md).

Without a key, local/dev can still serve curated fallbacks from `data/reviewed-fallbacks.json`. Production deploys require the secret.

## Extension backend URL

The extension reads `shared/config.js` → `API_BASE_URL`.

- Production / packaged builds: `https://blackhistory.360web.cloud`
- Local API: change to `http://127.0.0.1:8080` while developing the server

`manifest.json` `host_permissions` must include that origin so the service worker can fetch discoveries and images.

## Local server

```bash
cd server
cp .env.example .env
npm install
npm run dev
```
