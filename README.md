# Black History Pomodoro

A Chrome MV3 Pomodoro timer that reveals sourced Black history facts and rights-checked archival images across ten earned focus sessions.

Production API: [docs/deploy.md](docs/deploy.md) (`https://blackhistory.360web.cloud`). Setup: [docs/SETUP.md](docs/SETUP.md).

Upstream inspiration: [PaintPomodoro](https://github.com/AirFan003/PaintPomodoro).

## Features

- Focus and break timer with pause, resume, and skip
- Fullscreen watercolor overlay across browser tabs during breaks
- Discovery clues unlock over multiple breaks; new story every 10 breaks
- Daily task list in the popup
- Melanin-inspired visual branding
- Timer persists via `chrome.storage` and `chrome.alarms`

## Install (beta — before Chrome Web Store)

**Friends & testers:** see **[INSTALL.md](./INSTALL.md)** for download and setup steps.

## Load locally (development)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Click the Black History Pomodoro toolbar icon to open the popup

## Publish to Chrome Web Store

See **[PUBLISH.md](./PUBLISH.md)** for the full unlisted-release checklist (developer account, privacy policy, store copy, zip upload, and sharing a private install link with friends).

**Privacy policy:** [privacy.html](./privacy.html) (host via GitHub Pages for the store submission)

## Project structure

```
Black-History-Pomodoro/
├── manifest.json
├── background/          # Service worker, timer, daily discovery
├── popup/               # Extension popup UI
├── content/             # Overlay injection on web pages
├── overlay/             # Watercolor reveal (p5.js)
├── shared/              # Theme tokens + API config
├── server/              # Project discovery API
├── lib/p5.min.js
├── data/
├── assets/icons/
├── privacy.html
└── PUBLISH.md
```

## Attribution

Historical facts are sourced through The Black History API. On-screen image credit follows the matched archival source (for example Wikimedia Commons creator/license). Imagery is rights-checked with on-screen credit where required.
