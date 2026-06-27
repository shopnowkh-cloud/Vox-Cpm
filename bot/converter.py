import os
import subprocess
import tempfile
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 8000))

class ConvertHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/convert":
            self.send_response(404)
            self.end_headers()
            return

        params = parse_qs(parsed.query)
        wav_url = params.get("url", [None])[0]
        if not wav_url:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Missing url param")
            return

        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
                wav_path = tmp_wav.name
            with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp_ogg:
                ogg_path = tmp_ogg.name

            urllib.request.urlretrieve(wav_url, wav_path)

            subprocess.run(
                ["ffmpeg", "-y", "-i", wav_path,
                 "-c:a", "libopus", "-b:a", "64k", "-vbr", "on",
                 ogg_path],
                check=True,
                capture_output=True,
            )

            with open(ogg_path, "rb") as f:
                ogg_bytes = f.read()

            self.send_response(200)
            self.send_header("Content-Type", "audio/ogg")
            self.send_header("Content-Length", str(len(ogg_bytes)))
            self.end_headers()
            self.wfile.write(ogg_bytes)

        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())
        finally:
            for p in [wav_path, ogg_path]:
                try:
                    os.unlink(p)
                except Exception:
                    pass

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

if __name__ == "__main__":
    print(f"Converter running on port {PORT}")
    HTTPServer(("0.0.0.0", PORT), ConvertHandler).serve_forever()
