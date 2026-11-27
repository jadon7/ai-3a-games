"""备用图转 3D 通道。用法：python gen_alt.py <trellis|hunyuan2|triposg> <img> <outdir>"""
import sys, shutil, time, os
from gradio_client import Client, handle_file
mode, img, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
t0 = time.time()

def save(x, name):
    path = x.get('path') if isinstance(x, dict) else x
    if isinstance(path, str) and os.path.exists(path):
        dst = os.path.join(outdir, name + os.path.splitext(path)[1])
        shutil.copy(path, dst); print('SAVED', dst, os.path.getsize(dst), flush=True)

try:
    if mode == 'trellis':
        c = Client('trellis-community/TRELLIS', verbose=False, httpx_kwargs={'timeout': 900})
        c.predict(api_name='/start_session')
        pre = c.predict(handle_file(img), api_name='/preprocess_image')
        pre_path = pre['path'] if isinstance(pre, dict) else pre
        print('pre ok', flush=True)
        r = c.predict(handle_file(pre_path), [], 0, 7.5, 12, 3.0, 12, 'stochastic', 0.90, 2048, api_name='/generate_and_extract_glb')
        print('R', str(r)[:300], flush=True)
        save(r[1], 'wukong_trellis1'); save(r[2], 'wukong_trellis1_dl')
    elif mode == 'hunyuan2':
        c = Client('tencent/Hunyuan3D-2', verbose=False, httpx_kwargs={'timeout': 900})
        r = c.predict(None, handle_file(img), None, None, None, None, 30, 5.0, 1234, 384, True, 8000, False, api_name='/generation_all')
        print('R', str(r)[:300], flush=True)
        save(r[0], 'wukong_hy2_shape'); save(r[1], 'wukong_hy2_tex')
    elif mode == 'triposg':
        c = Client('VAST-AI/TripoSG', verbose=False, httpx_kwargs={'timeout': 900})
        c.predict(api_name='/start_session')
        seg = c.predict(handle_file(img), api_name='/run_segmentation')
        seg_path = seg['path'] if isinstance(seg, dict) else seg
        print('seg ok', flush=True)
        glb = c.predict(handle_file(seg_path), 0, 50, 7.0, False, 300000, api_name='/image_to_3d')
        save(glb, 'wukong_triposg_shape')
        gp = glb.get('path') if isinstance(glb, dict) else glb
        tex = c.predict(handle_file(seg_path), handle_file(gp), 0, api_name='/run_texture')
        save(tex, 'wukong_triposg_tex')
except Exception as e:
    print('FAIL', mode, type(e).__name__, str(e)[:300], flush=True)
print('done', mode, '%.0fs' % (time.time() - t0), flush=True)
