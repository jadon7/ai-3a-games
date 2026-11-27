#!/usr/bin/env python3
"""测这台 Mac 到 4090 机器的连通性和速度。在家里、在外面都能跑，结果可以直接对比。

用法:
  python3 scripts/remote4090_test.py              # 自动选别名：局域网通就用 jadon7-wsl，否则用 jadon7-ts
  python3 scripts/remote4090_test.py jadon7-ts    # 指定别名（在家里也想测 Tailscale 这条路时用）
  python3 scripts/remote4090_test.py jadon7-ts 50 # 第二个参数是测速用的数据量（MB，默认 20）

只读：不在远程留下任何文件，上传的数据直接丢弃。
"""
import os
import socket
import subprocess
import sys
import time

LAN_IP, TS_IP = "<4090 主机局域网 IP>", "<4090 主机 Tailscale IP>"
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=15"]
REMOTE_FILE = "/d/moba-remote/dl/tailscale-setup-1.104.7-amd64.msi"   # 远程现成的 37MB 文件，下载测速用


def tcp_ms(ip, n=5):
    """到 22 端口建立 TCP 连接的耗时（毫秒），近似一个来回的延迟。连不上返回 None。"""
    out = []
    for _ in range(n):
        t = time.time()
        try:
            socket.create_connection((ip, 22), timeout=4).close()
            out.append((time.time() - t) * 1000)
        except OSError:
            return None
        time.sleep(0.15)
    return out


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "auto"
    mb = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    lan = tcp_ms(LAN_IP, 2)
    if host == "auto":
        host = "jadon7-wsl" if lan else "jadon7-ts"
    ip = LAN_IP if host == "jadon7-wsl" else TS_IP
    print(f"别名 {host}（{ip}）；局域网地址 {LAN_IP} {'通，说明现在在家里' if lan else '不通，说明现在不在家里'}")

    if host == "jadon7-ts":
        r = subprocess.run(["tailscale", "ping", "--c", "5", "--timeout", "8s", TS_IP], capture_output=True, text=True)
        lines = [x for x in (r.stdout + r.stderr).splitlines() if x.strip()]
        print("Tailscale 路径（via 后面是 IP 表示直连，是 DERP(xxx) 表示走中继）:")
        for x in lines[-3:]:
            print("   ", x)

    rtt = tcp_ms(ip)
    if not rtt:
        sys.exit(f"连不上 {ip}:22。在外面的话先确认本机 Tailscale 开着：tailscale status")
    print(f"延迟（TCP 建连）: 最小 {min(rtt):.0f} ms，中位 {sorted(rtt)[len(rtt) // 2]:.0f} ms")

    t = time.time()
    r = subprocess.run(SSH + [host, "hostname"], capture_output=True, text=True)
    t_conn = time.time() - t
    if r.returncode != 0:
        sys.exit("ssh 登录失败: " + (r.stderr or r.stdout).strip()[:200])
    print(f"ssh 登录一次并跑一条命令: {t_conn:.2f} 秒（主机名 {r.stdout.strip()}）")

    data = os.urandom(mb * 1024 * 1024)                      # 随机数据，压缩不了
    t = time.time()
    r = subprocess.run(SSH + [host, "cat > /dev/null"], input=data, capture_output=True)
    dt = max(time.time() - t - t_conn, 0.05)
    print(f"上传 {mb} MB: {mb * 8 / dt:.1f} Mbps（{mb / dt:.1f} MB/秒）" if r.returncode == 0 else "上传测试失败")

    t = time.time()
    r = subprocess.run(SSH + [host, f"head -c {mb * 1024 * 1024} {REMOTE_FILE} 2>/dev/null || head -c {mb * 1024 * 1024} /dev/urandom"],
                       capture_output=True)
    dt = max(time.time() - t - t_conn, 0.05)
    got = len(r.stdout) / 1024 / 1024
    print(f"下载 {got:.0f} MB: {got * 8 / dt:.1f} Mbps（{got / dt:.1f} MB/秒）" if got > 1 else "下载测试失败")


if __name__ == "__main__":
    main()
