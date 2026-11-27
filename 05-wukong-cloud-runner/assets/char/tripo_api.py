"""Tripo v3 OpenAPI 的最小客户端（密钥从环境变量 TRIPO_KEY_FILE 指向的文件读取，不进工程）。
用法：
  python tripo_api.py balance
  python tripo_api.py upload <图片>
  python tripo_api.py post <endpoint> '<json>'          例：post /generation/image-to-model '{...}'
  python tripo_api.py wait <task_id> [超时秒]
  python tripo_api.py get <task_id>
  python tripo_api.py download <url> <保存路径>
"""
import sys, os, json, time
import httpx

BASE = 'https://openapi.tripo3d.ai/v3'


def _key():
    with open(os.environ['TRIPO_KEY_FILE']) as f:
        return f.read().strip()


def _client():
    return httpx.Client(timeout=120, headers={'Authorization': 'Bearer ' + _key()})


def balance():
    with _client() as c:
        return c.get(BASE + '/account/balance').json()


def upload(path):
    with _client() as c, open(path, 'rb') as f:
        r = c.post(BASE + '/files', files={'file': (os.path.basename(path), f)})
    return r.json()


def post(endpoint, body):
    with _client() as c:
        return c.post(BASE + endpoint, json=body).json()


def get(task_id):
    with _client() as c:
        return c.get(BASE + '/tasks/' + task_id).json()


def wait(task_id, timeout=1500, every=6):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        try:
            r = get(task_id)
        except Exception as e:
            print('poll error', repr(e)[:120], flush=True)
            time.sleep(every)
            continue
        d = r.get('data', {})
        st = (d.get('status'), d.get('progress'))
        if st != last:
            print('status', st, '%.0fs' % (time.time() - t0), flush=True)
            last = st
        if d.get('status') in ('success', 'failed', 'cancelled', 'banned', 'expired', 'unknown'):
            return r
        time.sleep(every)
    return {'code': -1, 'message': 'timeout'}


def download(url, dst):
    with httpx.Client(timeout=600, follow_redirects=True) as c:
        with c.stream('GET', url) as r:
            r.raise_for_status()
            with open(dst, 'wb') as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
    return os.path.getsize(dst)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'balance':
        print(json.dumps(balance()))
    elif cmd == 'upload':
        print(json.dumps(upload(sys.argv[2])))
    elif cmd == 'post':
        print(json.dumps(post(sys.argv[2], json.loads(sys.argv[3])), ensure_ascii=False))
    elif cmd == 'get':
        print(json.dumps(get(sys.argv[2]), ensure_ascii=False))
    elif cmd == 'wait':
        print(json.dumps(wait(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1500), ensure_ascii=False))
    elif cmd == 'download':
        print('saved', download(sys.argv[2], sys.argv[3]), 'bytes')
