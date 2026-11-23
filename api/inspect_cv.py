"""Native Python Vercel Function for OpenCV sprite inspection.

Next.js POST /api/inspect forwards the JSON request here. Python packages
are installed from requirements.txt for this function, not into Node.js.
"""
import base64
import hmac
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

MAX_REQUEST_BYTES = 12 * 1024 * 1024
ALLOWED_GAMES = {"chainsaw-dance", "friday-night-funkin"}


def authenticated(value: str) -> bool:
    username = os.environ.get("INSPECT_BASIC_USER", "")
    password = os.environ.get("INSPECT_BASIC_PASSWORD", "")
    if not username or not password or not value.startswith("Basic "):
        return False
    try:
        decoded = base64.b64decode(value[6:], validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return False
    supplied_user, separator, supplied_password = decoded.partition(":")
    return bool(separator) and hmac.compare_digest(
        supplied_user, username
    ) and hmac.compare_digest(supplied_password, password)


class handler(BaseHTTPRequestHandler):
    def reply(self, code: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        if not authenticated(self.headers.get("Authorization", "")):
            self.reply(401, {"error": "Accesso non autorizzato"})
            return

        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.reply(400, {"error": "Content-Length non valido"})
            return
        if size <= 0 or size > MAX_REQUEST_BYTES:
            self.reply(413, {"error": "Snapshot troppo grande o vuoto"})
            return

        try:
            payload = json.loads(self.rfile.read(size))
            game = payload.get("game")
            if game not in ALLOWED_GAMES:
                self.reply(400, {"error": "Gioco sconosciuto"})
                return
            image = payload.get("image")
            if not isinstance(image, str) or not image.startswith("data:image/"):
                self.reply(400, {"error": "Snapshot mancante"})
                return

            from scripts.inspect_match import analyze

            result = analyze({
                "gameDir": str(ROOT / "public" / "games" / game),
                "image": image,
                "only": [
                    str(x) for x in (payload.get("only") or [])[:64]
                ],
            })
            self.reply(200, result)
        except Exception as exc:
            # I log Vercel contengono il traceback, non la risposta HTTP.
            traceback.print_exc()
            self.reply(500, {"error": f"Ispezione non riuscita: {type(exc).__name__}"})

    def do_GET(self) -> None:
        self.reply(405, {"error": "Usa POST /api/inspect"})

