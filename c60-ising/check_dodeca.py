# Validate the first-order degenerate-perturbation-theory recipe on the dodecahedron (20 spins):
# full quantum exact diagonalisation of H = sum zz - h sum z - Gamma sum x at h = J = 1, small Gamma,
# versus lambda_max of the flip graph built by the same code used for C60.
import numpy as np, networkx as nx
import scipy.sparse as sps, scipy.sparse.linalg as spla
from order import best_order
from enum_gs import enumerate_optimal
from flipgraph import flip_graph

G = nx.convert_node_labels_to_integers(nx.dodecahedral_graph()); n = 20; m = 30
_, order = best_order(G, 50, 0)
opt, D = enumerate_optimal(G, order)
A = flip_graph(D, n)
lam = spla.eigsh(A.astype(float), k=1, which='LA')[0][0] if A.shape[0] > 50 else np.linalg.eigvalsh(A.toarray())[-1]
Ecl = (m - n) - 4 * opt
print('dodecahedron: ground states at h=J:', len(D), ' E_cl =', Ecl, ' lambda_max(flip graph) =', lam)

# full ED; bit i = 1 means spin down (s = -1)
idx = np.arange(2 ** n, dtype=np.int64)
S = 1 - 2 * ((idx[:, None] >> np.arange(n)[None, :]) & 1)
diag = np.zeros(2 ** n)
for u, v in G.edges(): diag += S[:, u] * S[:, v]
diag -= S.sum(1)
print('classical minimum from full enumeration:', diag.min(), ' degeneracy:', int((diag == diag.min()).sum()))
rows = np.repeat(idx, n); cols = (idx[:, None] ^ (1 << np.arange(n))[None, :]).ravel()
X = sps.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(2 ** n, 2 ** n))
Dg = sps.diags(diag)
s = {}
for g in (1e-3, 2e-3, 4e-3):
    E0 = spla.eigsh(Dg - g * X, k=1, which='SA', tol=1e-13)[0][0]
    s[g] = (Ecl - E0) / g
    print('Gamma =', g, ' (E_cl - E0)/Gamma =', s[g])
print('Richardson extrapolation to Gamma -> 0:', 2 * s[1e-3] - s[2e-3], ' vs lambda_max =', lam)
