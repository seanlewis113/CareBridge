# Mom's Tablet Kiosk Setup

Use these steps to keep Mom's tablet locked to her hub view.

## iPad (Recommended: Guided Access)

1. Install Mom's Care as a PWA: open the app in Safari, tap Share, then **Add to Home Screen**.
2. Open **Settings → Accessibility → Guided Access** and turn it on.
3. Set a Guided Access passcode (different from the app PIN).
4. Open Mom's Care from the home screen and sign in as **Mom** with her PIN.
5. Triple-click the side button to start Guided Access.
6. Disable touch on areas you don't want her to use (optional), then tap **Start**.

To exit Guided Access, triple-click the side button and enter the Guided Access passcode.

## Android Tablet

1. Install **Fully Kiosk Browser** (or similar) from the Play Store.
2. Set the start URL to your deployed Mom's Care URL (e.g. `https://your-app.vercel.app`).
3. Enable kiosk mode and set a PIN for exiting kiosk.
4. In Mom's Care, sign in as **Mom** and bookmark `#/mother`.

## App PINs

- **Mom's PIN**: Used only to open her hub. Set in Admin → Settings.
- **Persona switch PIN**: Required to leave Mom's view and pick Admin or Caregiver. Set in Admin → Settings.
- Default PIN (if not set): `1234` for demo/local mode.

## Tips

- Enable **Do Not Disturb** during sleep hours.
- Keep the tablet plugged in.
- Use Admin → Settings to increase text scale for Mom's hub.
- The hub auto-refreshes after 5 minutes of idle time.
