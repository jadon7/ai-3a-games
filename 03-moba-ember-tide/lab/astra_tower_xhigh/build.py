"""Rebuild the final tower and render the exported GLB in background Cycles."""
import os
import subprocess
import sys
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parent
TMP=ROOT/'tmp';TMP.mkdir(exist_ok=True)
OUT=ROOT/'out';(OUT/'rounds').mkdir(parents=True,exist_ok=True)
env=dict(os.environ,TMPDIR=str(TMP),PYTHONDONTWRITEBYTECODE='1',XDG_CACHE_HOME=str(TMP/'cache'),
         BLENDER_USER_CONFIG=str(TMP/'blender-config'),BLENDER_USER_DATAFILES=str(TMP/'blender-data'),
         BLENDER_USER_SCRIPTS=str(TMP/'blender-scripts'),BLENDER_USER_RESOURCES=str(TMP/'blender-resources'),
         BLENDER_USER_EXTENSIONS=str(TMP/'blender-extensions'),BLENDER_USER_CACHE=str(TMP/'blender-cache'),
         PYTHONPYCACHEPREFIX=str(TMP/'pycache'),MPLCONFIGDIR=str(TMP/'mpl'),OPENBLAS_NUM_THREADS='1')
subprocess.run([sys.executable,str(ROOT/'tower.py')],env=env,cwd=ROOT,check=True,timeout=240)
with (TMP/'blender_final.log').open('w') as log:
    subprocess.run(['/Applications/Blender.app/Contents/MacOS/Blender','-b','--factory-startup','-noaudio',
                    '--python-exit-code','1','-P',str(ROOT/'render.py')],
                   env=env,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=1800,check=True)
for view in [OUT/'render_design_angle.png', *sorted(OUT.glob('turntable_*.png'))]:
    with Image.open(view) as fore:
        bg=Image.new('RGBA',fore.size,(197,195,197,255))
        composite=Image.alpha_composite(bg,fore.convert('RGBA')).convert('RGB')
    composite.save(view)
with Image.open(ROOT/'ref/design.png') as ref, Image.open(OUT/'render_design_angle.png') as model:
    pair=Image.new('RGB',(model.width*2,model.height))
    pair.paste(ref);pair.paste(model,(model.width,0))
    pair.save(OUT/'rounds'/'06.png')
    pair.save(OUT/'compare.png')
print('Rendered final tower.',flush=True)
