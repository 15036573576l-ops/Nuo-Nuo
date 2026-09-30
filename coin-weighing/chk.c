#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define F 4
int N;
// branch: 3 cells sizes s[3]; allowed predicate type: 0 = fL==fR, 1 = fL>fR
static int allowed(int t,int a,int b){return t==0? a==b : a>b;}
// evaluate branch with second weighing x[i],y[i]
int evalw(int t,int*s,int*x,int*y){
  // cells: for i: x_i (to L2), y_i (to R2), z_i=s_i-x_i-y_i
  int sz[9]; for(int i=0;i<3;i++){sz[3*i]=x[i];sz[3*i+1]=y[i];sz[3*i+2]=s[i]-x[i]-y[i];}
  int poss[3][9]; int occ[3]={0,0,0}; memset(poss,0,sizeof poss);
  int f[9];
  // enumerate
  for(f[0]=0;f[0]<=F&&f[0]<=sz[0];f[0]++)for(f[1]=0;f[0]+f[1]<=F&&f[1]<=sz[1];f[1]++)
  for(f[2]=0;f[0]+f[1]+f[2]<=F&&f[2]<=sz[2];f[2]++)for(f[3]=0;f[0]+f[1]+f[2]+f[3]<=F&&f[3]<=sz[3];f[3]++)
  for(f[4]=0;f[0]+f[1]+f[2]+f[3]+f[4]<=F&&f[4]<=sz[4];f[4]++)for(f[5]=0;f[0]+f[1]+f[2]+f[3]+f[4]+f[5]<=F&&f[5]<=sz[5];f[5]++)
  for(f[6]=0;f[0]+f[1]+f[2]+f[3]+f[4]+f[5]+f[6]<=F&&f[6]<=sz[6];f[6]++)
  for(f[7]=0;f[0]+f[1]+f[2]+f[3]+f[4]+f[5]+f[6]+f[7]<=F&&f[7]<=sz[7];f[7]++){
    f[8]=F-(f[0]+f[1]+f[2]+f[3]+f[4]+f[5]+f[6]+f[7]); if(f[8]>sz[8])continue;
    int a=f[0]+f[1]+f[2],b=f[3]+f[4]+f[5]; if(!allowed(t,a,b))continue;
    int l=f[0]+f[3]+f[6], r=f[1]+f[4]+f[7]; int o= l==r?0:(l>r?1:2);
    occ[o]=1; for(int j=0;j<9;j++) if(f[j]) poss[o][j]=1;
  }
  int best=1<<30;
  for(int o=0;o<3;o++) if(occ[o]){int c=0;for(int j=0;j<9;j++) if(!poss[o][j]) c+=sz[j]; if(c<best)best=c;}
  return best==(1<<30)? N : best;
}
int branch(int t,int*s,int*bx,int*by){
  int best=-1,x[3],y[3];
  for(x[0]=0;x[0]<=s[0];x[0]++)for(y[0]=0;x[0]+y[0]<=s[0];y[0]++)
  for(x[1]=0;x[1]<=s[1];x[1]++)for(y[1]=0;x[1]+y[1]<=s[1];y[1]++)
  for(x[2]=0;x[2]<=s[2];x[2]++){int yy=x[0]+x[1]+x[2]-y[0]-y[1]; if(yy<0||x[2]+yy>s[2])continue; y[2]=yy;
    // symmetry: require L2 not smaller lexi? skip
    int v=evalw(t,s,x,y); if(v>best){best=v;memcpy(bx,x,12);memcpy(by,y,12);}}
  return best;
}
int main_old(int c,char**v){
  N=atoi(v[1]); int bestall=-1;
  for(int k=1;2*k<=N;k++){
    int s[3]={k,k,N-2*k}; int x0[3],y0[3],x1[3],y1[3];
    int e=branch(0,s,x0,y0); int l=branch(1,s,x1,y1);
    int val=e<l?e:l;
    if(val>=bestall){ if(val>bestall)bestall=val;
      printf("N=%d k=%d eq=%d [%d %d %d|%d %d %d] lt=%d [%d %d %d|%d %d %d]\n",N,k,e,x0[0],x0[1],x0[2],y0[0],y0[1],y0[2],l,x1[0],x1[1],x1[2],y1[0],y1[1],y1[2]);}
  }
  printf("N=%d best=%d\n",N,bestall);
}
int main(){N=1000;int k=286;int s[3]={k,k,N-2*k};
 int x[3]={0,1,428},y[3]={286,143,0}; printf("eq branch=%d\n",evalw(0,s,x,y));
 int best=0,ba=0; for(int a=1;3*a<=k+3;a++){int x1[3]={0,a,0},y1[3]={0,a,0};int v=evalw(1,s,x1,y1);if(v>best){best=v;ba=a;}}
 printf("lt branch best a=%d val=%d\n",ba,best);}
