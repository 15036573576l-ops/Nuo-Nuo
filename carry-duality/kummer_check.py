# 校验 Kummer/Legendre 化简：直接算二项式系数的 p-进赋值，和“进位数”对账
from math import comb

def vp(x, p):
    k = 0
    while x % p == 0:
        x //= p; k += 1
    return k

def digits(x, b):
    d = []
    while x:
        x, r = divmod(x, b); d.append(r)
    return d or [0]

def doubling_carries(m, b):
    # m + m 在 b 进制下的进位次数
    c = cnt = 0
    for d in digits(m, b):
        c = 1 if 2 * d + c >= b else 0
        cnt += c
    return cnt

pairs = [(2, 3), (2, 5), (3, 5), (2, 7), (3, 7), (5, 7)]
bad = 0
for p, q in pairs:
    for n in range(0, 9 if q <= 5 else 7):
        for (a, b) in ((p, q), (q, p)):
            m = a ** n
            direct = vp(comb(2 * m, m), b)
            if direct != doubling_carries(m, b):
                bad += 1
                print("MISMATCH", a, b, n)
        if p == 2:
            assert vp(comb(2 * q ** n, q ** n), 2) == bin(q ** n).count("1")
print("Kummer 对账失败数:", bad)

# Erdős 零点：nu_3(C(2^n)) = 0 <=> 2^n 的三进制只含 0,1
zeros = [n for n in range(0, 2000) if doubling_carries(2 ** n, 3) == 0]
print("n<2000 中 nu_3(C(2^n))=0 的 n:", zeros)
print("2^8 三进制:", "".join(map(str, reversed(digits(256, 3)))))
