# Downloads CC0 PBR texture sets from Poly Haven (https://polyhaven.com, licence CC0 1.0) at 1K
# and packs each into two files the game loads at start-up:
#   textures/<id>_alb.jpg  albedo (sRGB)
#   textures/<id>_nr.jpg   R,G = OpenGL normal XY, B = roughness (linear)
# Run:  python tools/fetch_textures.py
import json, os, sys, urllib.request, io
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'textures'))
SETS = {
    'green_metal_rust': 'painted armour plate',
    'metal_plate_02': 'bare / worn steel',
    'rusty_metal_sheet': 'rusted sheet metal (sheds, containers, wrecks)',
    'concrete_wall_004': 'cast concrete walls',
    'damaged_concrete_floor': 'concrete pads and bunkers',
    'gravelly_sand': 'desert sand',
    'dry_ground_rocks': 'rocky ground',
    'dry_ground_01': 'cracked dry ground',
    'cliff_side': 'layered cliff faces (mesas)',
    'sandstone_cracks': 'mesa tops and boulders',
    'leather_white': 'cockpit seat padding (grain and creases; tinted in game)',
    'rubberized_track': 'cockpit rubber and textured plastic panels',
    'metal_plate': 'cockpit floor and foot plates (tread plate)',
    'blue_metal_plate': 'cockpit painted structure (industrial painted plate; only its light-and-dark is used)',
    'rusty_painted_metal': 'cockpit console shells (old paint; only its light-and-dark is used)',
    'rubber_tiles': 'cockpit floor matting',
}
# CC0 sets from ambientCG (https://ambientcg.com, licence CC0 1.0), 1K JPG zips, packed the same way as <id>_alb / <id>_nr
ACG = {
    'Metal009': 'cockpit brushed steel (sticks, bezels, trim)',
    'Metal012': 'cockpit brushed aluminium (housings, consoles)',
    'Metal038': 'cockpit scratched plate (frame, arm rests)',
}
UA = {'User-Agent': 'texture-fetch-script'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def pick(files, names):
    for n in names:
        if n in files and '1k' in files[n]:
            f = files[n]['1k']
            return f.get('jpg', f.get('png'))
    raise KeyError(names)


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    lines = ['# Texture credits', '', 'All texture sets below are from [Poly Haven](https://polyhaven.com) and are licensed CC0 1.0 (public domain).',
             'They were downloaded at 1K and repacked by `tools/fetch_textures.py` (albedo + normal XY / roughness).', '']
    for tid, use in SETS.items():
        alb_p = os.path.join(OUT, tid + '_alb.jpg')
        nr_p = os.path.join(OUT, tid + '_nr.jpg')
        if not (os.path.exists(alb_p) and os.path.exists(nr_p)):
            files = json.loads(get('https://api.polyhaven.com/files/' + tid))
            d = pick(files, ['Diffuse', 'diff', 'Color'])
            n = pick(files, ['nor_gl', 'Normal'])
            r = pick(files, ['Rough', 'rough', 'Roughness'])
            raw = 0
            imgs = []
            for spec in (d, n, r):
                data = get(spec['url'])
                raw += len(data)
                imgs.append(Image.open(io.BytesIO(data)))
            alb = imgs[0].convert('RGB')
            nor = imgs[1].convert('RGB').resize(alb.size)
            rough = imgs[2].convert('L').resize(alb.size)
            alb.save(alb_p, quality=90)
            nr = Image.merge('RGB', (nor.getchannel('R'), nor.getchannel('G'), rough))
            nr.save(nr_p, quality=93, subsampling=0)
            print('fetched %-26s %.1f MB downloaded' % (tid, raw / 1e6))
        sz = os.path.getsize(alb_p) + os.path.getsize(nr_p)
        total += sz
        lines.append('- `%s` - %s - https://polyhaven.com/a/%s' % (tid, use, tid))
    import zipfile
    lines += ['', 'From [ambientCG](https://ambientcg.com), licensed CC0 1.0, downloaded at 1K and repacked the same way:', '']
    for aid, use in ACG.items():
        tid = aid.lower()
        alb_p = os.path.join(OUT, tid + '_alb.jpg')
        nr_p = os.path.join(OUT, tid + '_nr.jpg')
        if not (os.path.exists(alb_p) and os.path.exists(nr_p)):
            data = get('https://ambientcg.com/get?file=%s_1K-JPG.zip' % aid)
            z = zipfile.ZipFile(io.BytesIO(data))
            def member(tag):
                return Image.open(io.BytesIO(z.read([n for n in z.namelist() if n.endswith('_%s.jpg' % tag)][0])))
            alb = member('Color').convert('RGB')
            nor = member('NormalGL').convert('RGB').resize(alb.size)
            rough = member('Roughness').convert('L').resize(alb.size)
            alb.save(alb_p, quality=90)
            Image.merge('RGB', (nor.getchannel('R'), nor.getchannel('G'), rough)).save(nr_p, quality=93, subsampling=0)
            print('fetched %-26s %.1f MB downloaded' % (aid, len(data) / 1e6))
        total += os.path.getsize(alb_p) + os.path.getsize(nr_p)
        lines.append('- `%s` - %s - https://ambientcg.com/a/%s' % (tid, use, aid))
    with open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines) + '\n')
    # raw files are read with Image.load_from_file at start-up, so keep Godot's importer away from them
    open(os.path.join(OUT, '.gdignore'), 'w').close()
    print('TOTAL on disk %.1f MB in %s' % (total / 1e6, OUT))


if __name__ == '__main__':
    main()
