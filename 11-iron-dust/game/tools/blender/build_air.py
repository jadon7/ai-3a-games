# build_air.py -- builds the "Operation Descent" air/ground-installation models and exports .glb
# usage: blender -b --factory-startup -P build_air.py -- [fighter transport pod carrier cannon aa]
import sys, os, importlib, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'models'))
ALL = ['fighter', 'transport', 'pod', 'carrier', 'cannon', 'aa']
LIMIT = {'fighter': 4000, 'transport': 12000, 'pod': 5000, 'carrier': 30000, 'cannon': 12000, 'aa': 3000}

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
names = [a for a in args if a in ALL] or ALL
os.makedirs(OUT, exist_ok=True)
for n in names:
    t = time.time()
    mod = importlib.import_module('air_' + n)
    m = mod.make()
    m.build()
    m.export(os.path.join(OUT, n + '.glb'))
    tr = m.tris()
    print('  %s: %d tris (limit %d) %s  %.1fs' % (n, tr, LIMIT[n], 'OK' if tr <= LIMIT[n] else 'OVER BUDGET', time.time() - t))
