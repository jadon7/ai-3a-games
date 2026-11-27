"""Capture the existing game viewer. All images and temporary profiles stay here."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

from PIL import Image

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'out'
ROUND=OUT/'rounds'
TMP=ROOT/'tmp'
PROJECT=ROOT.parents[2]
URLS=[f'/lab/kit/tower_me/out/tower_me_{i}.glb' for i in (1,2,3)]
ENV={**os.environ,'TMPDIR':str(TMP),'PUPPETEER_TMP_DIR':str(TMP),'MOBA_URL':'http://localhost:5183/kit.html'}

def capture(dest, models, view, width, height):
    query=f'model={",".join(models)}&team=0&nohud=1&t=3{view}'
    subprocess.run(['node',str(PROJECT/'tools'/'shot.mjs'),str(dest),query,str(width),str(height)],env=ENV,timeout=145,check=True)

def compare(dst,*captures):
    panels=[Image.open(ROOT/'ref'/'family.png').convert('RGB')]
    height=panels[0].height
    for src in captures:
        im=Image.open(src).convert('RGB')
        panels.append(im.resize((round(im.width*height/im.height),height),Image.Resampling.LANCZOS))
    width=sum(im.width for im in panels)+6*(len(panels)-1)
    result=Image.new('RGB',(width,height),'#202722')
    x=0
    for im in panels:
        result.paste(im,(x,0))
        x+=im.width+6
    result.save(dst,quality=94,subsampling=0)

def final_views(run):
    # Centre the same camera angle on each tower for a close inspection of the casts.
    cameras=['17.8,36,3.85,6','19.0,36,4.39,6','20.9,36,5.18,6']
    sheet=Image.new('RGB',(910*3+8,1320),'#313927')
    for i,(model,cam) in enumerate(zip(URLS,cameras)):
        dest=ROUND/f'{run}_close_{i+1}.jpg'
        capture(dest,[model],'&man=0&cam='+cam,910,1320)
        sheet.paste(Image.open(dest),(i*914,0))
    sheet.save(OUT/'preview_close.jpg',quality=95,subsampling=0)
    compare(OUT/'compare.jpg',OUT/'preview_close.jpg')
    shutil.copyfile(ROUND/f'{run}_game.jpg',OUT/'preview_game.jpg')
    capture(ROUND/f'{run}_outer_game.jpg',URLS[:1],'',1600,900)

if __name__=='__main__':
    run=sys.argv[1] if len(sys.argv)>1 else 'r7'
    ROUND.mkdir(exist_ok=True)
    capture(ROUND/f'{run}_game.jpg',URLS,'&cam=24,56,3,0&gap=6.45',1920,1000)
    capture(ROUND/f'{run}_close.jpg',URLS,'&cam=22.2,35,4.85,2&gap=6',2048,1152)
    compare(ROUND/f'{run}_compare.jpg',ROUND/f'{run}_game.jpg',ROUND/f'{run}_close.jpg')
    if run=='r7': final_views(run)
