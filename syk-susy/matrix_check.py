# Independent check: explicit Jordan-Wigner Majorana matrices + Wick theorem over the couplings,
# contracting tr(G_{x1} ... G_{x2p}) with numpy (no commutation-sign rule is used here).
import sys, itertools
import numpy as np
from fractions import Fraction

def majoranas(N):
    X = np.array([[0, 1], [1, 0]], dtype=complex)
    Y = np.array([[0, -1j], [1j, 0]], dtype=complex)
    Z = np.array([[1, 0], [0, -1]], dtype=complex)
    I = np.eye(2, dtype=complex)
    n = N // 2
    out = []
    for k in range(n):
        for P in (X, Y):
            ops = [Z] * k + [P] + [I] * (n - k - 1)
            M = ops[0]
            for o in ops[1:]: M = np.kron(M, o)
            out.append(M / np.sqrt(2))  # psi^2 = 1/2
    return out

def matchings(pts):
    if not pts:
        yield []; return
    a = pts[0]
    for k in range(1, len(pts)):
        rest = pts[1:k] + pts[k + 1:]
        for m in matchings(rest): yield [(a, pts[k])] + m

def run(N, p, q=3):
    psi = majoranas(N)
    d = psi[0].shape[0]
    G = []
    for A in itertools.combinations(range(N), q):
        M = np.eye(d, dtype=complex)
        for a in A: M = M @ psi[a]
        G.append((1j ** (q * (q - 1) // 2)) * M)  # Hermitian normalisation: i for q=3
    G = np.array(G)
    for g in G[:5]: assert np.allclose(g, g.conj().T)
    m2 = np.einsum('aij,aji->', G, G).real / d
    # K[i,j,k,l] = sum_A G_A[i,j] G_A[k,l]: one Wick contraction of a coupling pair
    K = np.einsum('aij,akl->ijkl', G, G, optimize=True)
    idx = 'ABCDEFGHIJKLMNOP'
    total = 0.0
    for m in matchings(list(range(2 * p))):
        terms = [idx[x] + idx[(x + 1) % (2 * p)] + idx[y] + idx[(y + 1) % (2 * p)] for (x, y) in m]
        val = np.einsum(','.join(terms) + '->', *([K] * p), optimize='optimal')
        total += val.real / d
    return total / m2 ** p

if __name__ == '__main__':
    p = int(sys.argv[1])
    for N in map(int, sys.argv[2:]):
        r = run(N, p)
        print('N =', N, ' m_%d/m_2^%d =' % (2 * p, p), r, ' as fraction ~', Fraction(r).limit_denominator(10 ** 7), flush=True)
