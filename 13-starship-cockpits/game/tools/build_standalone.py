"""Fold index.html + js/*.js into one HTML file.

The import map is inherited from index.html (now pointing at ./js/vendor/),
so both versions load three.js from local files instead of the CDN.

Note: ES modules loaded from a file:// page are blocked by Chrome/Edge CORS.
Serve the folder over HTTP for reliable use:  python -m http.server 8731
"""
import io, re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
if len(sys.argv) > 1:
    root = pathlib.Path(sys.argv[1])
read = lambda p: io.open(root / p, encoding='utf-8').read()

core = read('js/core.js')
core = core.replace('export { THREE, mergeGeometries };\n', '')
core = re.sub(r'^export (const|function|class) ', r'\1 ', core, flags=re.M)
assert 'export ' not in core, 'unhandled export in core.js'


def scene(name):
    s = read(f'js/{name}.js')
    s, n = re.subn(r"^import \{[^}]*\} from '\./core\.js';\n", '', s, count=1, flags=re.M)
    assert n == 1, f'core import not found in {name}.js'
    s, n = s.replace('export function build(', 'function build('), s.count('export function build(')
    assert n == 1 and 'export ' not in s, f'unexpected module syntax in {name}.js'
    return f'const __{name} = (() => {{\n{s}\nreturn {{ build }};\n}})();\n'


html = read('index.html')
m = re.search(r'<script type="module">\n(.*?)</script>', html, flags=re.S)
main = m.group(1)
main = main.replace("import { App } from './js/core.js';\n", '')
old = "const loaders = { cyber: () => import('./js/cyber.js'), nasa: () => import('./js/nasa.js'), y2k: () => import('./js/y2k.js') };"
assert old in main, 'main script changed shape'
main = main.replace(old, 'const loaders = { cyber: async () => __cyber, nasa: async () => __nasa, y2k: async () => __y2k };')

bundle = '\n'.join([core, scene('cyber'), scene('nasa'), scene('y2k'), main])
assert '</script' not in bundle
out = html[:m.start(1)] + bundle + html[m.end(1):]
target = root / 'starship-cockpits.html'
io.open(target, 'w', encoding='utf-8', newline='\n').write(out)
print(target.name, round(len(out.encode('utf-8')) / 1024), 'KB')
