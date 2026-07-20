# Workout Plan Development Rules

## Product goal

Build a simple, reliable, mobile-first Progressive Web App that guides and records dumbbell workouts for a man in his 60s with type 2 diabetes whose goals are:

- increase or preserve muscle mass
- improve body composition
- maintain mobility and balance
- progress gradually
- avoid unnecessary injury or exhaustion
- keep the application easy to use during a workout

## Engineering rules

- Keep the application installable as a PWA.
- Design primarily for a Samsung Galaxy S25 Ultra.
- Preserve offline functionality.
- Preserve locally saved workout data during upgrades.
- Never silently delete or overwrite workout history.
- Avoid large frameworks unless there is a clear benefit.
- Use accessible font sizes and large touch targets.
- Keep exercise configuration separate from UI logic.
- Keep Google Sheets configuration out of committed source code.
- Never commit personal health records or secrets.
- Test navigation, timers, logging, offline use, and data export after changes.
- Make small commits with descriptive messages.

## Health and workout rules

- Do not present the application as medical treatment.
- Support gradual progression rather than maximum-effort lifting.
- Include warnings for pain, dizziness, unusual shortness of breath, or symptoms of low glucose.
- Avoid automatic weight increases without user confirmation.
- Allow exercises to be skipped, substituted, or reduced.
- Prefer clear form cues over motivational hype.
