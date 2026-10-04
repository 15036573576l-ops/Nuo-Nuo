# Exact disorder-averaged moments of the N=1 supersymmetric SYK supercharge
#   Q = i * sum_{a<b<c} C_abc psi_a psi_b psi_c ,  {psi_a, psi_b} = delta_ab,  C iid Gaussian
# m_{2p}(Q) / m_2(Q)^p = sum over perfect matchings D of 2p points of W_N(D),
#   W_N(D) = E_{A_1..A_p iid uniform q-subsets of [N]} prod_{(i,j) crossing in D} s(|A_i & A_j|),
#   s(x) = (-1)^(q*q - x)   (graded commutation sign of two degree-q Majorana monomials).
# The expectation is computed exactly by summing over Venn-region counts.
import sys, itertools
from fractions import Fraction
from math import comb, factorial
import sympy as sp

def matchings(pts):
    if not pts:
        yield []
        return
    a = pts[0]
    for k in range(1, len(pts)):
        b = pts[k]
        rest = pts[1:k] + pts[k + 1:]
        for m in matchings(rest):
            yield [(a, b)] + m

def crossing_pairs(m):
    E = []
    for i in range(len(m)):
        for j in range(i + 1, len(m)):
            (a, b), (c, d) = sorted(m[i]), sorted(m[j])
            if (a < c < b < d) or (c < a < d < b):
                E.append((i, j))
    return E

def region_configs(p, q):
    # region counts c_S for nonempty S subset of {0..p-1}, with sum_{S contains i} c_S = q
    regs = [S for r in range(1, p + 1) for S in itertools.combinations(range(p), r)]
    out = []
    def rec(idx, rem, cur):
        if idx == len(regs):
            if all(x == 0 for x in rem):
                out.append(dict(cur))
            return
        S = regs[idx]
        mx = min(rem[i] for i in S)
        for c in range(mx + 1):
            for i in S: rem[i] -= c
            if c: cur[S] = c
            rec(idx + 1, rem, cur)
            if c: del cur[S]
            for i in S: rem[i] += c
    rec(0, [q] * p, {})
    return regs, out

def weight_poly(E, p, q, Nsym):
    # returns exact rational function W_N as sympy expression in N
    regs, cfgs = region_configs(p, q)
    tot = 0
    for c in cfgs:
        used = sum(c.values())
        sign = 1
        for (i, j) in E:
            x = sum(v for S, v in c.items() if i in S and j in S)
            sign *= (-1) ** ((q * q - x) % 2)
        mult = sp.Integer(1)
        for v in c.values(): mult /= factorial(v)
        ff = sp.ff(Nsym, used)  # falling factorial N(N-1)...(N-used+1)
        tot += sign * mult * ff
    return sp.factor(tot / sp.binomial(Nsym, q).expand(func=True) ** p)

def moment_ratio(p, q):
    N = sp.Symbol('N')
    graphs = {}
    for m in matchings(list(range(2 * p))):
        E = tuple(crossing_pairs(m))
        graphs[E] = graphs.get(E, 0) + 1
    # group by isomorphism class is not needed; cache by edge set
    total = 0
    cache = {}
    for E, cnt in graphs.items():
        key = E
        if key not in cache:
            cache[key] = weight_poly(E, p, q, N)
        total += cnt * cache[key]
    return N, sp.factor(sp.together(total)), graphs

if __name__ == '__main__':
    p = int(sys.argv[1]); q = int(sys.argv[2])
    N, R, graphs = moment_ratio(p, q)
    print('number of matchings:', sum(graphs.values()), ' distinct crossing sets:', len(graphs))
    print('m_%d/m_2^%d =' % (2 * p, p), R)
    for n in sys.argv[3:]:
        n = int(n)
        print('N =', n, ':', sp.nsimplify(R.subs(N, n)), '=', float(R.subs(N, n)))
