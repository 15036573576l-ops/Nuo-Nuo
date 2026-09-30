"""洪朝生低温锗双通道(导带+杂质带)霍尔模型数值核对。全部用 SI 单位计算。"""
import numpy as np
import sympy as sp

e, kB = 1.602176634e-19, 8.617333262e-5          # C, eV/K
ND = 2.00e16 * 1e6                                # m^-3
Delta = 9.50e-3                                    # eV
mu_c, mu_D = 1.80e4 * 1e-4, 12.0 * 1e-4            # m^2/(V s)
r = mu_D / mu_c

# ---- 第二问：解析极值条件（符号推导校验）----
x, rr = sp.symbols('x r', positive=True)
f = (x + (1 - x) * rr**2) / (x + (1 - x) * rr)**2   # e*ND*R_H，mu_c^2 已约去
xs = sp.solve(sp.diff(f, x), x)
print("dR/dx=0 ->", [sp.simplify(s) for s in xs], "  f(x*) =", sp.factor(sp.simplify(f.subs(x, rr/(1+rr)))))

x_star = r / (1 + r)
T_star = Delta / (kB * np.log((1 + r) / r))
RH_max = (1 + r)**2 / (4 * r * e * ND)            # m^3/C
print(f"r = {r:.6e}, x* = {x_star:.6e}")
print(f"T* = {T_star:.4f} K")
print(f"R_H,max = {RH_max:.6e} m^3/C = {RH_max*1e6:.6e} cm^3/C")
print(f"R_H(T->0) = R_H(T->inf) = 1/(e N_D) = {1/(e*ND)*1e6:.4f} cm^3/C")

def nc(T):
    return ND * np.exp(-Delta / (kB * T))

def rho_weak(T):
    n = nc(T)
    return 1 / (e * (n * mu_c + (ND - n) * mu_D))

print(f"rho(T*) = {rho_weak(T_star)*100:.4f} Ohm cm,  rho(T->0) = {100/(e*ND*mu_D):.4f} Ohm cm")

# ---- 第三问：完整 Drude 张量 ----
def rhoxy_over_B(T, B):
    n = nc(T)
    sxx = sxy = 0.0
    for nj, mj in ((n, mu_c), (ND - n, mu_D)):
        b = mj * B
        sxx += nj * e * mj / (1 + b**2)
        sxy += nj * e * mj**2 * B / (1 + b**2)
    return sxy / (sxx**2 + sxy**2) / B, sxx, sxy

B = 0.50
full, sxx, sxy = rhoxy_over_B(T_star, B)
print(f"mu_c B = {mu_c*B:.3f}, mu_D B = {mu_D*B:.1e}")
print(f"sigma_xx = {sxx:.6e} S/m, |sigma_xy| = {sxy:.6e} S/m")
print(f"|rho_xy|/B (B=0.5T, T*) = {full*1e6:.6e} cm^3/C, ratio to R_H,max = {full/RH_max:.5f}")
print(f"rho_xx(B=0.5T) = {sxx/(sxx**2+sxy**2)*100:.4f} Ohm cm")

# 交叉验证：数值扫描只用于“核对”解析峰值，不用于求峰
Tsc = np.linspace(14, 16, 200001); RHc = rhoxy_over_B(Tsc, 1e-8)[0]
print(f"[check] scan peak T = {Tsc[RHc.argmax()]:.4f} K, value = {RHc.max()*1e6:.6e} cm^3/C")
