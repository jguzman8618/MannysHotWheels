# Manny's Hot Wheels — Setup Guide

A photo-identification inventory app for tracking which tote/location
each Hot Wheels car lives in. Take a front/back photo, the app
identifies the exact car (name, series, year, collector #, Treasure
Hunt status) using AI, then you file it into a tote. Runs as a web
app, and can be packaged into a plain installable `.apk` for Android —
no Play Store account or developer membership needed.

## What's in this folder
- `index.html` — the whole app (identification, pricing, collection, totes)
- `manifest.json` — app name/icon/theme info
- `service-worker.js` — makes it work offline once loaded
- `icons/` — app icons
- `worker/` — the backend that powers real pricing and AI identification
  (see `worker/README.md` to set it up)

Everything is stored **on the phone**, in the browser's local database
(IndexedDB). Nothing is sent to a server. Use the **Export Backup**
button in the Collection tab regularly to save a `.json` backup file
(and **Import Backup** to restore it, e.g. after reinstalling).

## Step 1 — Host the files somewhere with HTTPS
Camera access and installability both require the app to be served
over `https://` (or `localhost` for testing). The easiest free option:

**GitHub Pages**
1. Create a new GitHub repo (public or private).
2. Upload these files (keep the folder structure — `icons/` included).
3. In the repo Settings → Pages, set the source to the main branch.
4. GitHub gives you a URL like `https://yourname.github.io/mannys-hot-wheels/`.

Any other static host works too (Netlify, Vercel, Cloudflare Pages, or
even a folder on your own web server) — the only requirement is HTTPS.

## Step 2 — Turn it into an APK
Go to **[pwabuilder.com](https://www.pwabuilder.com/)**, paste in your
hosted URL, and click **Start**. PWABuilder scans the site, confirms it
finds the manifest and service worker, then under the **Android**
package option click **Generate Package**. It will hand you a
downloadable `.apk` (and `.aab` if you ever want the Play Store later,
but you don't need it).

This is a "Trusted Web Activity" wrapper — a real installable Android
app, no Play Store account, no developer fee, no membership.

## Step 3 — Install on a phone
1. Transfer the `.apk` to the phone (email, USB, cloud drive, etc).
2. On the phone, allow "Install unknown apps" for whichever app you
   used to open the file (Settings → Apps → Special access).
3. Tap the `.apk` file to install.

Repeat step 3 on every phone you want it on — no store, no account.

## Alternative: skip the APK entirely (Android)
On Android, opening the hosted URL in Chrome and choosing
**"Add to Home screen"** installs it as a full-screen app icon with
the same offline/camera functionality — zero packaging steps. The APK
route is only needed if you specifically want a shareable `.apk` file.

## iPhone / iPad
There's no such thing as an "apk" on iOS, and getting a real native
app onto an iPhone without the App Store requires a paid Apple
Developer account (for TestFlight) or fragile workarounds like
AltStore. The clean, free path is the same web app, installed straight
from Safari — no account, no membership, works fully offline once
added:

1. On the iPhone, open the hosted HTTPS URL (from Step 1 above) in
   **Safari** — it must be Safari, not Chrome, for the install option
   to appear.
2. Tap the **Share** icon (square with an arrow) in the toolbar.
3. Tap **Add to Home Screen**, then **Add**.
4. Launch it from the new Home Screen icon — it opens full-screen,
   with its own icon, and the camera and storage both work
   the same as on Android.

This is a genuine one-time install, not a bookmark — it keeps working
without a network connection after the first load. One iOS quirk
worth knowing: Safari can occasionally clear a site's local storage
if the app goes completely unused for a long stretch, so it's worth
using **Export Backup** every so often as a safety net (same button
works for restoring on either platform via **Import Backup**).

Since it's the exact same hosted URL for both platforms, one link
covers the whole household — Android phones sideload the APK or add
to Home Screen, iPhones just add to Home Screen from Safari.

## Using the app
- **Scan tab** — take a front and/or back photo of the car, then tap
  **Identify Car from Photos** (or just **Compare Prices**, which
  identifies automatically if needed). Confirm the suggested name,
  series, year, collector #, and Treasure Hunt status, pick or create
  a tote, then Save. The label auto-generates once enough is known.
- **Collection tab** — search and filter everything you've logged.
- **Totes tab** — see counts per tote, tap a tote to jump to its items,
  rename/manage totes at the bottom.

## Notes
- Identification and live pricing require the backend in `worker/` to
  be deployed — see `worker/README.md`. Without it, you can still add
  cars manually (type the name/series yourself) and organize by tote;
  you just won't get automatic identification or real prices.
- If a photo doesn't identify confidently, the app tells you rather
  than guessing — type in what you can see instead.
