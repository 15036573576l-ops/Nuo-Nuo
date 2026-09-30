import itertools, sys
from math import prod
def rank(rows):
    rows=list(rows); r=0
    for bit in range(64):
        piv=None
        for i in range(r,len(rows)):
            if rows[i]>>bit&1: piv=i;break
        if piv is None: continue
        rows[r],rows[piv]=rows[piv],rows[r]
        for i in range(len(rows)):
            if i!=r and rows[i]>>bit&1: rows[i]^=rows[r]
        r+=1
    return r
def subspaces(n):
    # enumerate RREF bases
    for k in range(n+1):
        for pivots in itertools.combinations(range(n),k):
            free=[(i,c) for i,p in enumerate(pivots) for c in range(p+1,n) if c not in pivots]
            for bits in range(1<<len(free)):
                rows=[1<<p for p in pivots]
                for t,(i,c) in enumerate(free):
                    if bits>>t&1: rows[i]|=1<<c
                yield rows
dot=lambda x,y: bin(x&y).count('1')&1
def stats(n):
    S={}; D=0
    for B in subspaces(n):
        k=len(B)
        G=[sum(dot(B[i],B[j])<<j for j in range(k)) for i in range(k)]
        if rank(G)<k: continue
        D+=1
        if all(dot(b,b)==0 for b in B): S[k//2]=S.get(k//2,0)+1
    return S,D
def sp(m): return 2**(m*m)*prod(4**i-1 for i in range(1,m+1))
def u(m): return 2**(m*(m-1)//2)*prod(2**i-(-1)**i for i in range(1,m+1))
N=lambda m: sp(m)//u(m)
Dk={}; Sn={}
for n in range(0,int(sys.argv[1])+1):
    Sn[n],Dk[n]=stats(n)
    f=sum(Sn[n].get(m,0)*N(m)*Dk[n-2*m] for m in range(n//2+1))
    print(n,"D=",Dk[n],"S=",Sn[n],"f=",f,flush=True)
print("N(m):",[N(m) for m in range(5)])
