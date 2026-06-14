import asyncio
import json

import websockets
from deep_translator import GoogleTranslator
from websockets.server import WebSocketServerProtocol


# Supported Indian languages plus English.
# Format: key -> (display name, Google Translate language code)
LANGUAGES = {
    "english": ("English", "en"),
    "hindi": ("Hindi", "hi"),
    "kannada": ("Kannada", "kn"),
    "tamil": ("Tamil", "ta"),
    "telugu": ("Telugu", "te"),
    "malayalam": ("Malayalam", "ml"),
    "marathi": ("Marathi", "mr"),
    "bengali": ("Bengali", "bn"),
    "gujarati": ("Gujarati", "gu"),
    "punjabi": ("Punjabi", "pa"),
    "odia": ("Odia", "or"),
    "assamese": ("Assamese", "as"),
    "urdu": ("Urdu", "ur"),
    "sanskrit": ("Sanskrit", "sa"),
    "nepali": ("Nepali", "ne"),
    "sindhi": ("Sindhi", "sd"),
}

CONNECTED = set()


async def register(websocket: WebSocketServerProtocol):
    CONNECTED.add(websocket)
    print(f"Registered client {websocket.remote_address} ({len(CONNECTED)} connected)")


async def unregister(websocket: WebSocketServerProtocol):
    CONNECTED.discard(websocket)
    print(f"Unregistered client {websocket.remote_address} ({len(CONNECTED)} connected)")


async def broadcast(message: dict, sender: WebSocketServerProtocol = None):
    if not CONNECTED:
        return

    payload = json.dumps(message)
    await asyncio.gather(
        *[ws.send(payload) for ws in CONNECTED if ws != sender],
        return_exceptions=True,
    )


def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    src_code = LANGUAGES.get(source_lang, ("", "auto"))[1]
    tgt_code = LANGUAGES.get(target_lang, ("", "en"))[1]

    if src_code == tgt_code:
        return text

    translator = GoogleTranslator(source=src_code, target=tgt_code)
    return translator.translate(text)


async def handle_connection(websocket: WebSocketServerProtocol):
    await register(websocket)
    print(f"New connection from {websocket.remote_address}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type", "translate")

                if msg_type == "get_languages":
                    await websocket.send(json.dumps({
                        "type": "languages",
                        "languages": {k: v[0] for k, v in LANGUAGES.items()},
                    }))
                    continue

                if msg_type == "signal":
                    await broadcast({
                        "type": "signal",
                        "senderId": data.get("senderId"),
                        "signal": data.get("signal"),
                    }, sender=websocket)
                    continue

                text = data.get("text", "").strip()
                speaker = data.get("speaker", "person1")
                source_lang = data.get("sourceLang", "english")
                target_lang = data.get("targetLang", "english")

                if not text:
                    continue

                print(f"[{speaker}] {source_lang} -> {target_lang}: {text}")

                await broadcast({
                    "type": "translating",
                    "speaker": speaker,
                    "original": text,
                }, sender=None)

                loop = asyncio.get_event_loop()
                translation = await loop.run_in_executor(
                    None, translate_text, text, source_lang, target_lang
                )

                print(f"[{speaker}] Result: {translation}")

                # Send the translation result to ALL clients including the
                # sender, so the speaking user also sees their own message
                # and its translation appear in their chat.
                await broadcast({
                    "type": "translation",
                    "speaker": speaker,
                    "original": text,
                    "translated": translation,
                    "sourceLang": source_lang,
                    "targetLang": target_lang,
                }, sender=None)

            except json.JSONDecodeError:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON",
                }))
            except Exception as error:
                print(f"Translation error: {error}")
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"Translation failed: {error}",
                }))

    except websockets.exceptions.ConnectionClosed:
        print(f"Connection closed: {websocket.remote_address}")
    finally:
        await unregister(websocket)


async def main():
    host = "0.0.0.0"
    port = 8765
    print(f"Basha Bridge server starting on ws://{host}:{port}")
    print(f"Supported languages: {len(LANGUAGES)}")
    print("Using Google Translate through deep-translator")
    print("Waiting for connections...\n")

    async with websockets.serve(handle_connection, host, port):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
