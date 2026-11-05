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

## Android path
The web UI can later be packaged with Capacitor after confirming responsive layouts, Firebase Auth persistence, file import/export, camera/QR and native permissions. Android packaging requires Android Studio/SDK and a signed release keystore. It is not included in this Electron change.

## Verification
Run `npm run lint`, `npm run build`, then `npm run desktop:pack`. Installer creation has not been executed by this repository edit.
