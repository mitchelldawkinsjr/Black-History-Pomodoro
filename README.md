# Black History Pomodoro

A Chrome MV3 Pomodoro timer that reveals sourced Black history facts and rights-checked archival images in watercolor across ten earned focus sessions.

Production API: [docs/deploy.md](docs/deploy.md) (`https://blackhistory.360web.cloud`). Setup: [docs/SETUP.md](docs/SETUP.md).

Upstream inspiration: [PaintPomodoro](https://github.com/AirFan003/PaintPomodoro).

## Features

- Focus and break timer with pause, resume, and skip
- Fullscreen watercolor overlay across browser tabs during breaks
- Painting clues unlock over multiple breaks; new artwork every 10 breaks
- Daily task list in the popup
- Timer persists via `chrome.storage` and `chrome.alarms`

## Install (beta — before Chrome Web Store)

**Friends & testers:** see **[INSTALL.md](./INSTALL.md)** for download and setup steps.

## Load locally (development)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Click the Paint Pomodoro toolbar icon to open the popup

## Publish to Chrome Web Store

See **[PUBLISH.md](./PUBLISH.md)** for the full unlisted-release checklist (developer account, privacy policy, store copy, zip upload, and sharing a private install link with friends).

**Privacy policy:** [privacy.html](./privacy.html) (host via GitHub Pages for the store submission)

## Project structure

```
PaintPomodoro/
├── manifest.json
├── background/          # Service worker, timer, Met API, daily art
├── popup/               # Extension popup UI
├── content/             # Overlay injection on web pages
├── overlay/             # Watercolor reveal (p5.js)
├── lib/p5.min.js
├── data/
├── assets/icons/
├── privacy.html
└── PUBLISH.md
```

## Attribution

Artworks are from [The Met Open Access](https://www.metmuseum.org/about-the-met/policies-and-documents/open-access) collection (public domain). Courtesy of The Metropolitan Museum of Art.
