# Basha Bridge

Mobile-first live call and chat translation for two people speaking different languages.

## What it does

- Translates typed messages between two selected languages.
- Uses browser speech recognition for voice-to-text where supported.
- Provides a simple audio call connection between two open clients on the same bridge server.
- Can be installed from the browser as a PWA on supported mobile browsers.

## Run locally

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the bridge server:

```bash
python server.py
```

Open `index.html` with a local web server. For example:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

For phone testing, open the same address using your computer's local network IP, for example:

```text
http://192.168.1.10:8000
```

Keep `server.py` running while using the app. The browser connects to the websocket bridge on port `8765`.

## Notes

Real phone-call interception is restricted by iOS and Android. This app works as an in-app translated call and chat surface: both users open the app, choose languages, then speak or type inside it.
