# Workout Plan 2.0 PWA

This is a proper Progressive Web App project.

## Files
- `index.html`
- `css/styles.css`
- `js/app.js`
- `js/exercises.js`
- `manifest.webmanifest`
- `service-worker.js`
- `assets/exercises/*.png`
- `icons/*.png`
- `google-apps-script/Code.gs`

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

### iPhone and iPad tips

- Use **Settings → Google Sheets Setup** in the app to paste your sync URL.
- During a workout, start the rest timer to keep the screen awake on supported devices.
- On iPad, rotate freely — the layout adapts in portrait and landscape.
- If sync fails, confirm the Google Apps Script web app is deployed with access set to **Anyone with the link**.

## Install on Android

For a true installable PWA, host it on HTTPS, such as GitHub Pages.

Then open the URL in Chrome on your phone and choose:

```text
Install app
```

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
