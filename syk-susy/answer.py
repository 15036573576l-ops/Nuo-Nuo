# Assemble the final quantity: kurtosis of the disorder-averaged density of states of H = Q^2
#   m_k(H) = m_{2k}(Q);  kurtosis = mu_4 / mu_2^2 with mu_j the central moments of that density.
import sympy as sp
from chord import moment_ratio, matchings, crossing_pairs
import sys

q = 3
N = sp.Symbol('N')
R = {1: sp.Integer(1)}
for p in (2, 3, 4):
    _, R[p], _ = moment_ratio(p, q)
m1, m2, m3, m4 = R[1], R[2], R[3], R[4]          # in units of m_1(H) = m_2(Q)
mu2 = m2 - m1 ** 2
mu4 = m4 - 4 * m3 * m1 + 6 * m2 * m1 ** 2 - 3 * m1 ** 4
kurt = sp.factor(sp.cancel(mu4 / mu2 ** 2))
print('mu2/m1^2 =', sp.factor(sp.cancel(mu2)))
print('kurtosis(N) =', kurt)
print('large-N series:', sp.series(kurt.subs(N, 1 / sp.Symbol('x')), sp.Symbol('x'), 0, 3))
for n in [6, 8, 10, 12, 16, 20, 24, 32, 64]:
    v = sp.nsimplify(kurt.subs(N, n))
    print('N =', n, ' kurtosis =', v, '=', sp.N(v, 15))

# Trap 1: naive q-Hermite / large-N rule W(D) = eta^{#crossings} with the exact finite-N eta
eta = sp.factor(sum((-1) ** ((q * q - x) % 2) * sp.binomial(q, x) * sp.binomial(N - q, q - x) for x in range(q + 1)) / sp.binomial(N, q))
def naive(p):
    return sum(eta ** len(crossing_pairs(m)) for m in matchings(list(range(2 * p))))
n2, n3, n4 = naive(2), naive(3), naive(4)
kn = sp.cancel((n4 - 4 * n3 + 6 * n2 - 3) / (n2 - 1) ** 2)
print('trap (eta^crossings) at N=32:', sp.nsimplify(kn.subs(N, 32)), '=', sp.N(kn.subs(N, 32), 15))
