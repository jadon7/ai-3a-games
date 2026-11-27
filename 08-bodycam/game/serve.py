"""游戏的本地服务器（不缓存、MIME 正确）。用法：python3 serve.py [端口]
开发用：POST /__shot/<名字> 会把请求体（PNG）存到 _shots/ 下，用来和影片逐帧比对。
"""
import http.server, socketserver, sys, os, functools, re

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
ROOT = os.path.dirname(os.path.abspath(__file__))


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                      ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
                      ".hdr": "application/octet-stream", ".bin": "application/octet-stream"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        m = re.match(r"^/__shot/([A-Za-z0-9_\-]+)$", self.path)
        if not m:
            self.send_error(404); return
        n = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(n)
        os.makedirs(os.path.join(ROOT, "_shots"), exist_ok=True)
        ct = self.headers.get("Content-Type", "")
        ext = ".txt" if ct.startswith("text/") else (".jpg" if ct.startswith("image/jpeg") else ".png")
        with open(os.path.join(ROOT, "_shots", m.group(1) + ext), "wb") as f:
            f.write(data)
        self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), functools.partial(H, directory=ROOT)) as s:
    print(f"http://localhost:{PORT}", flush=True)
    s.serve_forever()
