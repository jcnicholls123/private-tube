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
