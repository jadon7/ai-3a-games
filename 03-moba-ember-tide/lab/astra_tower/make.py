import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

root=Path(__file__).resolve().parent
os.chdir(root);out=root/'out';tmp=root/'tmp';tmp.mkdir(exist_ok=True);(out/'rounds').mkdir(parents=True,exist_ok=True)
env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',TMPDIR=str(tmp),XDG_CACHE_HOME=str(tmp/'cache'),BLENDER_USER_RESOURCES=str(tmp/'blender'),HOME=str(tmp),OPENBLAS_NUM_THREADS='1')
def run(args,log,timeout):
    with (tmp/log).open('w') as handle:subprocess.run(args,stdout=handle,stderr=subprocess.STDOUT,check=True,timeout=timeout,env=env)
mode=sys.argv[1] if len(sys.argv)>1 else 'final'
run([sys.executable,'build.py','5' if mode=='final' else mode],'build.log',180)
run(['/Applications/Blender.app/Contents/MacOS/Blender','-b','--factory-startup','--python-exit-code','1','-P','render.py','--',mode],'render.log',900)
design=Image.open('ref/design.png').convert('RGB');model=Image.open(out/('render_design_angle.png' if mode=='final' else 'rounds/model_'+mode+'.png')).convert('RGB');canvas=Image.new('RGB',(model.width*2,model.height));canvas.paste(design.resize(model.size,Image.Resampling.LANCZOS));canvas.paste(model,(model.width,0));canvas.save(out/('compare.png' if mode=='final' else 'rounds/compare_'+mode+'.png'))
