# NichTube Android TV App

This is a native Android TV wrapper for the PrivateTube TV interface. It stores your internal server URL, shows a short launch countdown, and opens `/tv.html` in a fullscreen WebView.

Use your internal URL, for example:

```text
http://10.69.24.3:3020
```

## Build

Open this `android-tv` folder in Android Studio, let Gradle sync, then build the `app` module.

The project uses:

- Java Activity, no Kotlin requirement.
- Android WebView for the hosted TV interface.
- Leanback launcher category so it appears on Android TV.
- Cleartext HTTP enabled for local/internal servers.

## Install On Android TV

From Android Studio, select your Android TV device and run the `app` configuration.

Or build an APK and install with ADB:

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Notes

- The Android app opens `http://YOUR_PRIVATE_TUBE:3020/tv.html`.
- Use Change to edit the saved server URL, Clear to remove it, or Open to launch immediately.
- Server-side TV UI updates still come from the PrivateTube container; rebuild the APK only when files in this `android-tv` folder change.
