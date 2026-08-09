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

## Install on iPhone or iPad

For a true installable PWA, host it on HTTPS, such as GitHub Pages.

Then on your iPhone or iPad:

1. Open the URL in **Safari** (Chrome on iOS cannot install PWAs to the home screen).
2. Tap the **Share** button.
3. Tap **Add to Home Screen**.
4. Tap **Add**.

The app opens full-screen like a native app, works offline after the first visit, and keeps the rest timer accurate when you switch apps briefly.

Workout sessions can be managed from **Dashboard → Workout History**. Editing a
synced set marks it for an update, while removed sets and deleted workouts are
queued for deletion during the next Google Sheets sync.

### iPhone and iPad tips

- Use **Settings → Google Sheets Sync** in the app to paste your sync URL and token.
- During a workout, start the rest timer to keep the screen awake on supported devices.
- The rest timer sounds three alarm tones at zero. Vibration is used where the browser supports it; Safari on iPhone does not expose web vibration.
- On iPad, rotate freely — the layout adapts in portrait and landscape.
- If sync fails, confirm the Google Apps Script web app is deployed with access set to **Anyone with the link**.

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
8. In Apps Script, open **Project Settings → Script Properties** and add
   `WORKOUT_SYNC_TOKEN` with a long random value (a password manager can generate it).
9. Deploy the script again after updating it.
10. In the Workout Plan app, go to Settings and paste both the URL and the same token.

Redeploy `Code.gs` after app updates. The current endpoint supports versioned
insert, edit, and deletion sync for workout sets.

The endpoint rejects requests without the token, validates batch sizes and fields, and
neutralizes spreadsheet formulas in text fields. Treat the token like a password.

## Local data and backups

Workout history and body measurements are stored only in this app's namespaced browser
storage. The app requests persistent storage where the browser supports it, but browsers
can still remove local data when an app is uninstalled or site data is cleared.

Use **Settings → Data Backup → Export Backup** regularly. A backup can be restored on
another device from the same panel. Sync URLs and tokens are not included in backups.

## GitHub Pages

Create a repo such as `workout-plan`, upload these files to the root, then enable Pages:

Settings > Pages > Deploy from branch > main > root.

## Tests

```bash
npx playwright install chromium webkit
npm test
```

The test suite runs unit tests plus browser startup checks using iPhone and iPad
WebKit profiles and an offline service-worker reload check.
