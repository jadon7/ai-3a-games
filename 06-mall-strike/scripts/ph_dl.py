import json, os, sys, urllib.request, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "polyhaven"
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "blender-scene-builder/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r: return r.read()
def save(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 0: return
    path.write_bytes(get(url))
def files(aid): return json.loads(get(f"https://api.polyhaven.com/files/{aid}"))
def texture(aid, res="2k"):
    f = files(aid); out = ROOT / "tex" / aid
    for m in ["Diffuse", "nor_gl", "Rough", "Displacement", "AO", "arm"]:
        if m in f and res in f[m]:
            fmt = "jpg" if "jpg" in f[m][res] else ("png" if "png" in f[m][res] else list(f[m][res])[0])
            u = f[m][res][fmt]["url"]; save(u, out / f"{m}.{u.rsplit('.',1)[-1]}")
    print("tex", aid, sorted(os.listdir(out)))
def model(aid, res="1k"):
    f = files(aid); g = f["gltf"]; r = res if res in g else sorted(g)[0]
    e = g[r]["gltf"]; out = ROOT / "models" / aid
    save(e["url"], out / f"{aid}.gltf")
    for rel, inc in e.get("include", {}).items(): save(inc["url"], out / rel)
    print("model", aid, r)
def hdri(aid, res="2k"):
    f = files(aid); u = f["hdri"][res]["hdr"]["url"]; save(u, ROOT / "hdri" / f"{aid}_{res}.hdr"); print("hdri", aid)
kind = sys.argv[1]
for a in sys.argv[2:]:
    aid, _, res = a.partition(":")
    try: {"tex": texture, "model": model, "hdri": hdri}[kind](aid, *( [res] if res else []))
    except Exception as ex: print("FAIL", aid, ex)
