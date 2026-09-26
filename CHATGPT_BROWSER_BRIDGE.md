# HA3D ChatGPT Browser Bridge (v0.2.66-beta.3)

This beta removes the iOS Shortcut / ChatGPT app handoff from the experimental voice path.

## Architecture

`iPad microphone -> HA3D -> Home Assistant wake word -> HA3D ChatGPT Audio Bridge -> PulseAudio virtual microphone -> Chromium add-on -> chatgpt.com Voice`

The Chromium add-on itself is kept mounted in HA3D through Home Assistant Supervisor ingress so the remote browser session can remain alive and its web audio can continue playing on the client device.

## Required add-ons

1. **HA3D ChatGPT Audio Bridge** from the existing `Jackson-Gomes/home-assistant-chatgpt-connector` add-on repository.
2. **Chromium** from `https://github.com/Mincka/ha-addons`.
3. `openWakeWord` must be running in Home Assistant for wake detection.

## First-time setup

1. Install/start the audio bridge add-on.
2. Install/start Chromium.
3. In HA3D open ChatGPT settings and choose **Preparar Chromium**. HA3D sets Chromium's app URL to `https://chatgpt.com/`, enables web audio and restarts Chromium.
4. Choose **Abrir ChatGPT no HA**, sign in to ChatGPT once and start Voice once. Grant microphone permission in the remote Chromium if asked. The profile is persistent in the Chromium add-on.
5. Return to HA3D, activate wake and say the configured wake word.

The microphone stream is not released when the wake word fires. HA3D switches that same stream from the Home Assistant wake pipeline to the virtual Chromium microphone, avoiding the iOS app/Shortcut round trip.

This is an experimental proof of concept and intentionally stays on a prerelease branch based on HA3D v0.2.59.
