# Validate the transfer-matrix DP against brute force on small cubic graphs (2^20 states).
import numpy as np, networkx as nx, itertools
from dos import dos
from order import best_order

def brute(G):
    n = G.number_of_nodes(); m = G.number_of_edges()
    idx = {v: i for i, v in enumerate(G.nodes())}
    S = ((np.arange(2 ** n)[:, None] >> np.arange(n)[None, :]) & 1) * 2 - 1
    B = np.zeros(2 ** n, dtype=np.int64)
    for u, v in G.edges(): B += S[:, idx[u]] * S[:, idx[v]]
    M = S.sum(axis=1)
    g = np.zeros((2 * m + 1, 2 * n + 1), dtype=np.int64)
    np.add.at(g, (B + m, M + n), 1)
    return g

for name, G in [('dodecahedron', nx.dodecahedral_graph()), ('petersen', nx.petersen_graph()),
                ('truncated tetrahedron', nx.truncated_tetrahedron_graph()), ('desargues', nx.desargues_graph())]:
    G = nx.convert_node_labels_to_integers(G)
    w, order = best_order(G, 50, 1)
    g1, _, _ = dos(G, order); g2 = brute(G)
    print(name, 'n =', G.number_of_nodes(), 'DP == brute force:', (g1 == g2).all())
