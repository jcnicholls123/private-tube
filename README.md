# PrivateTube

A lightweight self-hosted YouTube-style web app for a local video library.

PrivateTube scans a mounted folder, treats the first folder level as channels, and serves a browse/search/watch interface. It is designed to sit next to MeTube, Pinchflat, or another downloader.

## TrueNAS Install

Use `truenas-compose.yml` as the YAML for a TrueNAS custom app.

Before deploying, edit the media path:

```yaml
- /mnt/Media/downloads/YouTube:/media:ro
```

to match your video dataset.

PrivateTube stores local users, channel subscriptions, settings, password hashes, and app secrets in:

```yaml
- /mnt/Media/apps/private-tube:/data
```

Create that dataset/folder before deploying.

On first launch, PrivateTube opens a setup screen where you create the admin user. After that, use the in-app Settings page to set the MeTube URL and optional Chromecast public URL.

Auth data, password hashes, subscriptions, settings, and app secrets are stored in:

```text
/data/private-tube.sqlite
```

If you lock yourself out, you can still use emergency environment variables:

```yaml
ADMIN_USERNAME: admin
ADMIN_PASSWORD: temporary-password
RESET_ADMIN_PASSWORD: "true"
```

Remove them or set `RESET_ADMIN_PASSWORD` back to `"false"` after logging in.

The app listens on:

```text
http://TRUENAS-IP:3020
```

## Important Playback Note

Browsers do not reliably play `.mkv` directly. PrivateTube indexes MKV files, but for browser playback use `.mp4` or `.webm` where possible.

## Subscriptions and Retention

PrivateTube can save channel or playlist URLs and periodically submit them to MeTube. MeTube still performs the actual download.

Retention cleanup is disabled by default:

```yaml
ALLOW_DELETE: "false"
```

To let retention delete old files, change it to:

```yaml
ALLOW_DELETE: "true"
```

and mount media read-write:

```yaml
- /mnt/Media/downloads/YouTube:/media
```

## Chromecast

The watch page includes native Chromecast support. Use WebM or MP4 files for best playback support.

Chromecast devices fetch media directly from PrivateTube. By default, PrivateTube uses the address you opened it with. If your Chromecast needs a different LAN URL, set it in the in-app Settings page.

Google Cast from the web works best from Chrome or Edge on desktop/Android. iPhone Safari and iPhone home-screen web apps do not support the Google Cast Web Sender SDK; use AirPlay from the iPhone video controls where available.

## iPhone Home Screen

PrivateTube includes web app metadata and icons. On iPhone:

1. Open PrivateTube in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Launch PrivateTube from the new home-screen icon.

## Thumbnails

PrivateTube uses sidecar images first, for example:

```text
Video title.webm
Video title.jpg
```

If no sidecar image exists, it generates a thumbnail with FFmpeg and stores it in:

```text
/data/thumbnails
```

Optional environment values:

```yaml
THUMBNAILS_ENABLED: "true"
THUMBNAIL_TIME: "00:00:05"
```

## Development

The app source lives in `private-tube/`.
