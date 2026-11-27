from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import os
import subprocess
import sys

root = Path(__file__).resolve().parent
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"Selva 47  {url}\n按 Control-C 可以关闭游戏。", flush=True)
    if "--no-browser" in sys.argv:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    else:
        with TemporaryDirectory(prefix=".selva-session-", dir=root) as session:
            profile = Path(session)
            temporary_files = profile / "tmp"
            temporary_files.mkdir()
            environment = dict(os.environ, TMPDIR=str(temporary_files) + "/")
            Thread(target=server.serve_forever, daemon=True).start()
            browser = subprocess.Popen([
                chrome, f"--app={url}", f"--user-data-dir={profile / 'profile'}",
                f"--disk-cache-dir={profile / 'cache'}", "--disk-cache-size=33554432",
                "--no-first-run", "--no-default-browser-check", "--disable-background-mode",
                "--disable-sync", "--disable-component-update", "--disable-background-networking",
                "--disable-breakpad", "--disable-crash-reporter", "--window-size=1536,864",
            ], env=environment)
            try:
                browser.wait()
            except KeyboardInterrupt:
                pass
            finally:
                if browser.poll() is None:
                    browser.terminate()
                    browser.wait()
                server.shutdown()
