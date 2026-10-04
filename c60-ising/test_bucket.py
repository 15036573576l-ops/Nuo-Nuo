# Cross-check the bucketed second-order sum (used for C60) against pt2.py (ED-validated) on other graphs.
import numpy as np, networkx as nx
from order import best_order
from enum_gs import enumerate_optimal
from pt2 import pt_coeffs
from pt2_big import b_bucketed
from flipgraph import flip_graph
import scipy.sparse.linalg as spla
for name, G in [('truncated tetrahedron', nx.truncated_tetrahedron_graph())] + \
        [('random cubic n=%d seed %d' % (nn, s), nx.random_regular_graph(3, nn, seed=s)) for nn, s in [(20, 7), (30, 1), (40, 2), (48, 3)]]:
    G = nx.convert_node_labels_to_integers(G); n = G.number_of_nodes()
    if not nx.is_connected(G): continue
    _, order = best_order(G, 30, 0)
    opt, D = enumerate_optimal(G, order)
    try:
        a, b, vals = pt_coeffs(D, G, n, verbose=False)
    except AssertionError as e:
        print(name, 'skipped:', e); continue
    A = flip_graph(D, n)
    if len(D) > 2000:
        w, v = spla.eigsh(A, k=2, which='LA', tol=1e-15); psi = v[:, np.argmax(w)]
    else:
        w, v = np.linalg.eigh(A.toarray()); psi = v[:, -1]
    psi = psi / np.linalg.norm(psi); psi = psi if psi.sum() > 0 else -psi
    b2, _ = b_bucketed(D, G, n, psi)
    print('%-26s #GS=%-7d a=%.10f  b(pt2)=%.10f  b(bucketed)=%.10f' % (name, len(D), a, b, b2), flush=True)
