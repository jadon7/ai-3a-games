#!/usr/bin/env python3
"""训练“这一只怪物”的关节检测器（DINOv2 微调）。

用法: python scripts/train.py troll --epochs 16 --batch 24
产出: runs/<name>/jointnet.pt, runs/<name>/train_log.txt
"""
import argparse
import os
import sys
import time

import numpy as np
import torch
from torch.utils.data import DataLoader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from v2r.data import JointDataset, load_labels  # noqa: E402
from v2r.model import IN_H, IN_W, JointNet, decode, heatmap_loss  # noqa: E402


def evaluate(net, loader, device):
    net.eval()
    errs, confs = [], []
    with torch.no_grad():
        for x, coords, _ in loader:
            pred, conf = decode(net(x.to(device)))
            d = (pred - coords) * torch.tensor([IN_W, IN_H])
            inside = ((coords > 0) & (coords < 1)).all(-1)
            errs.append(d.norm(dim=-1)[inside])
            confs.append(conf[inside])
    e = torch.cat(errs).numpy()
    return {"mean_px": float(e.mean()), "median_px": float(np.median(e)),
            "pck5": float((e < 5).mean()), "pck10": float((e < 10).mean()), "conf": float(torch.cat(confs).mean())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--epochs", type=int, default=16)
    ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--lr-head", type=float, default=1e-3)
    ap.add_argument("--lr-backbone", type=float, default=3e-5)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--val", type=int, default=160)
    ap.add_argument("--limit", type=int, default=0, help="只用前 N 个样本（试跑用）")
    ap.add_argument("--init", help="从一份已有权重热启动（关节数不同也行，同名关节的输出通道会被继承）")
    a = ap.parse_args()

    data_root = os.path.join(ROOT, "data", a.name, "train")
    run_dir = os.path.join(ROOT, "runs", a.name)
    os.makedirs(run_dir, exist_ok=True)
    lab = load_labels(data_root)
    n = len(lab["index"]) if not a.limit else min(a.limit, len(lab["index"]))
    order = np.random.default_rng(0).permutation(n)
    val_idx, train_idx = order[:a.val], order[a.val:]
    train_ds = JointDataset(data_root, train_idx, train=True)
    val_clean = JointDataset(data_root, val_idx, train=False)
    val_aug = JointDataset(data_root, val_idx, train=True, seed=999)
    kw = dict(num_workers=a.workers, persistent_workers=a.workers > 0)
    train_dl = DataLoader(train_ds, batch_size=a.batch, shuffle=True, drop_last=True, **kw)
    val_clean_dl = DataLoader(val_clean, batch_size=a.batch, **kw)
    val_aug_dl = DataLoader(val_aug, batch_size=a.batch, **kw)

    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")      # 有 N 卡（远程那台 4090）就用 N 卡
    net = JointNet(len(lab["joint_names"]))
    if a.init:
        ck = torch.load(a.init, map_location="cpu", weights_only=False)
        own = net.state_dict()
        copied, last = 0, [k for k in own if k.startswith("head.")][-2:]          # 最后一层卷积的 weight / bias
        for k, v in ck["state"].items():
            if k in own and own[k].shape == v.shape:
                own[k] = v
                copied += 1
            elif k in last:                                                        # 关节数变了：按名字继承
                for j_new, nm in enumerate(lab["joint_names"]):
                    if nm in ck["joint_names"]:
                        own[k][j_new] = v[ck["joint_names"].index(nm)]
        net.load_state_dict(own)
        print(f"热启动自 {a.init}：继承了 {copied} 组参数，以及 {sum(n in ck['joint_names'] for n in lab['joint_names'])} 个同名关节的输出通道", flush=True)
    net = net.to(device)
    head_params = list(net.head.parameters())
    bb_params = [p for p in net.backbone.parameters() if p.requires_grad]
    opt = torch.optim.AdamW([{"params": head_params, "lr": a.lr_head},
                             {"params": bb_params, "lr": a.lr_backbone}], weight_decay=0.01)
    steps = a.epochs * len(train_dl)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[a.lr_head, a.lr_backbone], total_steps=steps,
                                                pct_start=0.08, anneal_strategy="cos")
    log = open(os.path.join(run_dir, "train_log.txt"), "a")

    def say(msg):
        print(msg, flush=True)
        log.write(msg + "\n")
        log.flush()

    say(f"train {len(train_ds)} imgs, val {len(val_clean)} imgs, {len(lab['joint_names'])} joints, device {device}, "
        f"trainable params {sum(p.numel() for p in head_params + bb_params) / 1e6:.1f}M")
    t0 = time.time()
    step = 0
    for ep in range(a.epochs):
        net.train()
        net.backbone.eval()                                   # 骨干里没有需要训练态的层，保持 eval
        train_ds.epoch = ep
        run = 0.0
        for i, (x, coords, _) in enumerate(train_dl):
            loss = heatmap_loss(net(x.to(device)), coords.to(device))
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(head_params + bb_params, 5.0)
            opt.step()
            sched.step()
            step += 1
            run = loss.item() if i == 0 else 0.95 * run + 0.05 * loss.item()
            if step % 50 == 0:
                el = time.time() - t0
                say(f"  ep {ep + 1} step {step}/{steps} loss {run:.3f}  {step * a.batch / el:.0f} img/s  eta {(steps - step) * el / step / 60:.1f}min")
        mc, ma = evaluate(net, val_clean_dl, device), evaluate(net, val_aug_dl, device)
        say(f"EPOCH {ep + 1}/{a.epochs} loss {run:.3f} | val(原图) {mc['mean_px']:.2f}px pck5 {mc['pck5']:.3f} | "
            f"val(退化后) {ma['mean_px']:.2f}px median {ma['median_px']:.2f}px pck5 {ma['pck5']:.3f} pck10 {ma['pck10']:.3f} conf {ma['conf']:.2f} | "
            f"{(time.time() - t0) / 60:.1f}min")
        torch.save({"state": net.trainable_state(), "joint_names": lab["joint_names"], "joint_group": lab["joint_group"],
                    "n_trainable_blocks": len(net.backbone.blocks) - net.n_frozen, "epoch": ep + 1,
                    "val_clean": mc, "val_aug": ma}, os.path.join(run_dir, "jointnet.pt"))
    say(f"DONE in {(time.time() - t0) / 60:.1f}min")


if __name__ == "__main__":
    main()
