"""关节检测网络：DINOv2 (ViT-S/14, registers) 做骨干 + 一个小的卷积头，输出每个关节一张热力图。

输入是单个机位的画面（448x504，8:9），输出 K 张 128x144 的热力图（每个关节在画面上的概率分布）。
前 8 层冻结，最后 4 层和卷积头一起训练——只教它认“这一只怪物”的关节。
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

IN_W, IN_H = 448, 504
GRID_W, GRID_H = IN_W // 14, IN_H // 14          # 32 x 36 个 patch
HM_W, HM_H = GRID_W * 4, GRID_H * 4              # 128 x 144
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
BACKBONE = "vit_small_patch14_reg4_dinov2.lvd142m"


class JointNet(nn.Module):
    def __init__(self, n_joints, pretrained=True, n_trainable_blocks=4):
        super().__init__()
        import os
        import timm
        # 连不上 HuggingFace 的机器（远程那台 Windows）：环境变量 V2R_BACKBONE_FILE 指到拷过去的 model.safetensors，就从本地文件读骨干权重
        local = os.environ.get("V2R_BACKBONE_FILE") if pretrained else None
        self.backbone = timm.create_model(BACKBONE, pretrained=pretrained, img_size=(IN_H, IN_W), num_classes=0,
                                          **({"pretrained_cfg_overlay": {"file": local}} if local else {}))
        self.n_prefix = self.backbone.num_prefix_tokens
        self.n_frozen = len(self.backbone.blocks) - n_trainable_blocks
        c = self.backbone.embed_dim
        for name, p in self.backbone.named_parameters():
            p.requires_grad = False
        for blk in self.backbone.blocks[self.n_frozen:]:
            for p in blk.parameters():
                p.requires_grad = True
        for p in self.backbone.norm.parameters():
            p.requires_grad = True
        self.tap = max(0, n_trainable_blocks // 2 - 1)       # 可训练的几层里，中间再抽一层特征
        self.head = nn.Sequential(
            nn.Conv2d(2 * c, 256, 3, padding=1), nn.GroupNorm(32, 256), nn.GELU(),
            nn.Upsample(scale_factor=2, mode="bilinear", align_corners=False),
            nn.Conv2d(256, 192, 3, padding=1), nn.GroupNorm(32, 192), nn.GELU(),
            nn.Upsample(scale_factor=2, mode="bilinear", align_corners=False),
            nn.Conv2d(192, 128, 3, padding=1), nn.GroupNorm(32, 128), nn.GELU(),
            nn.Conv2d(128, n_joints, 1),
        )

    def _grid(self, tokens):
        b = tokens.shape[0]
        return tokens[:, self.n_prefix:].transpose(1, 2).reshape(b, -1, GRID_H, GRID_W)

    def forward(self, x):
        bb = self.backbone
        with torch.no_grad():
            x = bb.patch_embed(x)
            x = bb._pos_embed(x)
            x = bb.norm_pre(x)
            for blk in bb.blocks[:self.n_frozen]:
                x = blk(x)
        mid = None
        for i, blk in enumerate(bb.blocks[self.n_frozen:]):
            x = blk(x)
            if i == self.tap:
                mid = x
        feats = torch.cat([self._grid(bb.norm(mid)), self._grid(bb.norm(x))], dim=1)
        return self.head(feats)                               # (B, K, HM_H, HM_W) logits

    def trainable_state(self):
        """只保存训练过的部分（最后几层 + 头），权重文件小很多。"""
        keep = {k: v for k, v in self.state_dict().items()
                if k.startswith("head.") or k.startswith("backbone.norm.")
                or any(k.startswith(f"backbone.blocks.{i}.") for i in range(self.n_frozen, len(self.backbone.blocks)))}
        return keep


def gaussian_targets(coords, sigma=1.5):
    """coords (B,K,2) 归一化坐标 -> (B,K,HM_H*HM_W) 归一化的高斯目标分布，以及 (B,K) 是否在画面内。"""
    b, k, _ = coords.shape
    xs = (torch.arange(HM_W, device=coords.device) + 0.5)
    ys = (torch.arange(HM_H, device=coords.device) + 0.5)
    cx = coords[..., 0:1] * HM_W
    cy = coords[..., 1:2] * HM_H
    gx = torch.exp(-((xs[None, None] - cx) ** 2) / (2 * sigma ** 2))        # (B,K,W)
    gy = torch.exp(-((ys[None, None] - cy) ** 2) / (2 * sigma ** 2))        # (B,K,H)
    g = (gy[..., :, None] * gx[..., None, :]).reshape(b, k, -1)
    mass = g.sum(-1, keepdim=True)
    inside = ((coords[..., 0] > 0.0) & (coords[..., 0] < 1.0) & (coords[..., 1] > 0.0) & (coords[..., 1] < 1.0))
    return g / mass.clamp_min(1e-6), inside & (mass[..., 0] > 0.5)


def heatmap_loss(logits, coords, sigma=1.5):
    """每个关节在整张画面上做 softmax，和高斯目标算交叉熵；画面外的关节不计入。"""
    b, k = logits.shape[:2]
    target, valid = gaussian_targets(coords, sigma)
    logp = F.log_softmax(logits.reshape(b, k, -1).float(), dim=-1)
    ce = -(target * logp).sum(-1)
    return (ce * valid).sum() / valid.sum().clamp_min(1)


@torch.no_grad()
def decode(logits, win=4):
    """热力图 -> 每个关节的归一化坐标 (B,K,2) 和置信度 (B,K)。

    先取峰值，再在峰值附近的小窗口里按概率加权求质心（亚像素）；置信度 = 窗口内的概率总和。
    """
    b, k, h, w = logits.shape
    prob = F.softmax(logits.reshape(b, k, -1).float(), dim=-1).reshape(b, k, h, w).cpu()
    idx = prob.reshape(b, k, -1).argmax(-1)
    py, px = idx // w, idx % w
    coords = torch.zeros(b, k, 2)
    conf = torch.zeros(b, k)
    for i in range(b):
        for j in range(k):
            y0, y1 = max(0, int(py[i, j]) - win), min(h, int(py[i, j]) + win + 1)
            x0, x1 = max(0, int(px[i, j]) - win), min(w, int(px[i, j]) + win + 1)
            p = prob[i, j, y0:y1, x0:x1]
            m = p.sum()
            ys = torch.arange(y0, y1, dtype=torch.float32) + 0.5
            xs = torch.arange(x0, x1, dtype=torch.float32) + 0.5
            coords[i, j, 0] = (p.sum(0) * xs).sum() / m / w
            coords[i, j, 1] = (p.sum(1) * ys).sum() / m / h
            conf[i, j] = m
    return coords, conf


def load_jointnet(path, device="cpu"):
    ck = torch.load(path, map_location="cpu", weights_only=False)
    net = JointNet(len(ck["joint_names"]), pretrained=True, n_trainable_blocks=ck["n_trainable_blocks"])
    missing, unexpected = net.load_state_dict(ck["state"], strict=False)
    assert not unexpected, unexpected
    return net.to(device).eval(), ck
