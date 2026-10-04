# Build the C60 (truncated icosahedron) graph combinatorially from the icosahedron.
import itertools
import networkx as nx

def icosahedron():
    phi = (1 + 5 ** 0.5) / 2
    P = []
    for s1 in (1, -1):
        for s2 in (1, -1):
            P += [(0, s1, s2 * phi), (s1, s2 * phi, 0), (s2 * phi, 0, s1)]
    G = nx.Graph()
    for i, j in itertools.combinations(range(12), 2):
        d = sum((a - b) ** 2 for a, b in zip(P[i], P[j]))
        if abs(d - 4) < 1e-9: G.add_edge(i, j)
    return G

def c60():
    I = icosahedron()
    assert I.number_of_edges() == 30 and all(d == 5 for _, d in I.degree())
    V = {}
    for u, v in I.edges():
        for a, b in ((u, v), (v, u)): V[(a, b)] = len(V)
    G = nx.Graph()
    for u, v in I.edges(): G.add_edge(V[(u, v)], V[(v, u)])          # 6:6 bonds
    for u in I.nodes():
        for v, w in itertools.combinations(list(I[u]), 2):
            if I.has_edge(v, w): G.add_edge(V[(u, v)], V[(u, w)])    # pentagon around u
    return G

if __name__ == '__main__':
    G = c60()
    print('V =', G.number_of_nodes(), 'E =', G.number_of_edges(), 'cubic:', all(d == 3 for _, d in G.degree()),
          'planar:', nx.check_planarity(G)[0], 'girth 5:', nx.girth(G))
    cyc = [c for c in nx.simple_cycles(G, length_bound=6)]
    print('5-cycles:', sum(len(c) == 5 for c in cyc), ' 6-cycles:', sum(len(c) == 6 for c in cyc))
    import networkx.algorithms.isomorphism as iso
    print('automorphisms:', sum(1 for _ in iso.GraphMatcher(G, G).isomorphisms_iter()))
