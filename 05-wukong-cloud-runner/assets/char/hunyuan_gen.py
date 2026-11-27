"""备用通道：Hugging Face 上的开源 Hunyuan3D-2.1，图转带贴图的 3D 模型。"""
import sys, shutil, time, os
from gradio_client import Client, handle_file
img, outdir = sys.argv[1], sys.argv[2]
t0 = time.time()
c = Client('tencent/Hunyuan3D-2.1', verbose=False, httpx_kwargs={'timeout': 900})
print('client ok', flush=True)
r = c.predict(handle_file(img), None, None, None, None, 30, 5.0, 1234, 384, True, 8000, False, api_name='/generation_all')
print('RESULT', [x if not isinstance(x, str) or len(x) < 300 else x[:120] for x in r], flush=True)
for i, x in enumerate(r[:2]):
    path = x.get('path') if isinstance(x, dict) else x
    if isinstance(path, str) and os.path.exists(path):
        dst = os.path.join(outdir, f'wukong_hunyuan_{i}' + os.path.splitext(path)[1])
        shutil.copy(path, dst)
        print('SAVED', dst, flush=True)
print('done %.0fs' % (time.time() - t0), flush=True)
