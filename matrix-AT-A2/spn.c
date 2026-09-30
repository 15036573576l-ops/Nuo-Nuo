#include <stdio.h>
#include <stdlib.h>
// enumerate Sp(2m,2) w.r.t. J with pairs (2i,2i+1); count g with g^2+g+I=0
int n; unsigned col[8]; long long nsp=0,nfp=0;
int J(unsigned x,unsigned y){unsigned s=0;for(int i=0;i<n;i+=2) s^=((x>>i&1)&(y>>(i+1)&1))^((x>>(i+1)&1)&(y>>i&1));return s;}
unsigned app(unsigned v){unsigned s=0;for(int j=0;j<n;j++) if(v>>j&1) s^=col[j];return s;}
void rec(int k){
  if(k==n){nsp++; for(int j=0;j<n;j++){unsigned e=1u<<j; if((app(app(e))^app(e)^e)!=0) return;} nfp++; return;}
  for(unsigned c=1;c<(1u<<n);c++){
    int ok=1; for(int i=0;i<k&&ok;i++) if(J(col[i],c)!=J(1u<<i,1u<<k)) ok=0;
    if(!ok) continue; col[k]=c; rec(k+1);
  }
}
int main(int a,char**v){n=atoi(v[1]);rec(0);printf("dim %d |Sp|=%lld  #g^2+g+1=0: %lld\n",n,nsp,nfp);}
