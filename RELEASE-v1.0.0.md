# Paint Pomodoro v1.0.0

**A Pomodoro timer that turns your break into a slow reveal of a masterpiece.**

When your focus session ends, Paint Pomodoro covers the screen in watercolor and gradually uncovers a public-domain painting from The Metropolitan Museum of Art. Rest while the image builds up, read clues that unlock break by break, and fade back to work when you’re ready.

This is an early **beta release** shared directly via GitHub while the Chrome Web Store listing is in review.

---

## What it does

- **Focus timer** — default 25-minute sessions; keeps running when the popup is closed
- **Watercolor break overlay** — fullscreen paint reveal on whatever site you’re browsing
- **Art from The Met** — public-domain paintings only, with on-screen attribution
- **Clues over time** — department, medium, artist, title, and more unlock across breaks
- **New painting every 10 breaks** — your break counter keeps going (Break 11, 12, …)
- **Pause & resume** — during both focus and break
- **Start break early** or **skip break** when you need to
- **Daily task list** — lightweight to-do list in the popup

---

## Install

**Chrome only for now.** You’ll need Developer mode for this beta install.

### Quick steps

1. Download **`paint-pomodoro-1.0.0.zip`** from the Assets section below.
2. **Unzip** it.
3. Open **`chrome://extensions`** → enable **Developer mode**.
4. Click **Load unpacked** → select the unzipped folder (the one with `manifest.json` inside).
5. Pin **Paint Pomodoro** from the extensions menu and click **Start focus**.

Detailed instructions, troubleshooting, and update steps: **[INSTALL.md](https://github.com/AirFan003/PaintPomodoro/blob/main/INSTALL.md)**

---

## Before you start

- Have a **normal website tab** open (e.g. Gmail, Wikipedia) — the overlay won’t run on `chrome://` pages.
- Chrome may warn you about **developer mode extensions**. That’s normal until the store version is available.
- **Internet required** for fetching artwork from The Met (first break may take a moment to load).

---

## Known limitations (beta)

- Install requires manual steps (no one-click “Add to Chrome” until store approval)
- Overlay injection is limited on some restricted pages (Chrome settings, Web Store, etc.)
- Settings for custom focus/break lengths are not in the popup yet (defaults: 25 min focus / 5 min break)

---

## Attribution

Artworks courtesy of **The Metropolitan Museum of Art**, via the [Open Access](https://www.metmuseum.org/about-the-met/policies-and-documents/open-access) program.

---

## Privacy

No account. No ads. Timer and task data stay on your device.  
[Privacy policy](https://airfan003.github.io/PaintPomodoro/privacy.html)

---

## Feedback welcome

Trying this build? Issues and suggestions: [GitHub Issues](https://github.com/AirFan003/PaintPomodoro/issues)
