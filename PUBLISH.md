# Publishing Black History Pomodoro (Unlisted)

Use this guide to publish an **Unlisted** Chrome Web Store version and share a private install link with friends.

**Privacy policy URL (after GitHub Pages is enabled):**  
https://mitchelldawkinsjr.github.io/Black-History-Pomodoro/privacy.html

---

## Step 1 — Register as a Chrome Web Store developer

1. Sign in with a Google account at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Accept the developer agreement.
3. Pay the **one-time $5 USD** registration fee.
4. Fill in your **Publisher name** (shown on the store listing).

You only do this once. After approval, you can upload extensions from this dashboard.

---

## Step 2 — Pre-launch checklist

### Already done in this repo

- [x] Version bumped to **1.0.0** in `manifest.json`
- [x] Privacy policy at `privacy.html`
- [x] Store listing copy below (Step 4)
- [x] Permission justifications below (Step 5)
- [x] Melanin branding + discovery attribution in the overlay HUD

### You should do before uploading

- [ ] **Test locally** — load unpacked at `chrome://extensions`, run focus → break → pause → skip → paint-out.
- [ ] **Push to GitHub** — required so the privacy policy URL works (Step 3).
- [ ] **Enable GitHub Pages** (Step 3).
- [ ] **Take 1–5 screenshots** (1280×800 or 640×400 PNG/JPEG):
  - Popup during focus
  - Fullscreen watercolor break overlay
  - HUD with discovery clues expanded
  - Optional: popup during break with timer visible
- [ ] **Build the zip** (see below).

### Build the upload zip

From the project folder:

```bash
cd /Users/mitchelldawkins/Projects/Black-History-Pomodoro
zip -r black-history-pomodoro-1.0.0.zip . \
  -x "*.git*" \
  -x ".DS_Store" \
  -x "*.zip" \
  -x "PUBLISH.md" \
  -x "server/node_modules/*"
```

Upload **`black-history-pomodoro-1.0.0.zip`** — not the whole folder.

---

## Step 3 — Host the privacy policy

Google requires a **public URL** to your privacy policy before you can publish.

1. Commit and push `privacy.html` to GitHub.
2. On GitHub, open **Black-History-Pomodoro → Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Branch: **main**, folder: **/ (root)**.
5. Save. After 1–2 minutes, verify this URL loads:  
   **https://mitchelldawkinsjr.github.io/Black-History-Pomodoro/privacy.html**

Paste that URL into the Chrome Web Store **Privacy practices** section.

---

## Step 4 — Store listing copy (paste into dashboard)

### Extension name
```
Black History Pomodoro
```

### Summary (short description, max 132 characters)
```
A Pomodoro timer that reveals sourced Black history facts during breaks — focus first, then learn.
```

### Description (detailed)
```
Black History Pomodoro helps you stay focused — then rewards your breaks with history.

When your focus session ends, a fullscreen watercolor overlay gradually reveals a rights-checked archival image alongside sourced Black history facts. Take a real rest while the image builds up, read clues that unlock break by break, and return to work when the break ends.

Features:
• Focus and break timer with pause, resume, and skip
• Watercolor reveal animation powered by generative paint and color-matching agents
• New discovery every 10 breaks, with clues that unlock over time
• Daily task list in the popup
• Melanin-inspired visual branding
• Timer keeps running when the popup is closed

Facts are served by The Black History API. On-screen image credit comes from the matched archival source (for example Wikimedia Commons). Imagery is rights-checked with license shown when available.

Black History Pomodoro stores your timer, tasks, and discovery progress locally on your device. No account required.
```

### Category
```
Productivity
```

### Language
```
English
```

### Single purpose description (for the review form)
```
Helps users take timed Pomodoro breaks by revealing sourced Black history with a fullscreen watercolor overlay when a break starts.
```

### Support / homepage (optional but recommended)
```
https://github.com/mitchelldawkinsjr/Black-History-Pomodoro
```

---

## Step 5 — Permission justifications (paste into dashboard)

When Google asks why each permission is needed:

| Permission | Justification |
|------------|---------------|
| **storage** | Saves Pomodoro timer state, daily tasks, discovery progress, and user settings locally on the device. |
| **alarms** | Keeps the focus/break timer accurate when the popup is closed or the browser is in the background. |
| **tabs** | Finds an active, normal webpage tab where the break overlay can be shown during rest periods. |
| **scripting** | Injects the overlay content script into the active tab when a break begins. |
| **Host permission: blackhistory.360web.cloud** | Fetches sourced historical discoveries and approved media from The Black History API. |
| **Host permission: &lt;all_urls&gt;** | Displays the fullscreen break overlay on whichever website the user is browsing when a rest break starts. The overlay is only shown during breaks; the extension does not collect or transmit page content. |

### Data use / Privacy practices (Chrome Web Store form)

- **Does your extension collect user data?** No (or “No personal data collected” — all storage is local).
- **Privacy policy URL:** `https://mitchelldawkinsjr.github.io/Black-History-Pomodoro/privacy.html`
- **Certify** that the privacy policy is accurate.

---

## Step 6 — Source & attribution

Already implemented in the extension:

- Discoveries come from The Black History API.
- The overlay HUD attribution is wired to the matched image credit (`visual.credit`).
- Image title, credit, and license unlock with the final reveal when available.

---

## Upload as Unlisted (share link with friends)

After Steps 1–6 are ready:

1. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Click **New item** and upload `black-history-pomodoro-1.0.0.zip`.
3. Fill in the store listing using Step 4 copy.
4. Add your **icon** (128×128 — use `assets/icons/icon128.png`).
5. Upload **screenshots** (at least one required).
6. Complete **Privacy** tab with your policy URL.
7. Complete **Distribution** tab:
   - Visibility: **Unlisted**
   - Unlisted means the extension does not appear in search; only people with the direct link can install it.
8. Click **Submit for review**.

### Review timeline

- First submission: typically **3–7 business days** (sometimes longer because of `<all_urls>`).
- You’ll get email when it’s approved or if changes are requested.

### Share with friends

After approval, open your item in the dashboard. Copy the **Chrome Web Store URL** and send that link to friends.

---

## If review asks for changes

Common requests:

1. **Clearer privacy policy** — point them to the hosted `privacy.html` URL.
2. **Permission justification for &lt;all_urls&gt;** — paste the table from Step 5.
3. **Screenshot mismatch** — upload screenshots that match the current UI.

Fix the issue, bump version to `1.0.1` in `manifest.json`, rebuild the zip, and upload a new package.

---

## Quick reference

| Item | Value |
|------|--------|
| Version | 1.0.0 |
| Privacy policy | https://mitchelldawkinsjr.github.io/Black-History-Pomodoro/privacy.html |
| GitHub | https://github.com/mitchelldawkinsjr/Black-History-Pomodoro |
| Distribution | Unlisted (private link) |
| Zip file | `black-history-pomodoro-1.0.0.zip` |
