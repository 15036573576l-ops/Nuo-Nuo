#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define F 4
int N;
static int sg(double v){return v>1e-12?1:(v<-1e-12?-1:0);}
// outcome of a weighing: sign of weight(P)-weight(Q) = (a - d*b), a=|P|-|Q|, b=fP-fQ ; fake weight = 1-d, d in (0,1)
// collect achievable outcome pairs for distribution over d
int pairs(int a1,int b1,int a2,int b2,int out[9]){
  double c[8];int nc=0; c[nc++]=0;c[nc++]=1;
  if(b1){double r=(double)a1/b1; if(r>0&&r<1)c[nc++]=r;}
  if(b2){double r=(double)a2/b2; if(r>0&&r<1)c[nc++]=r;}
  // sort
  for(int i=0;i<nc;i++)for(int j=i+1;j<nc;j++)if(c[j]<c[i]){double t=c[i];c[i]=c[j];c[j]=t;}
  int m=0;
  for(int i=0;i<nc;i++){ double ds[2]={c[i],0};int nd=1; if(i+1<nc){ds[1]=(c[i]+c[i+1])/2;nd=2;}
    for(int t=0;t<nd;t++){double d=ds[t]; if(d<=0||d>=1)continue;
      int o=(sg(a1-d*b1)+1)*3+(sg(a2-d*b2)+1); int dup=0; for(int q=0;q<m;q++)if(out[q]==o)dup=1; if(!dup)out[m++]=o;}}
  return m;
}
int main(int argc,char**argv){
  N=atoi(argv[1]); int best=-1;
  for(int p=1;p<=N;p++)for(int q=1;q<=p&&p+q<=N;q++){
    int s[3]={p,q,N-p-q}; int worst=1<<30;
    for(int o1=0;o1<3;o1++){
      int bb=-1; int x[3],y[3]; int any=0;
      for(x[0]=0;x[0]<=s[0];x[0]++)for(y[0]=0;x[0]+y[0]<=s[0];y[0]++)
      for(x[1]=0;x[1]<=s[1];x[1]++)for(y[1]=0;x[1]+y[1]<=s[1];y[1]++)
      for(x[2]=0;x[2]<=s[2];x[2]++)for(y[2]=0;x[2]+y[2]<=s[2];y[2]++){
        int sz[9];for(int i=0;i<3;i++){sz[3*i]=x[i];sz[3*i+1]=y[i];sz[3*i+2]=s[i]-x[i]-y[i];}
        int a2=(x[0]+x[1]+x[2])-(y[0]+y[1]+y[2]);
        int poss[3][9];int occ[3]={0,0,0};memset(poss,0,sizeof poss);int f[9];
        // enumerate fake distributions
        int idx[4];
        for(idx[0]=0;idx[0]<9;idx[0]++)for(idx[1]=idx[0];idx[1]<9;idx[1]++)for(idx[2]=idx[1];idx[2]<9;idx[2]++)for(idx[3]=idx[2];idx[3]<9;idx[3]++){
          memset(f,0,sizeof f);for(int t=0;t<4;t++)f[idx[t]]++; int ok=1;for(int j=0;j<9;j++)if(f[j]>sz[j])ok=0; if(!ok)continue;
          int b1=(f[0]+f[1]+f[2])-(f[3]+f[4]+f[5]); int b2=(f[0]+f[3]+f[6])-(f[1]+f[4]+f[7]);
          int out[9];int m=pairs(p-q,b1,a2,b2,out);
          for(int t=0;t<m;t++){ if(out[t]/3!=o1)continue; int o2=out[t]%3; occ[o2]=1; for(int j=0;j<9;j++)if(f[j])poss[o2][j]=1;}
        }
        int v=1<<30; for(int o=0;o<3;o++)if(occ[o]){any=1;int c=0;for(int j=0;j<9;j++)if(!poss[o][j])c+=sz[j];if(c<v)v=c;}
        if(v==(1<<30)) goto skip; if(v>bb)bb=v;
      }
      if(bb>=0 && bb<worst) worst=bb;
      skip:;
    }
    if(worst!=(1<<30)&&worst>best)best=worst;
  }
  printf("N=%d general(unequal allowed) best=%d\n",N,best);
}
