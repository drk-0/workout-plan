# Workout Plan 2.0 PWA

This is a proper Progressive Web App project with an optional **Android app** for **Health Connect** scale sync (GE scale).

## Files
- `index.html`
- `css/styles.css`
- `js/app.js`
- `js/exercises.js`
- `js/health-connect.js` — Health Connect bridge (Android app)
- `manifest.webmanifest`
- `service-worker.js`
- `assets/exercises/*.png`
- `icons/*.png`
- `google-apps-script/Code.gs`
- `android/` — Capacitor Android shell (after `npm run cap:sync`)

## Run locally on your computer

From this folder:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## Install on Android (browser PWA)

For a true installable PWA, host it on HTTPS, such as GitHub Pages.

Then open the URL in Chrome on your Galaxy S25 Ultra and choose:

```text
Install app
```

## Android app + GE scale (Health Connect)

The browser PWA can log body measurements manually. To **sync weight from your GE scale** (via Health Connect), build and install the Android app:

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Android Studio](https://developer.android.com/studio) with SDK 34+
- [Health Connect](https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata) installed on your phone
- GE scale already sharing weight to Health Connect

### Build steps

```bash
npm install
npm run cap:sync
npm run android:open
```

In Android Studio:

1. Connect your Galaxy S25 Ultra (USB debugging enabled).
2. Run the app on the device.
3. Open **Dashboard** → **Sync from GE Scale**.
4. Grant **Weight** (and **Body fat** if your scale provides it) when Health Connect prompts you.

Synced readings appear in **Body Measurements** and the weight trend chart. Data is stored locally on the phone like other workout history.

### Notes

- `npm run sync:www` copies web assets into `www/` for Capacitor; the repo root remains the GitHub Pages PWA.
- Health Connect is **read-only** in this build (scale → app). Workout logging stays in the app.
- Play Store release requires a Health apps declaration and privacy policy.

## Google Sheets setup

1. Create a Google Sheet named `Workout Log`.
2. Open Extensions > Apps Script.
3. Paste `google-apps-script/Code.gs`.
4. Deploy > New deployment > Web app.
5. Execute as: Me.
6. Access: Anyone with the link.
7. Copy the Web App URL.
8. In the Workout Plan app, go to Settings and paste the URL.

## GitHub Pages

Create a repo such as `workout-plan`, upload these files to the root, then enable Pages:

Settings > Pages > Deploy from branch > main > root.

## Tests

```bash
npm test
```
