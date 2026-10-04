# 超对称 SYK：H = Q² 平均态密度的峰度（有限 N 精确值）

## 题目（英文原文，测模型时直接用这一段）

> Consider the N = 1 supersymmetric Sachdev–Ye–Kitaev model with N = 32 Majorana fermions
> ψ_1, …, ψ_32 obeying {ψ_a, ψ_b} = δ_ab, acting on the 2^16-dimensional irreducible representation.
> The supercharge is
>
>   Q = i Σ_{1≤a<b<c≤32} C_abc ψ_a ψ_b ψ_c ,
>
> where the C_abc are independent real Gaussian random variables with mean 0 and variance σ² > 0,
> and the Hamiltonian is H = Q². Let ρ̄(E) = E_C[ 2^{-16} Σ_n δ(E − E_n) ] be the disorder-averaged
> normalized density of states of H, and let μ_k be the k-th central moment of ρ̄.
> Find the exact value of the kurtosis μ_4 / μ_2² as a reduced fraction.

## 答案

**μ_4/μ_2² = 4703075649 / 1842591640 ≈ 2.552424285**

一般偶数 N 的闭式：

```
kurtosis(N) = 3(9N^7 − 213N^6 + 2565N^5 − 16971N^4 + 52630N^3 − 20508N^2 − 247624N + 393504)
              / [ N(N−1)(N−2)(3N^2 − 21N + 38)^2 ]
```

大 N 展开：3 − 20/N + 160/N² + O(1/N³)。它不是单调的，在 N ≈ 20 附近有极小值（约 2.48）。

## 解法主线

1. m_k(H) = m_{2k}(Q)，所以要 Q 的 2、4、6、8 阶平均矩。
2. 对高斯耦合做 Wick 配对：m_{2p}(Q)/m_2(Q)^p = Σ_D W_N(D)，D 跑遍 2p 个点的全部配对（弦图），8 阶共 105 个。
3. 三体算符 G_A = iψ_aψ_bψ_c 是费米型的：G_A G_B = (−1)^{9−|A∩B|} G_B G_A。不相交时反对易。
4. W_N(D) = E[ Π_{交叉的弦对 (i,j)} (−1)^{9−|A_i∩A_j|} ]，A_1..A_p 是独立均匀的 3 元子集（允许重合）。
5. 交叉图是森林时 W = η^{交叉数}，η(32) = −1261/2480；交叉图有圈（三角形、四边形、K4 等）时不能分解，要对 4 个集合的 15 个 Venn 区域精确求和。
6. 用 m_2..m_8 组装中心矩，求峰度。

## 常见陷阱（N = 32 时的错误答案）

| 做法 | 结果 |
|---|---|
| 用大 N 的 η^交叉数 规则（q-Hermite / Touchard–Riordan） | 78028547416881/37827420160000 ≈ 2.0628 |
| 把偶数 q 的符号 (−1)^{|A∩B|} 用到奇数 q 的 Q 上 | 254020487/39894024 ≈ 6.3674 |
| 大 N 展开截到 1/N² | 81/32 = 2.53125 |
| 直接取大 N 极限 | 3 |

有圈的交叉图权重和 η 的幂差很多。比如三根两两相交的弦，精确权重是 −413489/6150400 ≈ −0.067，η³ ≈ −0.132，差了一倍。

## 验证

- `chord.py`：弦图 + Venn 区域精确求和，给出 m_4/m_2²、m_6/m_2³、m_8/m_2⁴ 关于 N 的有理函数。
- `matrix_check.py`：Jordan–Wigner 显式构造 Majorana 矩阵，对耦合做 Wick 配对后用张量缩并直接算迹，完全不用对易符号规则。
- `enum32.c` + `enum_combine.py`：固定 A_1，C 语言暴力枚举全部 (A_2, A_3, A_4)，统计两两交集奇偶性，不用 Venn 公式，直接在 N = 32 上算出最终答案（4960³ ≈ 1.2×10¹¹ 组，4 核约 2 分钟）。
- `mc_check.py`：随机抽耦合、精确对角化 H，统计平均态密度的峰度。
- `answer.py`：组装峰度，`traps.py`：交叉图分类和错误答案。

对账结果：

| N | m_8/m_2⁴（弦图公式） | 显式矩阵 | 暴力枚举 |
|---|---|---|---|
| 6 | 2064/125 | 16.511999999999993 | — |
| 8 | 195135/10976 | 17.77833454810495 | 一致 |
| 10 | 11683/750 | 15.577333333333328 | 一致 |
| 12 | 2228331/166375 | 13.393424492862511 | 一致 |
| 20 | 14183983/1714750 | — | 一致 |
| 32 | 40403737089/7626496000 | — | 一致 |

m_4、m_6 在上面每个 N 上也都吻合。N = 32 时暴力枚举直接给出峰度 4703075649/1842591640。

蒙特卡洛（精确对角化后平均）：

| N | 样本数 | 峰度 | 精确值 |
|---|---|---|---|
| 10 | 100000 | 3.1312 ± 0.0044 | 3.12461 |
| 12 | 20000 | 2.7880 ± 0.0032 | 2.78465 |

运行：`pip install numpy sympy networkx`，然后 `python3 answer.py`；暴力枚举：`gcc -O3 -fopenmp enum32.c -o enum32 && ./enum32 32 > e32.txt && python3 enum_combine.py e32.txt`。

## 说明

- 答案的可靠性来自两种独立方法的逐位吻合，不是靠推导一遍。
- 难度是估计，没有真的拿别的模型测过。不用工具时我自己大概率做不出来；带代码工具的专家知道弦图方法的话，一两个小时能算出来。
