#include <stdio.h>
#include <stdint.h>
// count A in M_n(F2) with A^T == A^2 ; rows as bitmasks
int main(){
  for(int n=1;n<=5;n++){
    uint64_t tot=1ULL<<(n*n), cnt=0;
    for(uint64_t m=0;m<tot;m++){
      unsigned r[8],c[8];
      for(int i=0;i<n;i++) r[i]=(m>>(i*n))&((1u<<n)-1);
      // A^2 row i = XOR of rows j where A[i][j]=1
      int ok=1;
      for(int i=0;i<n&&ok;i++){
        unsigned s=0; for(int j=0;j<n;j++) if(r[i]>>j&1) s^=r[j];
        // A^T row i = column i of A
        unsigned t=0; for(int j=0;j<n;j++) if(r[j]>>i&1) t|=1u<<j;
        if(s!=t) ok=0;
      }
      cnt+=ok;
    }
    printf("n=%d f=%llu\n",n,(unsigned long long)cnt);
  }
}
