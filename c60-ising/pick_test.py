# Find small cubic graphs whose flip graph at h = J is nontrivial (lambda_max > 0), for ED tests.
import numpy as np, networkx as nx
from order import best_order
from enum_gs import enumerate_optimal
from flipgraph import flip_graph
cands = [('truncated tetrahedron', nx.truncated_tetrahedron_graph()), ('pappus', nx.pappus_graph()),
         ('desargues', nx.desargues_graph()), ('heawood', nx.heawood_graph()), ('mobius-kantor', nx.moebius_kantor_graph()),
         ('frucht', nx.frucht_graph()), ('cube', nx.cubical_graph())]
for s in range(12):
    cands.append(('random cubic n=20 seed %d' % s, nx.random_regular_graph(3, 20, seed=s)))
for name, G in cands:
    G = nx.convert_node_labels_to_integers(G)
    if not nx.is_connected(G): continue
    _, order = best_order(G, 30, 0)
    opt, D = enumerate_optimal(G, order)
    A = flip_graph(D, G.number_of_nodes()).toarray()
    lam = np.linalg.eigvalsh(A)[-1] if len(D) else 0
    print('%-28s n=%d  #GS=%d  lambda_max=%.10f' % (name, G.number_of_nodes(), len(D), lam))
