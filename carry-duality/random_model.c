/* 随机模型对照：把 q^n 的 p 进制、p^n 的 q 进制换成同样长度的 iid 均匀随机数字，
 * 统计 dev = (A*B - n^2/4)/n^1.5 的均值、标准差，和 scan.c 对真实数据给出的 mean/sd 对比。
 * 用法: ./random_model p q n T
 */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <stdint.h>

static uint64_t s = 88172645463325252ULL;
static uint64_t xr(void) { s ^= s << 13; s ^= s >> 7; s ^= s << 17; return s; }

static long rand_carries(int len, int base) {
    int c = 0; long cnt = 0;
    for (int i = 0; i < len; i++) { int d = xr() % base; c = (2 * d + c >= base); cnt += c; }
    return cnt;
}
int main(int argc, char **argv) {
    int p = atoi(argv[1]), q = atoi(argv[2]), n = atoi(argv[3]), T = atoi(argv[4]);
    int La = (int)(n * log(q) / log(p)) + 1, Lb = (int)(n * log(p) / log(q)) + 1;
    double sm = 0, sm2 = 0; int big = 0;
    for (int t = 0; t < T; t++) {
        double A = rand_carries(La, p), B = rand_carries(Lb, q);
        double dev = (A * B - (double)n * n / 4) / pow(n, 1.5);
        sm += dev; sm2 += dev * dev; big += fabs(dev) > 2;
    }
    double m = sm / T;
    printf("random p=%d q=%d n=%d: mean=%.4f sd=%.4f P(|dev|>2)=%.4f\n", p, q, n, m, sqrt(sm2 / T - m * m), (double)big / T);
    return 0;
}
