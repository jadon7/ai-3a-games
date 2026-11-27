"""把成片序列按镜头抽帧拼成联系表，便于逐镜头质检。用法：python sheets.py <后期帧目录> <输出目录> [每镜头张数=12]"""
import sys, os
import numpy as np, cv2
seq, out = sys.argv[1], sys.argv[2]
k = int(sys.argv[3]) if len(sys.argv) > 3 else 12
os.makedirs(out, exist_ok=True)
EDIT = [('S1', 120), ('S3', 120), ('S2', 180), ('S4', 120), ('S5', 120), ('S5B', 60), ('S6', 150)]
cap = cv2.VideoCapture(seq) if seq.lower().endswith('.mp4') else None


def grab(i):
    if cap is not None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, im = cap.read()
        return im if ok else None
    return cv2.imread(os.path.join(seq, f'{i:05d}.png'))


g = 0
for shot, n in EDIT:
    idx = [int(round(i * (n - 1) / (k - 1))) for i in range(k)]
    tiles = []
    for i in idx:
        im = grab(g + i)
        if im is None:
            im = np.zeros((1080, 1920, 3), np.uint8)
        im = cv2.resize(im, (640, 360), interpolation=cv2.INTER_AREA)
        cv2.putText(im, f'{shot} f{i + 1}', (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(im, f'{shot} f{i + 1}', (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(im)
    cols = 4
    rows = [np.hstack(tiles[r:r + cols]) for r in range(0, len(tiles), cols)]
    cv2.imwrite(os.path.join(out, f'qc_{shot}.jpg'), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82])
    g += n
print('sheets ->', out)
