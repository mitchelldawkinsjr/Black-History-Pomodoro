# Paint Pomodoro

A browser extension Pomodoro timer that covers your screen in watercolor when it's time to rest.

## Status

**v0.1.0 — Skeleton**

- Manifest V3 extension scaffold
- Background service worker with Pomodoro timer (focus / break phases)
- Popup UI with start, pause, resume, skip, and reset
- Placeholder overlay and content script (paint comes in Phase 2)
- Rest prompts data file (not wired up yet)

## Project structure

```
PaintPomodoro/
├── manifest.json
├── background/
│   ├── service-worker.js   # Timer state machine + alarms
│   └── state.js            # Shared phase/state helpers
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.css
│   └── popup.js
├── content/
│   └── inject-overlay.js   # Injects overlay iframe (stub)
├── overlay/
│   ├── overlay.html        # Fullscreen paint host page
│   ├── overlay.js          # Paint logic placeholder
│   └── overlay.css
├── data/
│   └── prompts.json        # Rest-period prompts
└── assets/icons/           # Extension icons
```

## Load the extension (development)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (`PaintPomodoro`)
5. Click the Paint Pomodoro icon in the toolbar to open the popup

## How the timer works (skeleton)

| Phase   | Default | Behavior                          |
|---------|---------|-----------------------------------|
| Idle    | —       | Ready to start                    |
| Focus   | 25 min  | Counts down; auto-starts break    |
| Rest    | 5 min   | Counts down; auto-starts next focus |

The timer persists across popup close and browser restart via `chrome.storage` and `chrome.alarms`.

## Next steps

- Phase 2: Integrate p5.js paint sketch into `overlay/`
- Phase 3: Wire overlay to timer phase transitions + rest prompts
- Phase 4: Task list in popup + settings
