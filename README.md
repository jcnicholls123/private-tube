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

The app listens on:

```text
http://TRUENAS-IP:3020
```

## Important Playback Note

Browsers do not reliably play `.mkv` directly. PrivateTube indexes MKV files, but for browser playback use `.mp4` or `.webm` where possible.

## Development

The app source lives in `private-tube/`.

