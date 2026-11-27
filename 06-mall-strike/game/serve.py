"""Local server for the game (no caching, correct MIME types). Usage: python3 serve.py [port]"""
import http.server, socketserver, sys, os, functools
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                      ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".exr": "application/octet-stream", ".hdr": "application/octet-stream"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), functools.partial(H, directory=ROOT)) as s:
    print(f"http://localhost:{PORT}", flush=True)
    s.serve_forever()
