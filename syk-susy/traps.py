# Classify the 105 eight-point chord diagrams by intersection graph and show where the
# naive large-N rule W = eta^{#crossings} fails; evaluate some tempting wrong answers at N = 32.
import itertools
import networkx as nx
import sympy as sp
from chord import matchings, crossing_pairs, weight_poly, moment_ratio

q = 3; N = sp.Symbol('N'); n0 = 32
def canon(E, p=4):
    best = None
    for perm in itertools.permutations(range(p)):
        F = tuple(sorted(tuple(sorted((perm[i], perm[j]))) for i, j in E))
        if best is None or F < best: best = F
    return best
names = {(): 'empty', ((0, 1),): 'K2', ((0, 1), (0, 2)): 'P3', ((0, 1), (2, 3)): '2K2'}
cls = {}
for m in matchings(list(range(8))):
    E = tuple(crossing_pairs(m)); c = canon(E)
    cls.setdefault(c, [0, E])[0] += 1
eta = sp.factor(sum((-1) ** ((q * q - x) % 2) * sp.binomial(q, x) * sp.binomial(N - q, q - x) for x in range(q + 1)) / sp.binomial(N, q))
print('eta(N) =', eta, ' eta(32) =', eta.subs(N, n0))
print('%-28s %5s %8s  %-22s %-22s' % ('intersection graph (edges)', 'count', 'forest?', 'exact W(32)', 'eta^|E|(32)'))
for c, (cnt, E) in sorted(cls.items(), key=lambda t: (len(t[0]), t[0])):
    W = weight_poly(E, 4, q, N).subs(N, n0)
    g = nx.Graph(); g.add_nodes_from(range(4)); g.add_edges_from(c)
    forest = nx.is_forest(g)
    print('%-28s %5d %8s  %-22s %-22s' % (str(c), cnt, forest, sp.nsimplify(W), sp.nsimplify(eta.subs(N, n0) ** len(c))))

def kurt_from(R2, R3, R4):
    mu2 = R2 - 1; mu4 = R4 - 4 * R3 + 6 * R2 - 3
    return sp.Rational(mu4) / sp.Rational(mu2) ** 2 if all(isinstance(x, sp.Rational) for x in (R2, R3, R4)) else sp.cancel(mu4 / mu2 ** 2)

# exact
R = {p: moment_ratio(p, q)[1] for p in (2, 3, 4)}
ex = sp.cancel(kurt_from(*(R[p] for p in (2, 3, 4))).subs(N, n0))
# trap A: eta^crossings
na = {p: sum(eta ** len(crossing_pairs(m)) for m in matchings(list(range(2 * p)))) for p in (2, 3, 4)}
ta = sp.cancel(kurt_from(*(na[p] for p in (2, 3, 4))).subs(N, n0))
# trap B: even-q sign rule (-1)^{|A cap B|} used for the odd supercharge
import chord
def ratio_with_sign(p, signf):
    tot = 0
    cache = {}
    for m in matchings(list(range(2 * p))):
        E = tuple(crossing_pairs(m))
        if E not in cache:
            regs, cfgs = chord.region_configs(p, q)
            s = 0
            for c in cfgs:
                used = sum(c.values()); sg = 1
                for (i, j) in E:
                    sg *= signf(sum(v for S, v in c.items() if i in S and j in S))
                mult = sp.Integer(1)
                for v in c.values(): mult /= sp.factorial(v)
                s += sg * mult * sp.ff(n0, used)
            cache[E] = s / sp.binomial(n0, q) ** p
        tot += cache[E]
    return tot
tb = kurt_from(*(ratio_with_sign(p, lambda x: (-1) ** x) for p in (2, 3, 4)))
tc = sp.Rational(3) - sp.Rational(20, n0) + sp.Rational(160, n0 ** 2)
print()
print('exact     :', ex, '=', sp.N(ex, 12))
print('trap A (eta^crossings rule)       :', ta, '=', sp.N(ta, 12))
print('trap B (even-q sign (-1)^|AnB|)   :', tb, '=', sp.N(tb, 12))
print('trap C (large-N series to 1/N^2)  :', tc, '=', sp.N(tc, 12))
print('trap D (large-N limit)            : 3')
