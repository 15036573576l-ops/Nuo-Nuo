#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
// n=6 brute force, split by top row value (argv[1]) for parallelism
int main(int argc,char**argv){
  const int n=6; unsigned r0=atoi(argv[1]); unsigned long long cnt=0;
  unsigned r[6]; r[0]=r0;
  for(uint64_t m=0;m<(1ULL<<30);m++){
    for(int i=1;i<6;i++) r[i]=(m>>((i-1)*6))&63;
    int ok=1;
    for(int i=0;i<n&&ok;i++){
      unsigned s=0; for(int j=0;j<n;j++) if(r[i]>>j&1) s^=r[j];
      unsigned t=0; for(int j=0;j<n;j++) t|=((r[j]>>i)&1)<<j;
      if(s!=t) ok=0;
    }
    cnt+=ok;
  }
  printf("%llu\n",cnt);
}
