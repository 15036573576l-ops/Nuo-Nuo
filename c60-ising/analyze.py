# Ground states of H = J sum s_i s_j - h sum s_i (J = 1) on C60 from the exact DOS.
import numpy as np
from fractions import Fraction
g = np.load('dos_seed0.npy'); m, n = 90, 60
Bv = np.arange(-m, m + 1); Mv = np.arange(-n, n + 1)
print('zero-field: min B =', Bv[np.nonzero(g.sum(1))[0][0]], ' degeneracy =', g.sum(1)[np.nonzero(g.sum(1))[0][0]])
rows = []
for j, M in enumerate(Mv):
    col = g[:, j]
    if col.sum() == 0: continue
    i = np.nonzero(col)[0][0]
    rows.append((int(M), int(Bv[i]), int(col[i])))
print('M, min B(M), count  (M >= 0)')
for M, B, c in rows:
    if M >= 0: print(M, B, c)
# lower envelope of E(h) = B - h M over M, for h >= 0
def ground(h):
    E = [(B - h * M, M, c) for M, B, c in rows]
    e0 = min(x[0] for x in E)
    return e0, [(M, c) for e, M, c in E if e == e0]
crit = sorted({Fraction(B2 - B1, M2 - M1) for M1, B1, _ in rows for M2, B2, _ in rows if M2 > M1 and Fraction(B2 - B1, M2 - M1) >= 0})
print('\nlevel crossings (h, ground-state sectors and degeneracy):')
for h in crit:
    e0, gs = ground(h)
    if len(gs) > 1:
        print('h =', h, ' E0 =', e0, ' sectors', gs, ' total degeneracy', sum(c for _, c in gs))
print('\nplateaus (between crossings):')
for h in [Fraction(1, 2), Fraction(2), Fraction(4)]:
    e0, gs = ground(h)
    print('h =', h, 'sectors', gs, 'deg', sum(c for _, c in gs))
