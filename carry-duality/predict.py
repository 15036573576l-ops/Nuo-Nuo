# 高斯律的理论预测：把数字当作 iid 均匀、且两个数（q^n 的 p 进制、p^n 的 q 进制）相互独立时，
#   D = (A*B - n^2/4)/n^1.5  ->  N(0, sigma^2),  sigma^2 = (k_p ln^2 p + k_q ln^2 q) / (4 ln p ln q)
# k_b = 每位进位数的渐近方差：b 偶数时 1/4，b 奇数时 (b+1)/(4(b-1))
from fractions import Fraction as F
from math import log, sqrt
import random

def kappa_exact(b):
    # 两状态进位链 c' = [2d + c >= b]，状态 1 的访问次数之和的渐近方差 = pi0*pi1*(1+lam)/(1-lam)
    a = F(sum(1 for d in range(b) if 2 * d >= b), b)          # P(0 -> 1)
    r = F(sum(1 for d in range(b) if 2 * d + 1 < b), b)       # P(1 -> 0)
    pi1 = a / (a + r); lam = 1 - a - r
    return (1 - pi1) * pi1 * (1 + lam) / (1 - lam)

for b in range(2, 60):
    k = kappa_exact(b)
    assert k == (F(1, 4) if b % 2 == 0 else F(b + 1, 4 * (b - 1))), b
print("k_b 闭式在 b = 2..59 全部和马尔可夫链精确值一致；k_2 =", kappa_exact(2), " k_3 =", kappa_exact(3), " k_5 =", kappa_exact(5))

# 随机抽查 k_3
random.seed(2); L, T = 3000, 1500; xs = []
for _ in range(T):
    c = cnt = 0
    for _ in range(L):
        c = 1 if 2 * random.randrange(3) + c >= 3 else 0; cnt += c
    xs.append(cnt)
m = sum(xs) / T
print(f"k_3 模拟值 {sum((x - m) ** 2 for x in xs) / T / L:.4f}（精确 0.5）")

def k(b): return float(kappa_exact(b))
print("\n(p,q)    sd(dA)预测  sd(dB)预测  sd(D)预测")
for p, q in [(2, 3), (2, 5), (3, 5), (2, 7), (3, 7), (5, 7), (2, 11), (7, 11)]:
    a = log(q) / log(p)
    sdA, sdB = sqrt(a * k(p)), sqrt(k(q) / a)
    sdD = sqrt((k(p) * log(p) ** 2 + k(q) * log(q) ** 2) / (4 * log(p) * log(q)))
    print(f"({p},{q})   {sdA:.4f}      {sdB:.4f}      {sdD:.4f}")
