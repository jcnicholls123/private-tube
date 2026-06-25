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

## Users and Subscriptions

Set an initial admin account:

```yaml
environment:
  ADMIN_USERNAME: admin
  ADMIN_PASSWORD: change-me
  AUTH_ENABLED: "true"
```

Mount `/data` so local users and subscriptions survive container updates:

```yaml
volumes:
  - /mnt/Media/apps/private-tube:/data
```

Channel subscriptions periodically submit saved channel or playlist URLs to MeTube.

Retention cleanup only deletes files when `ALLOW_DELETE=true` and the media folder is mounted read-write.
