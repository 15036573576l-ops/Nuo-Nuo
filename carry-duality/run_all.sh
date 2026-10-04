#!/bin/sh
# 复现 README 里的数值表：真实数据 (scan) 和随机模型 (random_model) 的涨落对比
set -e
gcc -O2 -o scan scan.c -lm
gcc -O2 -o random_model random_model.c -lm
python3 kummer_check.py
python3 carry_chain.py
./scan 2 3 40000 10000
for pq in "2 5" "3 5" "2 7" "3 7" "5 7" "2 11" "7 11"; do ./scan $pq 12000 12000; done
for pq in "2 3" "2 5" "3 5" "2 7" "3 7" "5 7" "2 11" "7 11"; do ./random_model $pq 8000 4000; done
