#!/usr/bin/env python3
"""本地静态服务器：禁用缓存，补全 MIME 类型。用法：python3 serve.py [端口]"""
import http.server, socketserver, sys, os

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8317)
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                      '.hdr': 'application/octet-stream', '.wasm': 'application/wasm', '.json': 'application/json'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()
    def do_PUT(self):
        # 仅调试用（启动参数带 --shots 时才开）：把页面截图存到 shots/ 目录
        import re
        m = re.fullmatch(r'/__shot/([A-Za-z0-9_\-]+\.(?:jpg|png))', self.path)
        if '--shots' not in sys.argv or not m:
            self.send_error(403); return
        n = int(self.headers.get('Content-Length', 0))
        if n <= 0 or n > 30_000_000:
            self.send_error(400); return
        os.makedirs('shots', exist_ok=True)
        with open(os.path.join('shots', m.group(1)), 'wb') as f:
            f.write(self.rfile.read(n))
        self.send_response(204); self.end_headers()
    def log_message(self, fmt, *args):
        if args and isinstance(args[1], str) and args[1].startswith(('4', '5')):
            super().log_message(fmt, *args)

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == '__main__':
    import webbrowser
    open_browser = '--open' in sys.argv
    for port in range(PORT, PORT + 20):          # 端口被占用就顺延
        try:
            httpd = S(('127.0.0.1', port), H)
        except OSError:
            continue
        url = f'http://localhost:{port}/'
        print(f'暮色漂移 已启动：{url}（关闭此窗口即退出）', flush=True)
        if open_browser:
            webbrowser.open(url)
        with httpd:
            httpd.serve_forever()
        break
