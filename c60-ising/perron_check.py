# Rigour check for a: the eigenvector found is strictly positive on the giant component,
# so by Perron-Frobenius its eigenvalue is that component's spectral radius (others are isolated states).
import numpy as np, scipy.sparse as sps, scipy.sparse.linalg as spla
from flipgraph import flip_graph
D = np.load('gs_masks.npy'); A = flip_graph(D, 60)
ncomp, lab = sps.csgraph.connected_components(A, directed=False)
big = np.bincount(lab).argmax(); idx = np.nonzero(lab == big)[0]
B = A[idx][:, idx]
w, v = spla.eigsh(B, k=1, which='LA', tol=1e-15, ncv=40)
psi = v[:, 0] * np.sign(v[:, 0].sum())
print('lambda = %.13f' % w[0], ' residual = %.2e' % np.linalg.norm(B @ psi - w[0] * psi),
      ' min entry = %.3e' % psi.min(), ' all positive:', bool((psi > 0).all()))
iso = np.nonzero(np.bincount(lab) == 1)[0]
for c in iso:
    x = int(D[lab == c][0]); print('isolated state: |D| =', bin(x).count('1'), ' M =', 60 - 2 * bin(x).count('1'))
