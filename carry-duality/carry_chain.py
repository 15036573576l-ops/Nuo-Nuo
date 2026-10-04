# 启发式常数：数字 iid 均匀时，b 进制下 m+m 每一位的进位概率（平稳分布下）恰为 1/2
from fractions import Fraction as F
import random

def stationary_carry_prob(b):
    # 进位链：c' = [2d + c >= b]
    t = [[F(0)] * 2 for _ in range(2)]
    for c in (0, 1):
        for d in range(b):
            t[c][1 if 2 * d + c >= b else 0] += F(1, b)
    # 两状态链平稳分布
    a, bb = t[0][1], t[1][0]
    pi1 = a / (a + bb)
    return (1 - pi1) * t[0][1] + pi1 * t[1][1]

print({b: str(stationary_carry_prob(b)) for b in [2, 3, 4, 5, 6, 7, 10, 11, 13, 97]})
assert all(stationary_carry_prob(b) == F(1, 2) for b in range(2, 200))
print("b = 2..199 全部为 1/2")

# 随机整数抽查
random.seed(1)
for b in (2, 3, 5, 7):
    L, T = 4000, 200
    tot = 0
    for _ in range(T):
        c = cnt = 0
        for _ in range(L):
            d = random.randrange(b); c = 1 if 2 * d + c >= b else 0; cnt += c
        tot += cnt
    print(f"b={b}: 随机数字进位频率 {tot / (L * T):.4f}")
