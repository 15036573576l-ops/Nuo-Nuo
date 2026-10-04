/* 涨落的精细检验：两个因子各自的涨落、它们之间的相关系数、乘积偏差的分布形状
 *   dA = (A - LA/2)/sqrt(n),  dB = (B - LB/2)/sqrt(n),  D = (A*B - n^2/4)/n^1.5
 * 其中 LA, LB 是 q^n 的 p 进制位数、p^n 的 q 进制位数。
 * 用法: ./clt p q N n0
 */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

static int mul(unsigned char *d, int len, int base, int k) {
    int c = 0, i;
    for (i = 0; i < len; i++) { int t = d[i] * k + c; d[i] = t % base; c = t / base; }
    while (c) { d[len++] = c % base; c /= base; }
    return len;
}
static long carries(const unsigned char *d, int len, int base) {
    int c = 0; long cnt = 0;
    for (int i = 0; i < len; i++) { c = (2 * d[i] + c >= base); cnt += c; }
    return cnt;
}
int main(int argc, char **argv) {
    int p = atoi(argv[1]), q = atoi(argv[2]), N = atoi(argv[3]), n0 = atoi(argv[4]);
    int capA = (int)(N * log(q) / log(p)) + 64, capB = (int)(N * log(p) / log(q)) + 64;
    unsigned char *a = calloc(capA, 1), *b = calloc(capB, 1);
    int la = 1, lb = 1; a[0] = 1; b[0] = 1;
    double sA = 0, sA2 = 0, sB = 0, sB2 = 0, sAB = 0, sD = 0, sD2 = 0, sD3 = 0, sD4 = 0;
    double *Ds = malloc(sizeof(double) * (N + 1)); long m = 0;
    for (int n = 1; n <= N; n++) {
        la = mul(a, la, p, q); lb = mul(b, lb, q, p);
        if (n < n0) continue;
        double A = carries(a, la, p), B = carries(b, lb, q), rn = sqrt((double)n);
        double dA = (A - la / 2.0) / rn, dB = (B - lb / 2.0) / rn, D = (A * B - (double)n * n / 4) / (n * rn);
        sA += dA; sA2 += dA * dA; sB += dB; sB2 += dB * dB; sAB += dA * dB;
        sD += D; sD2 += D * D; sD3 += D * D * D; sD4 += D * D * D * D; Ds[m++] = D;
    }
    double mA = sA / m, mB = sB / m, vA = sA2 / m - mA * mA, vB = sB2 / m - mB * mB;
    double corr = (sAB / m - mA * mB) / sqrt(vA * vB);
    double mD = sD / m, vD = sD2 / m - mD * mD, sd = sqrt(vD);
    double m3 = sD3 / m - 3 * mD * sD2 / m + 2 * mD * mD * mD;
    double m4 = sD4 / m - 4 * mD * sD3 / m + 6 * mD * mD * sD2 / m - 3 * mD * mD * mD * mD;
    long in1 = 0, in2 = 0;
    for (long i = 0; i < m; i++) { double z = fabs(Ds[i] - mD) / sd; in1 += z < 1; in2 += z < 2; }
    printf("p=%d q=%d n in [%d,%d]: sd(dA)=%.4f sd(dB)=%.4f corr(dA,dB)=%+.4f | sd(D)=%.4f skew=%+.3f exkurt=%+.3f  P(|z|<1)=%.4f P(|z|<2)=%.4f\n",
           p, q, n0, N, sqrt(vA), sqrt(vB), corr, sd, m3 / (vD * sd), m4 / (vD * vD) - 3, (double)in1 / m, (double)in2 / m);
    return 0;
}
