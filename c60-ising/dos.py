# Exact joint density of states g(B, M) of the Ising model on a graph by a frontier transfer matrix:
#   B = sum_{edges} s_i s_j,  M = sum_i s_i,  s_i = +-1.  Counts are exact (int64, total 2^n < 2^63).
import sys, random
import numpy as np
from c60 import c60
from order import best_order

def dos(G, order):
    n = G.number_of_nodes(); m = G.number_of_edges()
    nB, nM = 2 * m + 1, 2 * n + 1          # index = value + offset
    done = set(); front = []
    table = {(): np.zeros((nB, nM), dtype=np.int64)}
    table[()][m, n] = 1
    for v in order:
        nbrs = [front.index(u) for u in G[v] if u in done]
        new = {}
        for key, arr in table.items():
            for s in (1, -1):
                db = s * sum(key[i] for i in nbrs)
                a = np.roll(np.roll(arr, db, axis=0), s, axis=1)  # no wrap-around: ranges are wide enough
                k2 = key + (s,)
                if k2 in new: new[k2] += a
                else: new[k2] = a
        done.add(v); front.append(v)
        keep = [i for i, u in enumerate(front) if any(w not in done for w in G[u])]
        front = [front[i] for i in keep]
        table = {}
        for key, arr in new.items():
            k2 = tuple(key[i] for i in keep)
            if k2 in table: table[k2] += arr
            else: table[k2] = arr
    assert list(table.keys()) == [()]
    return table[()], m, n

if __name__ == '__main__':
    G = c60()
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    w, order = best_order(G, 200, seed)
    g, m, n = dos(G, order)
    assert g.sum() == 2 ** n
    np.save('dos_seed%d.npy' % seed, g)
    print('frontier', w, 'total states ok, saved')
