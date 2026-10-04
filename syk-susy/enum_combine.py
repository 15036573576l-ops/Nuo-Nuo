# Turn the parity histogram from enum32.c into m4, m6, m8 ratios and the kurtosis,
# without using the Venn-region formula; compare with chord.py.
import sys
from fractions import Fraction
import sympy as sp
from chord import matchings, crossing_pairs, moment_ratio

PAIRS = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
def load(path):
    lines = open(path).read().split()
    N, M = int(lines[0]), int(lines[1])
    return N, M, [int(x) for x in lines[2:66]]

def ratio(p, cnt, M):
    # sign for a crossing pair with intersection parity b: (-1)^(9 - x) = -(-1)^b
    tot = Fraction(0)
    for m in matchings(list(range(2 * p))):
        E = crossing_pairs(m)
        s = 0
        for pat in range(64):
            sg = 1
            for (i, j) in E:
                b = (pat >> PAIRS.index((i, j))) & 1
                sg *= -1 if b == 0 else 1
            s += sg * cnt[pat]
        tot += Fraction(s, M ** 3)   # A1 fixed, A2..A4 free (unused sets just multiply by M)
    return tot

if __name__ == '__main__':
    Nsym = sp.Symbol('N')
    exact = {p: moment_ratio(p, 3)[1] for p in (2, 3, 4)}
    for path in sys.argv[1:]:
        N, M, cnt = load(path)
        r = {p: ratio(p, cnt, M) for p in (2, 3, 4)}
        ok = all(sp.Rational(r[p].numerator, r[p].denominator) == sp.nsimplify(exact[p].subs(Nsym, N)) for p in (2, 3, 4))
        mu2 = r[2] - 1; mu4 = r[4] - 4 * r[3] + 6 * r[2] - 3
        k = mu4 / mu2 ** 2
        print('N =', N, ' m4,m6,m8 ratios =', r[2], r[3], r[4], ' match chord.py:', ok, ' kurtosis =', k, '=', float(k))
