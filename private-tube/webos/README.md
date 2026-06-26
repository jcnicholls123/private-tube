# NichTube LG webOS App

This is a small LG webOS launcher for PrivateTube TV mode. It stores your internal PrivateTube URL on the TV, shows a short launch countdown, and opens the remote-friendly `/tv.html` interface full-screen.

Use your internal URL, for example:

```text
http://10.69.24.3:3020
```

## Package

Install the LG webOS CLI, then from this folder run:

```bash
ares-package .
```

That creates an `.ipk` file.

## Install On TV

Enable Developer Mode on the LG TV, pair it with the webOS CLI, then install:

```bash
ares-setup-device
ares-install --device YOUR_TV_NAME com.nichhome.privatetube_0.1.1_all.ipk
ares-launch --device YOUR_TV_NAME com.nichhome.privatetube
```

## Notes

- The TV app is for local/internal playback and does not use Chromecast.
- It opens `http://YOUR_PRIVATE_TUBE:3020/tv.html`.
- Use Change to edit the saved server URL, Clear to remove it, or Open to launch immediately.
- Reinstall the `.ipk` only when files in this `webos` folder change.
- If WebM playback is unreliable on your TV, use MeTube settings that save MP4/H.264 instead.
