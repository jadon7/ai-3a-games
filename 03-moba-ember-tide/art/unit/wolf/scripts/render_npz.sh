#!/bin/zsh
# 把一个管线格式的动作（npz：quats、loc）按两个机位渲染出来，再拼成一张连拍图。用法: zsh render_npz.sh <动作.npz> <输出目录> [每隔几帧取一帧=2] [列数=8]
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup $V/assets/model/wolf.blend -P $V/scripts/blender/render_motion.py -- wolf $1 --frames $2 --size 427 480 --shutter 0 --samples 8 2>&1 | grep -E "^(KEYED|RENDERED|Traceback)|Error"
$V/.venv/bin/python - "$2" "${3:-2}" "${4:-8}" <<'PY'
import sys, glob, cv2, numpy as np
d, step, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); fs = sorted(glob.glob(d + "/side/*.jpg"))[::step]; tiles = []
for f in fs:
    s = cv2.imread(f)[250:470]; fr = cv2.imread(f.replace("/side/", "/front/"))[250:470, 120:307]; t = np.concatenate([fr, s], 1); n = f.split("/")[-1][:4]
    cv2.putText(t, str(int(n)), (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2); cv2.line(t, (0, 193), (t.shape[1], 193), (0, 0, 200), 1); tiles.append(t)      # 红线：地面（z=0）
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 40, np.uint8)
for k, t in enumerate(tiles): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = t
cv2.imwrite(d + "/sheet.jpg", sh, [cv2.IMWRITE_JPEG_QUALITY, 90]); print(sh.shape, d + "/sheet.jpg")
PY
