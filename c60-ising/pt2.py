# Degenerate perturbation theory for H = J sum_{<ij>} s_i s_j - h sum s_i - Gamma sum sigma^x_i at h = J = 1:
#   E_0 = E_cl - a Gamma - b Gamma^2 + O(Gamma^3)
#   a = lambda_max(A),  A = single-flip adjacency on the classical ground manifold P,
#   b = sum_{k not in P} ( sum_{s in P, s~k} psi_s )^2 / (E_k - E_cl),  psi = Perron vector of A.
# Requires lambda_max to be non-degenerate (checked).
import numpy as np
import scipy.sparse as sps
import scipy.sparse.linalg as spla

def energies_flip(masks, G, n):
    # classical energy change for flipping each spin, h = J = 1; bit=1 means s=-1
    bits = ((masks[:, None] >> np.arange(n, dtype=np.uint64)[None, :]) & np.uint64(1)).astype(np.int8)
    s = 1 - 2 * bits.astype(np.int64)
    nbsum = np.zeros_like(s)
    for u, v in G.edges():
        nbsum[:, u] += s[:, v]; nbsum[:, v] += s[:, u]
    return 2 * s * (1 - nbsum)          # dE_i = 2 s_i (h - sum_j s_j)

def pt_coeffs(masks, G, n, A=None, k_eigs=4, verbose=True):
    from flipgraph import flip_graph
    if A is None: A = flip_graph(masks, n)
    N = len(masks)
    if N > 2000:
        vals, vecs = spla.eigsh(A.astype(float), k=k_eigs, which='LA', tol=1e-15, maxiter=200000)
    else:
        vals, vecs = np.linalg.eigh(A.toarray().astype(float))
    order = np.argsort(vals)[::-1]; vals = vals[order]; vecs = vecs[:, order]
    a = vals[0]
    assert vals[0] - vals[1] > 1e-6, 'top eigenvalue degenerate'
    psi = vecs[:, 0]; psi = psi / np.linalg.norm(psi)
    if psi.sum() < 0: psi = -psi
    sup = np.abs(psi) > 0
    dE = energies_flip(masks[sup], G, n)
    keys, amps, dens = [], [], []
    for i in range(n):
        k = masks[sup] ^ (np.uint64(1) << np.uint64(i))
        j = np.searchsorted(masks, k); j[j == N] = 0
        out = masks[j] != k                     # excited states only (Q space)
        keys.append(k[out]); amps.append(psi[sup][out]); dens.append(dE[out, i])
    keys = np.concatenate(keys); amps = np.concatenate(amps); dens = np.concatenate(dens)
    assert (dens > 0).all()
    o = np.argsort(keys, kind='stable'); keys = keys[o]; amps = amps[o]; dens = dens[o]
    start = np.concatenate(([0], np.nonzero(np.diff(keys))[0] + 1))
    tot = np.add.reduceat(amps, start)
    den = dens[start]
    # consistency: every flip reaching the same k must see the same excitation energy
    assert (np.maximum.reduceat(dens, start) == np.minimum.reduceat(dens, start)).all()
    b = float(np.sum(tot ** 2 / den))
    if verbose:
        print('  top eigenvalues:', vals[:k_eigs])
        print('  excited states reached:', len(start))
    return a, b, vals

if __name__ == '__main__':
    import sys
    from c60 import c60
    G = c60()
    D = np.load('gs_masks.npy')
    a, b, vals = pt_coeffs(D, G, 60, k_eigs=6)
    print('C60: a =', repr(a), ' b =', repr(b))
