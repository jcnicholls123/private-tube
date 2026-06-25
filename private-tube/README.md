# PrivateTube

A lightweight self-hosted YouTube-style web app for a local video library.

It scans a mounted folder, treats the first folder level as channels, and serves a browse/search/watch interface.

## Run Locally

```bash
npm start
```

By default it scans `./media`. Set a custom folder with:

```bash
MEDIA_DIR=/path/to/videos npm start
```

## TrueNAS / Docker

Use the included `docker-compose.yml` as a starting point.

```yaml
volumes:
  - /mnt/Media/downloads/YouTube:/media:ro
```

Set that host path to the folder where MeTube, Pinchflat, or Tube Archivist places videos.

## Folder Layout

```text
/media
  Channel Name
    Video title.mkv
    Video title.jpg
  Another Channel
    2026-06-25 - Another video.mp4
```

If an image with the same filename exists beside the video, it is used as the thumbnail.

## Optional MeTube Integration

Set `METUBE_URL` to allow the sidebar form to submit URLs to MeTube:

```yaml
environment:
  METUBE_URL: http://TRUENAS-IP:30094
```

## First Run

PrivateTube creates the first admin account in the browser. Deploy the app, open it, and complete the setup screen.

No admin password or cast secret is required in YAML.

## Users and Subscriptions

Users are managed from the in-app Users page. Emergency password reset is still available with env vars:

```yaml
environment:
  ADMIN_USERNAME: admin
  ADMIN_PASSWORD: temporary-password
  RESET_ADMIN_PASSWORD: "true"
```

Set `RESET_ADMIN_PASSWORD` back to `"false"` after logging in.

Mount `/data` so local users and subscriptions survive container updates:

```yaml
volumes:
  - /mnt/Media/apps/private-tube:/data
```

PrivateTube stores users, password hashes, subscriptions, settings, and app secrets in `/data/private-tube.sqlite`.

Channel subscriptions periodically submit saved channel or playlist URLs to MeTube.

Retention cleanup only deletes files when `ALLOW_DELETE=true` and the media folder is mounted read-write.

## Chromecast

By default, PrivateTube uses the address you opened it with. If Chromecast needs a different LAN URL, set it in the in-app Settings page.

Use WebM or MP4 files for best playback support.

## Thumbnails

Sidecar thumbnails are preferred:

```text
Video title.webm
Video title.jpg
```

When no sidecar image exists, PrivateTube generates thumbnails with FFmpeg into `/data/thumbnails`.

Optional env values:

```yaml
THUMBNAILS_ENABLED: "true"
THUMBNAIL_TIME: "00:00:05"
```
