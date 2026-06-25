# PrivateTube

A lightweight self-hosted YouTube-style web app for a local video library.

PrivateTube scans a mounted folder, treats the first folder level as channels, and serves a browse/search/watch interface. It is designed to sit next to MeTube, Pinchflat, or another downloader.

## TrueNAS Install

Use `truenas-compose.yml` as the YAML for a TrueNAS custom app.

Before deploying, edit:

```yaml
METUBE_URL: http://TRUENAS-IP:30094
```

and:

```yaml
- /mnt/Media/downloads/YouTube:/media:ro
```

to match your MeTube URL and video dataset.

Also change the initial admin password:

```yaml
ADMIN_USERNAME: admin
ADMIN_PASSWORD: change-me
RESET_ADMIN_PASSWORD: "false"
CAST_SECRET: change-this-too
```

If you cannot log in after changing the password, set this to `"true"` for one restart:

```yaml
RESET_ADMIN_PASSWORD: "true"
```

After logging in successfully, set it back to `"false"` and redeploy.

For Chromecast, set a LAN-reachable app URL:

```yaml
PUBLIC_URL: http://TRUENAS-IP:3020
```

PrivateTube stores local users and channel subscriptions in:

```yaml
- /mnt/Media/apps/private-tube:/data
```

Create that dataset/folder before deploying.

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

Chromecast devices fetch media directly from PrivateTube, so `PUBLIC_URL` must be reachable from the Chromecast on your LAN.

## Development

The app source lives in `private-tube/`.
