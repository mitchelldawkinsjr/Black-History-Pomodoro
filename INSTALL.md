# Install Black History Pomodoro (Chrome)

Black History Pomodoro is not on the Chrome Web Store yet. Until it is, install it manually from the release zip below.

**Requirements:** Google Chrome or Chromium (Manifest V3). Edge may work but is not tested.

---

## Download

1. Open the [latest GitHub Release](https://github.com/mitchelldawkinsjr/Black-History-Pomodoro/releases/latest).
2. Under **Assets**, download the newest release zip (for example `black-history-pomodoro-1.0.0.zip`).
3. **Unzip** the file on your computer. You should get a folder that contains `manifest.json` at the top level.

   > **Important:** Chrome needs the **unzipped folder**, not the `.zip` file itself.

---

## Install in Chrome

1. Open a new tab and go to **`chrome://extensions`**
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the **unzipped Black History Pomodoro folder** — the one that contains `manifest.json`.
5. Pin the extension: click the puzzle-piece icon in Chrome’s toolbar → find **Black History Pomodoro** → click the pin.

You’re ready. Click the Black History Pomodoro icon to open the popup and press **Start focus**.

---

## First time using it

1. **Start focus** — the timer runs even if you close the popup.
2. When focus ends (or you click **Start break**), open any normal website tab (e.g. google.com). The watercolor break overlay appears there.
3. During a break you can **Pause** / **Resume**, or **Skip break** to return to work early.
4. Clues about today’s discovery unlock as you take more breaks. A new story appears every 10 breaks.

The overlay does **not** appear on Chrome internal pages (`chrome://`, the Web Store, etc.). If the break doesn’t show, switch to a regular website tab and try **Start break** again from the popup.

---

## Chrome warnings (normal for now)

Because this build is installed outside the Chrome Web Store, Chrome may show:

- A banner about **developer mode extensions**
- A reminder to **turn off developer mode**

That’s expected. Choose **Cancel** or dismiss the banner if you want to keep using Black History Pomodoro. Once the extension is approved on the Chrome Web Store, you’ll be able to install it with one click and these warnings go away.

---

## Updating to a newer version

1. Download the new zip from **Releases**.
2. Unzip it (you can replace the old folder or use a new one).
3. Go to **`chrome://extensions`**
4. Click the **Reload** icon on Black History Pomodoro, **or** remove the old version and **Load unpacked** again with the new folder.

Your timer progress and discovery state are stored in Chrome and should carry over after a reload.

---

## Troubleshooting

| Problem | What to try |
|--------|-------------|
| Break overlay doesn’t appear | Open a normal website (not `chrome://`). Click **Start break** from the popup while on that tab. |
| “Could not reach a webpage tab” | Same as above — focus a regular browser tab first. |
| Extension disappeared after restart | Go to `chrome://extensions` and confirm it’s still enabled. Re-load unpacked if needed. |
| Reveal looks stuck after pause | Click **Resume** in the popup, or **Skip break** to exit. |

---

## Privacy

Timer data, tasks, and discovery progress are stored **locally in your browser**. Discoveries are fetched from The Black History API (`https://blackhistory.360web.cloud`).

Full details: [Privacy policy](./privacy.html)

---

## Feedback

Open an issue on [GitHub](https://github.com/mitchelldawkinsjr/Black-History-Pomodoro/issues) or contact the developer directly.
