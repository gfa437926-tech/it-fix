# IT Fix — Asset Management

Arabic-first asset inventory, custody, maintenance and office management application.

## Current application stack

- React + TypeScript + Vite
- Firebase Authentication, Cloud Firestore and Firebase Storage
- Electron desktop packaging for Windows
- Capacitor 7 Android wrapper

## Requirements

- Node.js 22 or newer
- npm
- For Android local builds: Android Studio, Android SDK and JDK 21
- For Windows desktop builds: Windows is recommended for producing the NSIS installer

## Run the web application

```bash
npm install
npm run dev
``

## Build the web application

```bash
npm run lint
npm run build
``

The production web bundle is written to `dist/`.

## Windows desktop

Run the development application:

```bash
npm run desktop:dev
``

Create a Windows installer:

```bash
npm run desktop:build
``

The installer is written to `release/`. Electron uses context isolation, a sandboxed renderer, disabled Node integration, and restricted navigation.

## Android

The Android project is generated locally (it is intentionally not committed as generated build output):

```bash
npm run android:add
npm run android:sync
npm run android:open
``

Build a debug APK from Android Studio, or run:

```bash
cd android
./gradlew assembleDebug
``

The debug APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`.

### Firebase Android setup

1. In Firebase Console, open the Firebase project already used by this application.
2. Register an Android app with the exact application ID `com.itfix.assets`.
3. Download that app's `google-services.json` and place it in `android/app/`.
4. Keep the file out of source control. Do not commit service-account keys or private credentials.
5. Confirm the Firebase Authentication providers and authorized domains required by the project are enabled.

The Android wrapper currently uses the existing web Firebase authentication flow. Native Google sign-in still requires a dedicated Android OAuth/Firebase integration and must not be considered enabled merely because the APK builds.

## Environment and demo data

- Keep Firebase configuration and any API credentials in the appropriate environment configuration; never commit private keys.
- Demo offices, custody records and spare-part examples are seeded only in development mode. Production builds do not automatically write demo records into Firestore.
- The app connects to the Firebase project configured in its existing Firebase module. Review that configuration before deploying to a new Firebase project.

## CI artifacts

GitHub Actions workflows are provided for Windows installer and Android debug APK builds. A workflow definition is not proof that an artifact was successfully produced: check the corresponding Actions run and download its artifact after the job completes.
