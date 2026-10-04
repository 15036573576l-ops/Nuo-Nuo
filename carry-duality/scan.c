/* 对素数对 (p,q) 逐个 n 计算
 *   A(n) = nu_p(C(2q^n, q^n)) = q^n 在 p 进制下自加的进位数
 *   B(n) = nu_q(C(2p^n, p^n)) = p^n 在 q 进制下自加的进位数
 * 输出 n, A, B, A*B/n^2, (A*B - n^2/4)/n^1.5
 * 用法: ./scan p q N [every]
 */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

static int mul(unsigned char *d, int len, int base, int k) {   /* d *= k，返回新长度 */
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
    int p = atoi(argv[1]), q = atoi(argv[2]), N = atoi(argv[3]);
    int every = argc > 4 ? atoi(argv[4]) : 1;
    int capA = (int)(N * log(q) / log(p)) + 64, capB = (int)(N * log(p) / log(q)) + 64;
    unsigned char *a = calloc(capA, 1), *b = calloc(capB, 1);  /* a: q^n 的 p 进制; b: p^n 的 q 进制 */
    int la = 1, lb = 1; a[0] = 1; b[0] = 1;
    double maxdev = 0, sumdev = 0, sumdev2 = 0; long cnt = 0; int argmax = 0, zeros = 0;
    for (int n = 1; n <= N; n++) {
        la = mul(a, la, p, q); lb = mul(b, lb, q, p);
        long A = carries(a, la, p), B = carries(b, lb, q);
        double prod = (double)A * B, r = prod / ((double)n * n), dev = (prod - n * (double)n / 4) / pow(n, 1.5);
        if (A == 0 || B == 0) { zeros++; printf("ZERO n=%d A=%ld B=%ld\n", n, A, B); }
        if (n >= 100) { if (fabs(dev) > maxdev) { maxdev = fabs(dev); argmax = n; } sumdev += dev; sumdev2 += dev * dev; cnt++; }
        if (n % every == 0) printf("%d %ld %ld %.6f %.4f\n", n, A, B, r, dev);
    }
    printf("# p=%d q=%d N=%d zeros(n>=1)=%d  n>=100: mean dev=%.4f sd dev=%.4f max|dev|=%.4f at n=%d\n",
           p, q, N, zeros, sumdev / cnt, sqrt(sumdev2 / cnt - (sumdev / cnt) * (sumdev / cnt)), maxdev, argmax);
    return 0;
}
