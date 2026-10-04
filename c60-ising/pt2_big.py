# Memory-light version of pt2.py for C60 (3.47 million ground states, ~10^8 excited states).
import sys
import numpy as np
import scipy.sparse as sps
import scipy.sparse.linalg as spla
from c60 import c60
from flipgraph import flip_graph


def b_bucketed(D, G, n, psi, NB=8):
    N = len(D)
    sup = np.abs(psi) > 1e-300
    Ds = D[sup]; ps = psi[sup]
    nbrs = [list(G[i]) for i in range(n)]
    one = np.uint64(1)
    def bit(x, i): return ((x >> np.uint64(i)) & one).astype(np.int8)
    b = 0.0; nexc = 0
    for bucket in range(NB):
        keys, amps, dens = [], [], []
        for i in range(n):
            k = Ds ^ (one << np.uint64(i))
            hb = ((k * np.uint64(0x9E3779B97F4A7C15)) >> np.uint64(61)).astype(np.int64)
            sel = hb == bucket
            k = k[sel]
            j = np.searchsorted(D, k); j[j == N] = 0
            out = D[j] != k
            si = 1 - 2 * bit(Ds[sel], i).astype(np.int64)
            nb = sum(1 - 2 * bit(Ds[sel], q).astype(np.int64) for q in nbrs[i])
            dE = 2 * si * (1 - nb)
            keys.append(k[out]); amps.append(ps[sel][out]); dens.append(dE[out])
        keys = np.concatenate(keys); amps = np.concatenate(amps); dens = np.concatenate(dens)
        if len(keys) == 0: continue
        assert (dens > 0).all()
        o = np.argsort(keys); keys = keys[o]; amps = amps[o]; dens = dens[o]
        start = np.concatenate(([0], np.nonzero(np.diff(keys))[0] + 1))
        assert (np.maximum.reduceat(dens, start) == np.minimum.reduceat(dens, start)).all()
        tot = np.add.reduceat(amps, start)
        b += float(np.sum(tot ** 2 / dens[start])); nexc += len(start)
    return b, nexc

if __name__ == '__main__':
    G = c60(); n = 60
    D = np.load('gs_masks.npy'); N = len(D)
    A = flip_graph(D, n)
    ncomp, lab = sps.csgraph.connected_components(A, directed=False)
    sizes = np.bincount(lab)
    print('components:', ncomp, ' sizes:', sorted(sizes.tolist(), reverse=True))
    vals, vecs = spla.eigsh(A, k=6, which='LA', tol=1e-15, maxiter=500000, ncv=40)
    o = np.argsort(vals)[::-1]; vals = vals[o]; vecs = vecs[:, o]
    print('top eigenvalues:', ['%.12f' % v for v in vals])
    a = vals[0]; psi = vecs[:, 0]; psi /= np.linalg.norm(psi)
    if psi.sum() < 0: psi = -psi
    print('residual |A psi - a psi| =', np.linalg.norm(A @ psi - a * psi))
    sup = np.abs(psi) > 1e-300
    print('Perron vector support size:', int(sup.sum()), ' component labels on support:', np.unique(lab[sup]))
    for c in range(ncomp):   # per-component largest eigenvalue
        idx = np.nonzero(lab == c)[0]
        sub = A[idx][:, idx]
        lv = spla.eigsh(sub, k=1, which='LA', tol=1e-14)[0][0] if len(idx) > 10 else np.linalg.eigvalsh(sub.toarray())[-1]
        print('  component', c, 'size', len(idx), 'lambda_max %.12f' % lv)
    Ds = D[sup]; ps = psi[sup]
    M = 60 - 2 * np.array([bin(int(x)).count('1') for x in Ds])
    print('<M> in the first-order ground state:', float(np.sum(ps ** 2 * M)))
    b, nexc = b_bucketed(D, G, n, psi)
    print('excited states reached:', nexc)
    print('C60 RESULT: a = %.12f  b = %.12f' % (a, b))
