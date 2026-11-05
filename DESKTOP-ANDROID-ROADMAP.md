# IT Fix: Desktop and Android packaging

## Current desktop shell
The existing React + Vite application is kept as the shared UI. Electron is added as a Windows desktop shell; Firebase remains the existing cloud backend.

### Windows development
1. Install Node.js 22+ and Git.
2. Clone this repository and run `npm install`.
3. Start the desktop app: `npm run desktop:dev`.
4. Build the Windows installer: `npm run desktop:build` (output in `release/`).

### Security notes
- Electron renderer Node integration is disabled and context isolation is enabled.
- Keep privileged operations in the main process and expose only narrow preload APIs.
- Never put Firebase Admin credentials or service-account keys in the renderer or packaged app.
- Review Firestore rules and Firebase Auth before distributing the installer.

## Android scaffold
Capacitor dependencies and `capacitor.config.ts` are now committed. Android commands:
1. `npm install`
2. `npm run android:add` (one-time; requires Android SDK/tooling)
3. `npm run android:sync`
4. `npm run android:open` to open Android Studio
5. Build/debug in Android Studio; configure a signed release keystore before distributing APK/AAB.

The native `android/` project has not yet been generated or built in this environment. Firebase Google sign-in currently uses `signInWithPopup`, which must be adapted/tested for native Android before release. File import/export, QR/camera permissions, and responsive screens need device validation.

## CI
A GitHub Actions workflow now runs dependency installation, TypeScript checking (`npm run lint`), and the production web build on pushes and pull requests to `main`. Check the Actions tab for the first result.

## Verification still required
Run `npm run lint`, `npm run build`, then `npm run desktop:pack` locally. Installer creation and Android device testing have not been executed by these repository edits.
