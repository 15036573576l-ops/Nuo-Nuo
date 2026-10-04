# Independent check of the h = J answer using a different reduction and different code.
# With D = set of down spins: B = 90 - 6|D| + 4 e(D), M = 60 - 2|D|, so at h = J = 1
#   E = B - M = 30 - 4 (|D| - e(D)).
# Ground states <=> subsets D maximising t(D) = |D| - e(D) (e = edges inside D).
# Count them with a bitmask frontier DP that tracks t only.
import numpy as np, networkx as nx
from c60 import c60
from order import best_order

def count_t(G, order):
    n = G.number_of_nodes(); off = G.number_of_edges()     # t ranges over [-90, 60]
    size = off + n + 1
    front = []; done = set()
    table = {0: np.zeros(size, dtype=np.int64)}; table[0][off] = 1
    for v in order:
        nb = [i for i, u in enumerate(front) if u in G[v]]
        new = {}
        for mask, arr in table.items():
            # v not in D
            k0 = mask
            new[k0] = new.get(k0, 0) + arr
            # v in D: t += 1 - (#neighbours already in D)
            dt = 1 - sum((mask >> i) & 1 for i in nb)
            k1 = mask | (1 << len(front))
            new[k1] = new.get(k1, 0) + np.roll(arr, dt)
        done.add(v); front.append(v)
        keep = [i for i, u in enumerate(front) if any(w not in done for w in G[u])]
        front = [front[i] for i in keep]
        table = {}
        for mask, arr in new.items():
            k2 = 0
            for j, i in enumerate(keep):
                if (mask >> i) & 1: k2 |= 1 << j
            table[k2] = table.get(k2, 0) + arr
    arr = table[0]
    assert arr.sum() == 2 ** n
    return {t - off: int(c) for t, c in enumerate(arr) if c}

G = c60()
for seed in (5, 7):
    _, order = best_order(G, 100, seed)
    res = count_t(G, order)
    tmax = max(res)
    print('order seed', seed, ': max |D|-e(D) =', tmax, ' number of maximisers =', res[tmax])

# Separate check of the M = 12 plateau: maximum independent sets = maximum cliques of the complement
H = nx.complement(G)
cl = [c for c in nx.find_cliques(H) if len(c) >= 24]
print('independence number:', max(len(c) for c in nx.find_cliques(H)), ' maximum independent sets:', sum(len(c) == 24 for c in cl))
