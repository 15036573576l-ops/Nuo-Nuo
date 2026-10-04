# First-order degenerate perturbation theory in a transverse field -Gamma sum sigma^x:
# H_eff = -Gamma * A, A = adjacency matrix of the single-spin-flip graph on the classical
# ground-state manifold.  E_0 = E_cl - c Gamma + O(Gamma^2) with c = lambda_max(A).
import sys
import numpy as np
import scipy.sparse as sps
import scipy.sparse.linalg as spla

def t_value(masks, G):
    n = G.number_of_nodes()
    bits = ((masks[:, None] >> np.arange(n, dtype=np.uint64)[None, :]) & np.uint64(1)).astype(np.int64)
    e = np.zeros(len(masks), dtype=np.int64)
    for u, v in G.edges(): e += bits[:, u] * bits[:, v]
    return bits.sum(1) - e

def flip_graph(masks, n):
    N = len(masks); rows, cols = [], []
    for i in range(n):
        tgt = masks ^ (np.uint64(1) << np.uint64(i))
        j = np.searchsorted(masks, tgt)
        j[j == N] = 0
        hit = masks[j] == tgt
        rows.append(np.nonzero(hit)[0]); cols.append(j[hit])
    r = np.concatenate(rows); c = np.concatenate(cols)
    A = sps.csr_matrix((np.ones(len(r)), (r, c)), shape=(N, N))
    return A

if __name__ == '__main__':
    from c60 import c60
    G = c60()
    D = np.load('gs_masks.npy')
    tv = t_value(D, G)
    print('all states have |D|-e(D) = 24:', bool((tv == 24).all()))
    A = flip_graph(D, 60)
    print('symmetric:', (A != A.T).nnz == 0, ' edges:', A.nnz // 2, ' max degree:', int(A.sum(1).max()))
    ncomp, lab = sps.csgraph.connected_components(A, directed=False)
    print('connected components:', ncomp)
    vals, vecs = spla.eigsh(A, k=3, which='LA', tol=1e-14, maxiter=100000)
    print('top eigenvalues (ARPACK):', vals[::-1])
    np.save('topvec.npy', vecs[:, -1])
