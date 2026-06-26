# PrivateTube

PrivateTube is a self-hosted YouTube-style library for videos downloaded by MeTube. It scans a shared downloads folder, groups videos by channel, adds a browser/TV interface, saves watch progress, and can submit channel or playlist URLs back to MeTube.

## Versions

- PrivateTube server: `0.1.6`
- Docker image: `ghcr.io/jcnicholls123/private-tube:latest`
- Docker alias: `ghcr.io/jcnicholls123/private-tube:truenas`
- LG webOS app: `0.1.1`
- Android TV app: `0.1.1`

## Required: MeTube

PrivateTube expects MeTube to be installed and writing videos into a folder that PrivateTube can read.

Use the same host folder for:

- MeTube `/downloads`
- PrivateTube `/media`

PrivateTube can browse an existing folder by itself, but downloads, subscriptions, and the intended workflow need MeTube.

## Ports

- PrivateTube: `3020`
- MeTube: `30094` mapped to MeTube container port `8081`

Open PrivateTube at:

```text
http://SERVER-IP:3020
```

Open MeTube at:

```text
http://SERVER-IP:30094
```

## TrueNAS Scale

Use the included file:

```text
truenas-compose.yml
```

Before deploying, edit these paths:

```yaml
- /mnt/Media/downloads/YouTube:/downloads
- /mnt/Media/downloads/YouTube:/media:ro
- /mnt/Media/apps/private-tube:/data
```

The downloads path must be the same dataset for MeTube and PrivateTube.

Deploy as a custom Compose app. PrivateTube will start at:

```text
http://TRUENAS-IP:3020
```

MeTube will start at:

```text
http://TRUENAS-IP:30094
```

## Synology Container Manager

Use the included file:

```text
synology-compose.yml
```

Edit the paths for your NAS:

```yaml
- /volume1/docker/metube/downloads:/downloads
- /volume1/docker/metube/downloads:/media:ro
- /volume1/docker/private-tube/data:/data
```

In Synology Container Manager:

1. Create a new Project.
2. Paste or upload `synology-compose.yml`.
3. Update the paths if needed.
4. Deploy the project.
5. Open `http://SYNOLOGY-IP:3020`.

If your Synology user/group differs, update:

```yaml
UID: "1026"
GID: "100"
```

## Windows Docker Desktop

Use the included file:

```text
windows-compose.yml
```

Create these folders first:

```text
C:\PrivateTube\downloads
C:\PrivateTube\data
```

From this repo folder, run:

```powershell
docker compose -f windows-compose.yml up -d
```

Then open:

```text
http://localhost:3020
```

MeTube is at:

```text
http://localhost:30094
```

## First Run

1. Open PrivateTube.
2. Complete the setup screen to create the first admin user.
3. Confirm MeTube URL is set to:

```text
http://metube:8081
```

The compose files already set `METUBE_URL` to that internal Docker address.

PrivateTube stores users, password hashes, subscriptions, settings, watch progress, thumbnails, and app secrets in:

```text
/data/private-tube.sqlite
```

Keep `/data` mounted to persistent storage.

## Updating

Pull the newest image and recreate the stack:

```bash
docker compose pull
docker compose up -d
```

For TrueNAS/Synology, use the platform UI to pull/redeploy the project.

## TV Apps

The TV apps are wrappers around the hosted TV interface:

```text
http://SERVER-IP:3020/tv.html
```

### LG webOS

Source lives in:

```text
private-tube/webos
```

The local package is:

```text
private-tube/webos/com.nichhome.privatetube_0.1.1_all.ipk
```

### Android TV

Source lives in:

```text
private-tube/android-tv
```

Open that folder in Android Studio and build the `app` module.

## Playback Notes

Use MP4/H.264 or WebM for best browser and TV playback. MKV files may index correctly but often do not play reliably in browsers or TV WebViews.

## Retention Deletes

Retention delete is off by default:

```yaml
ALLOW_DELETE: "false"
```

Only set it to `true` if you want PrivateTube to delete old media files. If you enable it, mount the media folder read-write instead of `:ro`.
