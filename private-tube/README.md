# PrivateTube App Source

This folder contains the PrivateTube server, browser UI, TV UI, and TV wrapper app source.

## Version

PrivateTube server version: `0.1.6`

TV wrapper versions:

- LG webOS: `0.1.1`
- Android TV: `0.1.1`

## Docker Image

Use the published image:

```text
ghcr.io/jcnicholls123/private-tube:latest
```

The GitHub workflow also publishes:

```text
ghcr.io/jcnicholls123/private-tube:truenas
```

Both tags are built from the same source.

## MeTube Requirement

PrivateTube is designed to run beside MeTube. MeTube downloads videos into a shared folder, and PrivateTube reads that folder as `/media`.

The recommended Docker setup mounts the same host folder as:

```yaml
metube:
  volumes:
    - ./media:/downloads

private-tube:
  volumes:
    - ./media:/media:ro
```

Set:

```yaml
METUBE_URL: http://metube:8081
```

## Local Development

```bash
npm start
```

By default it scans `./media`. Set custom folders with environment variables:

```bash
MEDIA_DIR=/path/to/videos DATA_DIR=/path/to/data npm start
```

Local development needs Node 24 or newer because the app uses the built-in `node:sqlite` module.

## TV Interfaces

- Browser/mobile UI: `/`
- TV UI: `/tv.html`
- LG webOS wrapper: `webos/`
- Android TV wrapper: `android-tv/`

See the top-level `README.md` for installation walkthroughs for TrueNAS, Synology, and Windows Docker.
