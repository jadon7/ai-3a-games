"""本机与 4090 两头并行渲染时互相同步帧：本机从后往前渲，远程从前往后渲，各自跳过对方已完成的帧。
  .venv/bin/python scripts/sync_frames.py <day|dusk> [总帧数=420]
凑齐全部帧（含 13 张 _nf）后退出。只同步"离各自当前渲染位置 2 帧以上"的文件，避免拷到没写完的帧。
"""
import os, re, subprocess, sys, time

VAR = sys.argv[1]; TOTAL = int(sys.argv[2]) if len(sys.argv) > 2 else 420
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, "renders", f"final_{VAR}"); os.makedirs(LOCAL, exist_ok=True)
REMOTE = f"D:/gunfight/{VAR}"; RHOST = "jadon7-wsl"
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", RHOST]
NEED = TOTAL + 13


def num(n):
    m = re.match(r"f_(\d+)(_nf)?\.exr$", n)
    return (int(m.group(1)), bool(m.group(2))) if m else None


def remote_list():
    r = subprocess.run(SSH + [f"ls /d/gunfight/{VAR}"], capture_output=True, text=True, timeout=40)
    return {n.strip() for n in r.stdout.split() if num(n.strip())}


def local_list():
    return {n for n in os.listdir(LOCAL) if num(n) and os.path.getsize(os.path.join(LOCAL, n)) > 10000}


while True:
    try:
        R, L = remote_list(), local_list()
    except Exception as e:
        print("list err", e, flush=True); time.sleep(20); continue
    lmain = sorted(num(n)[0] for n in L if not num(n)[1]); rmain = sorted(num(n)[0] for n in R if not num(n)[1])
    # 本机前沿：从最后一帧往前数，本机连续拥有的最小帧号；远程前沿：从第 1 帧往后数，远程连续拥有的最大帧号
    ls_, rs_ = set(lmain), set(rmain)
    lfront = TOTAL + 1
    while (lfront - 1) in ls_:
        lfront -= 1
    rfront = 0
    while (rfront + 1) in rs_:
        rfront += 1
    push = [n for n in L - R if num(n)[1] or num(n)[0] > lfront + 2]
    pull = [n for n in R - L if num(n)[1] or num(n)[0] < rfront - 2]
    if len(L | R) >= NEED:      # 全部渲完：把剩下的差额也同步
        pull = sorted(R - L); push = []
    for chunk_i in range(0, len(pull), 40):
        ch = pull[chunk_i:chunk_i + 40]
        subprocess.run(["scp", "-q", "-o", "BatchMode=yes"] + [f"{RHOST}:{REMOTE}/{n}" for n in ch] + [LOCAL + "/"], capture_output=True, timeout=600)
    for chunk_i in range(0, len(push), 40):
        ch = push[chunk_i:chunk_i + 40]
        subprocess.run(["scp", "-q", "-o", "BatchMode=yes"] + [os.path.join(LOCAL, n) for n in ch] + [f"{RHOST}:{REMOTE}/"], capture_output=True, timeout=600)
    L2 = local_list()
    print(time.strftime("%H:%M:%S"), f"local {len(L2)}/{NEED}  remote {len(R)}  lfront {lfront} rfront {rfront}  pulled {len(pull)} pushed {len(push)}", flush=True)
    if len(L2) >= NEED:
        print("SYNC COMPLETE", flush=True)
        break
    time.sleep(30)
