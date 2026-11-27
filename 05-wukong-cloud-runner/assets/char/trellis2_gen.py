"""用 Hugging Face 上的开源 TRELLIS.2 把一张定妆图转成带贴图的 GLB（静态素材）。
用法：python trellis2_gen.py <图片路径> <输出glb路径> [resolution=1024] [seed=0]
"""
import sys, shutil, time
from gradio_client import Client, handle_file

img, out = sys.argv[1], sys.argv[2]
res = sys.argv[3] if len(sys.argv) > 3 else '1024'
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 0

t0 = time.time()
c = Client('microsoft/TRELLIS.2', verbose=False, httpx_kwargs={'timeout': 600})
print('client ok', flush=True)
c.predict(api_name='/start_session')
print('session ok', flush=True)
pre = c.predict(handle_file(img), api_name='/preprocess_image')
pre_path = pre['path'] if isinstance(pre, dict) else pre
print('preprocessed ->', pre_path, flush=True)
c.predict(handle_file(pre_path), seed, res, api_name='/image_to_3d')
print('image_to_3d done %.0fs' % (time.time() - t0), flush=True)
r = c.predict(500000, 4096, api_name='/extract_glb')
print('extract ->', r, flush=True)
glb = r[0] if isinstance(r, (list, tuple)) else r
if isinstance(glb, dict):
    glb = glb.get('path') or glb.get('value')
shutil.copy(glb, out)
print('SAVED', out, '%.0fs' % (time.time() - t0), flush=True)
