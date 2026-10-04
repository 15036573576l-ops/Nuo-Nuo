# Greedy vertex orderings with small frontier (path-decomposition style) for the transfer-matrix DP.
import random
from c60 import c60

def frontier_profile(G, order):
    pos = {v: i for i, v in enumerate(order)}
    done = set(); front = []; mx = 0
    for v in order:
        done.add(v); front.append(v)
        front = [u for u in front if any(w not in done for w in G[u])]
        mx = max(mx, len(front) + (0))
    return mx

def greedy(G, start, rng):
    order = [start]; done = {start}
    while len(order) < G.number_of_nodes():
        front = [u for u in done if any(w not in done for w in G[u])]
        cand = {w for u in front for w in G[u] if w not in done}
        def score(w):
            d2 = done | {w}
            f = sum(1 for u in list(front) + [w] if any(x not in d2 for x in G[u]))
            return (f, rng.random())
        w = min(cand, key=score)
        order.append(w); done.add(w)
    return order

def best_order(G, tries=300, seed=0):
    rng = random.Random(seed); best = None
    for t in range(tries):
        o = greedy(G, rng.randrange(G.number_of_nodes()), rng)
        w = frontier_profile(G, o)
        if best is None or w < best[0]: best = (w, o)
    return best

if __name__ == '__main__':
    G = c60()
    for seed in range(3):
        w, o = best_order(G, 200, seed)
        print('seed', seed, 'max frontier', w)
