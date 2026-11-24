#!/bin/zsh
cd -- "${0:A:h}" || exit 1

python3 - <<'PY'
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import subprocess

url = "http://127.0.0.1:8000/"
try:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), SimpleHTTPRequestHandler)
except OSError as error:
    raise SystemExit(f"8000번 포트를 열 수 없어요. 기존 게임 실행 창을 확인해 주세요. ({error})")

with server:
    print(f"Fruit Clicker: {url}", flush=True)
    print("게임을 닫을 때 이 터미널 창을 닫거나 Control+C를 누르세요.", flush=True)
    subprocess.run(["open", url], check=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
PY
