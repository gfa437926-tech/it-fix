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
```

## Build the web application

```bash
npm run lint
npm run build
```

The production web bundle is written to `dist/`.

## Windows desktop

Run the development application:

```bash
npm run desktop:dev
```

Create a Windows installer:

```bash
npm run desktop:build
```

The installer is written to `release/`. Electron uses context isolation, a sandboxed renderer, disabled Node integration, and restricted navigation.

## Android

The Android project is generated locally (it is intentionally not committed as generated build output):

```bash
npm run android:add
npm run android:sync
npm run android:open
```

Build a debug APK from Android Studio, or run:

```bash
cd android
./gradlew assembleDebug
```

The debug APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`.

Google Sheets synchronization writes a complete snapshot of the current assets and custody cards. Newly created export tabs are provisioned with 1,000 rows and 20 columns so the full 20-column custody form fits without manual resizing. Values are sent using the Sheets API `RAW` input mode so user-entered text is preserved literally rather than interpreted as spreadsheet formulas. After a successful write, the service clears trailing rows from older, larger exports so records deleted from the app are not left visible as stale spreadsheet entries. Manual linking verifies access and the two required worksheet names before saving the connection; linking alone is not reported as a successful synchronization.

### Firebase Android setup

1. In Firebase Console, open the Firebase project already used by this application.
2. Register an Android app with the exact application ID `com.itfix.assets`.
3. Download that app's `google-services.json` and place it in `android/app/`.
4. Keep the file out of source control. Do not commit service-account keys or private credentials.
5. Confirm the Firebase Authentication providers and authorized domains required by the project are enabled.

Google sign-in now uses the native Capacitor Firebase Authentication plugin on Android, then exchanges the returned Google ID token with the existing Firebase JavaScript Auth instance. This keeps the JavaScript Firestore and Storage clients authenticated in the same session. Web browsers continue to use the existing Google popup flow.

Before native Google sign-in can work on a device:

1. Add the Android app in Firebase using package ID `com.itfix.assets`.
2. Enable Google under Firebase Authentication → Sign-in method.
3. Add the app's debug and release SHA-1 fingerprints in Firebase project settings. For Play distribution, also add the Play App Signing SHA-1.
4. Download the refreshed `google-services.json` into `android/app/` after adding the fingerprints.
5. In `android/variables.gradle`, enable the Google provider for the plugin by adding `rgcfaIncludeGoogle = true` and `androidxCredentialsVersion = '1.3.0'` inside the existing `ext { ... }` block.
6. Run `npm run android:sync` again, then build and test on a real Android device.
7. For GitHub Actions APK builds that must support native sign-in, add a repository Actions secret named `FIREBASE_ANDROID_CONFIG` containing the **base64-encoded contents** of `google-services.json`. The workflow writes it into the generated Android app only during the build and conditionally configures the Google Services Gradle plugin; neither the JSON file nor credentials are committed.

The native sign-in flow deliberately discards the plugin's access token after exchanging the ID token into Firebase JS Auth; that token is not assumed to include Sheets/Drive scopes. The primary-controller UI also trusts only the UID recorded in `system_settings/controller`, matching the Firestore authorization rule.

The native Google provider is configured in `capacitor.config.ts`. The Firebase Authentication plugin signs in natively and the app bridges the Google ID token into the Firebase JS SDK. Google Sheets API access still requires a separate OAuth access-token/scope flow; a successful Firebase sign-in alone does not grant Sheets API access. Until that native scope-consent flow is implemented, the app deliberately reports that Sheets/Drive authorization is unavailable on Android rather than passing an access token that may not carry the required scopes. The existing web popup continues to request the configured Sheets and Drive scopes.

## Firestore security rules

The repository's `firestore.rules` now protects the initial controller bootstrap and prevents ordinary users from assigning themselves the `admin` role. Only the recorded primary controller can change controller identity or write system settings; users can update only basic profile fields on their own profile.

Review the rules against the live Firebase project before deployment. To deploy them after selecting the correct Firebase project in the Firebase CLI, run:

```bash
firebase deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT_ID
```

Do not skip the project ID check: deploying rules to the wrong Firebase project can affect another application. The rules file in GitHub is not active in Firebase until this deployment succeeds.

## Environment and demo data

- Keep Firebase configuration and any API credentials in the appropriate environment configuration; never commit private keys.
- Demo offices, custody records and spare-part examples are seeded only in development mode. Production builds do not automatically write demo records into Firestore.
- The app connects to the Firebase project configured in its existing Firebase module. Review that configuration before deploying to a new Firebase project.

## CI artifacts

GitHub Actions workflows are provided for Windows installer and Android debug APK builds. A workflow definition is not proof that an artifact was successfully produced: check the corresponding Actions run and download its artifact after the job completes.


### Native Google sign-in implementation

- Uses `@capacitor-firebase/authentication` 7.x to match Capacitor 7.
- Android native Google sign-in is exchanged into the Firebase JS Auth session using `signInWithCredential`.
- Native Firebase JS Auth uses IndexedDB persistence so the session survives app restarts.
- Web sign-in remains on Firebase's existing popup flow.
- The native Firebase setup is incomplete until the Firebase Android app, SHA-1 fingerprints, and `google-services.json` are configured as described above.
