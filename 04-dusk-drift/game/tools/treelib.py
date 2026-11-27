# 树木处理的公共函数（numpy）
import numpy as np

def mesh_arrays(me):
    nv = len(me.vertices); npoly = len(me.polygons); nl = len(me.loops)
    co = np.empty(nv * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    lv = np.empty(nl, np.int32); me.loops.foreach_get('vertex_index', lv)
    ls = np.empty(npoly, np.int32); me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(npoly, np.int32); me.polygons.foreach_get('loop_total', lt)
    mi = np.empty(npoly, np.int32); me.polygons.foreach_get('material_index', mi)
    return co, lv, ls, lt, mi

def poly_of_loop(ls, lt):
    return np.repeat(np.arange(len(ls), dtype=np.int32), lt)

def components(nv, ea, eb):
    """顶点连通分量标签（最小标签传播 + 指针跳跃）"""
    lab = np.arange(nv, dtype=np.int64)
    for it in range(10000):
        m = np.minimum(lab[ea], lab[eb])
        new = lab.copy()
        np.minimum.at(new, ea, m); np.minimum.at(new, eb, m)
        for _ in range(6):
            new = new[new]
        if np.array_equal(new, lab):
            break
        lab = new
    return lab

def loop_edges(lv, ls, lt):
    """每个面的环边 (a,b)"""
    nl = len(lv)
    nxt = np.arange(nl, dtype=np.int64) + 1
    last = (ls + lt - 1).astype(np.int64)
    nxt[last] = ls
    return lv.astype(np.int64), lv[nxt].astype(np.int64)
