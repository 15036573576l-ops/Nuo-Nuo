import itertools,sys
from fractions import Fraction as Fr
F=4
def dists(sizes,tot=F):
    # all vectors f with 0<=f_i<=sizes_i, sum=tot
    def rec(i,rem):
        if i==len(sizes):
            if rem==0: yield ()
            return
        for v in range(min(sizes[i],rem)+1):
            for r in rec(i+1,rem-v): yield (v,)+r
    return list(rec(0,tot))
def dint(a,b,o):
    # set of d in (0,1) with sign(a-d*b)==o ; return (lo,hi,lo_open,hi_open) or point or None ; represent as list of constraints
    return (a,b,o)
def feasible(cons):
    lo,hi=Fr(0),Fr(1); lo_s,hi_s=True,True; pt=None
    for a,b,o in cons:
        if b==0:
            s=(a>0)-(a<0)
            if s!=o: return False
            continue
        r=Fr(a,b)  # a-d b = 0 at d=r ; sign(a-db) = o
        if o==0:
            if pt is not None and pt!=r: return False
            pt=r; continue
        # a-db>0 : if b>0 d<r ; b<0 d>r
        want_less = (o>0)==(b>0)
        if want_less:
            if r<hi or (r==hi): hi,hi_s=min(hi,r),True
        else:
            if r>lo or r==lo: lo,lo_s=max(lo,r),True
    if pt is not None:
        return lo<pt<hi
    return lo<hi
def sgn(x): return (x>0)-(x<0)
def outcome_groups(sizes,dl,W,prev):
    pass
