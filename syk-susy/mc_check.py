# Monte Carlo sanity check: sample Gaussian couplings, diagonalise H = Q^2 exactly,
# accumulate moments of the averaged density of states, compare kurtosis with the exact formula.
import sys, itertools
import numpy as np
from matrix_check import majoranas

N = int(sys.argv[1]); S = int(sys.argv[2]); seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
rng = np.random.default_rng(seed)
psi = majoranas(N); d = psi[0].shape[0]
G = []
for A in itertools.combinations(range(N), 3):
    G.append(1j * psi[A[0]] @ psi[A[1]] @ psi[A[2]])
G = np.array(G)
mom = np.zeros((S, 5))
for s in range(S):
    C = rng.standard_normal(len(G))
    Q = np.tensordot(C, G, axes=1)
    e = np.linalg.eigvalsh(Q)
    E = e ** 2                      # spectrum of H = Q^2
    mom[s] = [np.mean(E ** k) for k in range(5)]
m = mom.mean(axis=0)
def kurt(m):
    mu2 = m[2] - m[1] ** 2
    mu4 = m[4] - 4 * m[3] * m[1] + 6 * m[2] * m[1] ** 2 - 3 * m[1] ** 4
    return mu4 / mu2 ** 2
# jackknife error over 20 blocks
B = 20; blocks = np.array_split(np.arange(S), B)
jk = [kurt(np.delete(mom, b, axis=0).mean(axis=0)) for b in blocks]
err = np.sqrt((B - 1) / B * np.sum((np.array(jk) - np.mean(jk)) ** 2))
print('N =', N, 'samples =', S, ' kurtosis =', kurt(m), '+-', err)
