# Check a and b against full quantum exact diagonalisation on small cubic graphs.
import sys
import numpy as np, networkx as nx
import scipy.sparse as sps, scipy.sparse.linalg as spla
from order import best_order
from enum_gs import enumerate_optimal
from pt2 import pt_coeffs

def ed_coeffs(G, Ecl, gammas):
    n = G.number_of_nodes()
    idx = np.arange(2 ** n, dtype=np.int64)
    S = 1 - 2 * ((idx[:, None] >> np.arange(n)[None, :]) & 1)
    diag = np.zeros(2 ** n)
    for u, v in G.edges(): diag += S[:, u] * S[:, v]
    diag -= S.sum(1)
    assert diag.min() == Ecl
    rows = np.repeat(idx, n); cols = (idx[:, None] ^ (1 << np.arange(n))[None, :]).ravel()
    X = sps.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(2 ** n, 2 ** n))
    Dg = sps.diags(diag)
    E = []
    for g in gammas:
        E.append(spla.eigsh(Dg - g * X, k=1, which='SA', tol=1e-14, ncv=60)[0][0])
    y = (np.array(E) - Ecl)
    # fit y = -a g - b g^2 - c g^3 - d g^4
    V = np.vstack([-np.array(gammas) ** p for p in range(1, 8)]).T
    coef = np.linalg.lstsq(V, y, rcond=None)[0]
    return coef[0], coef[1]

cases = [('truncated tetrahedron', nx.truncated_tetrahedron_graph())]
for arg in sys.argv[1:]:
    nn, s = map(int, arg.split(':'))
    cases.append(('random cubic n=%d seed %d' % (nn, s), nx.random_regular_graph(3, nn, seed=s)))
for name, G in cases:
    G = nx.convert_node_labels_to_integers(G); n = G.number_of_nodes(); m = G.number_of_edges()
    _, order = best_order(G, 30, 0)
    opt, D = enumerate_optimal(G, order)
    Ecl = (m - n) - 4 * opt
    try:
        a, b, vals = pt_coeffs(D, G, n, verbose=False)
    except (AssertionError, IndexError):
        print(name, 'skipped (trivial or degenerate flip graph)'); continue
    ga = [0.004 * k for k in range(1, 13)]
    a_ed, b_ed = ed_coeffs(G, Ecl, ga)
    print('%s: PT a = %.10f b = %.10f | ED fit a = %.10f b = %.10f' % (name, a, b, a_ed, b_ed), flush=True)
