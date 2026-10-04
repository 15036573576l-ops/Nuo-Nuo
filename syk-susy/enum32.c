/* Direct enumeration check (no Venn-region formula):
   fix A1 = {0,1,2} (permutation symmetry), loop over all 3-subsets A2, A3, A4 of [N],
   and histogram the six pairwise intersection parities |Ai & Aj| mod 2.
   Output: 64 counts, indexed by bit k for pair k in order (12,13,14,23,24,34). */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
int main(int argc, char **argv) {
    int N = atoi(argv[1]);
    int M = 0;
    uint64_t *S = malloc(sizeof(uint64_t) * 50000);
    for (int a = 0; a < N; a++) for (int b = a + 1; b < N; b++) for (int c = b + 1; c < N; c++)
        S[M++] = (1ULL << a) | (1ULL << b) | (1ULL << c);
    uint64_t A1 = 7ULL;
    unsigned long long total[64] = {0};
    #pragma omp parallel
    {
        unsigned long long cnt[64] = {0};
        #pragma omp for schedule(dynamic, 8)
        for (int i = 0; i < M; i++) {
            uint64_t A2 = S[i];
            int p12 = __builtin_popcountll(A1 & A2) & 1;
            for (int j = 0; j < M; j++) {
                uint64_t A3 = S[j];
                int base = p12 | ((__builtin_popcountll(A1 & A3) & 1) << 1) | ((__builtin_popcountll(A2 & A3) & 1) << 3);
                for (int k = 0; k < M; k++) {
                    uint64_t A4 = S[k];
                    int pat = base | ((__builtin_popcountll(A1 & A4) & 1) << 2)
                                   | ((__builtin_popcountll(A2 & A4) & 1) << 4)
                                   | ((__builtin_popcountll(A3 & A4) & 1) << 5);
                    cnt[pat]++;
                }
            }
        }
        #pragma omp critical
        for (int t = 0; t < 64; t++) total[t] += cnt[t];
    }
    printf("%d %d\n", N, M);
    for (int t = 0; t < 64; t++) printf("%llu\n", total[t]);
    return 0;
}
