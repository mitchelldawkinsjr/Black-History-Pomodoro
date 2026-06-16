# Paint Pomodoro

A browser extension Pomodoro timer that covers your screen in watercolor when it's time to rest.

## Status

**v0.2.0 — Paint overlay**

- Natural watercolor p5.js animation (organic splotches + capillary tendrils)
- Timer wired to paint-in → rest + prompt → paint-out flow
- Overlay covers all browser tabs during break transitions

Previous (v0.1.0):

- Manifest V3 extension scaffold
- Background service worker with Pomodoro timer (focus / break phases)
- Popup UI with start, pause, resume, skip, and reset

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
│   └── inject-overlay.js   # Injects overlay iframe + message bridge
├── overlay/
│   ├── overlay.html        # Fullscreen paint host page
│   ├── overlay.js          # Command bridge + prompt UI
│   ├── paint-sketch.js     # p5.js watercolor animation
│   └── overlay.css
├── lib/
│   └── p5.min.js
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

## How the timer works

| Phase         | Default | Behavior                                      |
|---------------|---------|-----------------------------------------------|
| Idle          | —       | Ready to start                                |
| Focus         | 25 min  | Counts down                                   |
| Paint in      | ~25 sec | Watercolor spreads across all tabs            |
| Rest          | 5 min   | Full paint + rest prompt; break timer runs    |
| Paint out     | ~25 sec | Paint lifts/fades; screen returns             |

After paint-out completes, the next focus session starts automatically.

The timer persists across popup close and browser restart via `chrome.storage` and `chrome.alarms`.

### Quick test mode

For faster testing, temporarily edit `overlay/paint-sketch.js`:

```js
const PAINT_IN_MS = 8000;
const PAINT_OUT_MS = 8000;
```

And in `background/state.js`:

```js
focusMinutes: 0.5,
breakMinutes: 0.5,
```

Then reload the extension at `chrome://extensions`.

## Next steps

- Task list in popup
- Settings UI for durations and paint speed
- Optional sound / notification when paint begins
