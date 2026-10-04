# Enumerate every subset D (down spins) maximising t(D) = |D| - e(D) on a cubic graph,
# i.e. every classical ground state of H = J sum s_i s_j - h sum s_i at h = J.
# Backward DP gives the best completion value for each frontier assignment; a vectorised
# forward sweep then keeps only prefixes that can still reach the optimum.
import numpy as np
from order import best_order

def frontiers(G, order):
    done = set(); front = []; F = []
    for v in order:
        prev = list(front)
        done.add(v); front.append(v)
        front = [u for u in front if any(w not in done for w in G[u])]
        F.append((prev, list(front)))
    return F

def enumerate_optimal(G, order):
    n = len(order)
    F = frontiers(G, order)
    # best[k][a]: max future gain from vertices k..n-1 given assignment a of frontier before step k
    best = [None] * (n + 1)
    best[n] = np.zeros(1, dtype=np.int64)
    for k in range(n - 1, -1, -1):
        prev, cur = F[k]; v = order[k]
        nb = [prev.index(u) for u in G[v] if u in prev]
        ext = prev + [v]
        keep = [ext.index(u) for u in cur]
        a = np.arange(2 ** len(prev), dtype=np.int64)
        res = np.full(a.shape, -10 ** 9, dtype=np.int64)
        for x in (0, 1):
            gain = x * (1 - sum((a >> i) & 1 for i in nb)) if nb else np.full(a.shape, x, dtype=np.int64)
            full = a | (x << len(prev))
            nxt = np.zeros(a.shape, dtype=np.int64)
            for j, i in enumerate(keep): nxt |= ((full >> i) & 1) << j
            res = np.maximum(res, gain + best[k + 1][nxt])
        best[k] = res
    opt = int(best[0][0])
    # forward sweep: masks over graph vertices (uint64), frontier assignment index, partial value
    pos = {v: i for i, v in enumerate(order)}
    masks = np.zeros(1, dtype=np.uint64); fa = np.zeros(1, dtype=np.int64); val = np.zeros(1, dtype=np.int64)
    for k in range(n):
        prev, cur = F[k]; v = order[k]
        nb = [prev.index(u) for u in G[v] if u in prev]
        ext = prev + [v]; keep = [ext.index(u) for u in cur]
        outm, outf, outv = [], [], []
        for x in (0, 1):
            gain = x * (1 - sum((fa >> i) & 1 for i in nb)) if nb else np.full(fa.shape, x, dtype=np.int64)
            full = fa | (x << len(prev))
            nxt = np.zeros(fa.shape, dtype=np.int64)
            for j, i in enumerate(keep): nxt |= ((full >> i) & 1) << j
            nv = val + gain
            ok = nv + best[k + 1][nxt] == opt
            outm.append(masks[ok] | (np.uint64(x) << np.uint64(v)))
            outf.append(nxt[ok]); outv.append(nv[ok])
        masks = np.concatenate(outm); fa = np.concatenate(outf); val = np.concatenate(outv)
    return opt, np.sort(masks)

if __name__ == '__main__':
    from c60 import c60
    G = c60()
    _, order = best_order(G, 100, 3)
    opt, D = enumerate_optimal(G, order)
    sizes = np.array([bin(int(x)).count('1') for x in D])
    print('optimum |D|-e(D) =', opt, ' number of ground states =', len(D), ' distinct:', len(np.unique(D)))
    print('M = 60-2|D| distribution:', {60 - 2 * s: int((sizes == s).sum()) for s in sorted(set(sizes))})
    np.save('gs_masks.npy', D)
