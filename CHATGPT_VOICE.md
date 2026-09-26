# HA3D ChatGPT Voice bridge

Test build based on the stable HA3D `0.2.59` code line.

## Goal

Keep the HA3D dashboard open and listening for a wake word. When the wake word is detected, HA3D releases the dashboard microphone and hands off to ChatGPT Voice.

No OpenAI API key is used by this bridge.

## Wake-word sources

The bridge uses the first available source:

1. **Voice Satellite**: if `window.__vsSession` is present, HA3D hooks the exact `WAKE_WORD_DETECTED` state.
2. **Native Home Assistant Assist pipeline**: otherwise HA3D captures microphone PCM and streams it to the official `assist_pipeline/run` WebSocket pipeline with `start_stage: wake_word`.
3. **Assist Satellite state fallback**: used only when an existing browser satellite entity is available and neither of the sources above is active.

For the native HA pipeline, the selected/preferred Assist pipeline must have a working wake-word engine configured.

## ChatGPT handoff

On iPhone/iPad the default launcher is the iOS Shortcut URL scheme using a Shortcut named **HA Voz**. The Shortcut should contain the ChatGPT action **Iniciar conversa por voz**.

The launcher can be changed from the HA3D floating ChatGPT control to:

- iOS Shortcut
- ChatGPT app (`chatgpt://`)
- ChatGPT Web
- Custom URL

The dashboard microphone is released before the handoff so ChatGPT Voice can acquire it. When the user returns to HA3D, wake listening is re-armed automatically.

## First run

1. Open HA3D in a secure context (HTTPS is required by browsers for microphone capture).
2. Allow microphone access.
3. Open the ChatGPT Voice settings control in HA3D.
4. Confirm the launcher/Shortcut name.
5. Tap **Ativar wake** once if the browser requires a user gesture for audio capture.
6. Use **Testar GPT** to validate the ChatGPT handoff before testing the wake word.

## Safety / rollback

This work lives only on branch `feature/chatgpt-voice-from-0.2.59`. It does not modify the current `main` branch. Removing the branch or switching back to the stable 0.2.59 build removes the feature completely.
