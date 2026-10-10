package com.nuonuo.calculator;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;

/** Recursive-descent evaluator for + - × ÷ % and parentheses, using BigDecimal. */
public final class Evaluator {
    private static final MathContext MC = new MathContext(20, RoundingMode.HALF_UP);

    private final String s;
    private int pos;

    private Evaluator(String s) {
        this.s = s;
    }

    public static BigDecimal eval(String expr) {
        Evaluator e = new Evaluator(expr.replace(" ", ""));
        BigDecimal v = e.parseExpr();
        if (e.pos != e.s.length()) throw new IllegalArgumentException("unexpected char");
        return v;
    }

    /** Formats a result: no trailing zeros, plain notation for reasonable magnitudes. */
    public static String format(BigDecimal v) {
        BigDecimal r = v.round(new MathContext(12, RoundingMode.HALF_UP)).stripTrailingZeros();
        if (r.signum() == 0) return "0";
        int exp = r.precision() - r.scale() - 1;
        return (exp > 12 || exp < -6) ? r.toString() : r.toPlainString();
    }

    private BigDecimal parseExpr() {
        BigDecimal v = parseTerm();
        while (pos < s.length()) {
            char c = s.charAt(pos);
            if (c == '+') { pos++; v = v.add(parseTerm(), MC); }
            else if (c == '-') { pos++; v = v.subtract(parseTerm(), MC); }
            else break;
        }
        return v;
    }

    private BigDecimal parseTerm() {
        BigDecimal v = parseFactor();
        while (pos < s.length()) {
            char c = s.charAt(pos);
            if (c == '×') { pos++; v = v.multiply(parseFactor(), MC); }
            else if (c == '÷') {
                pos++;
                BigDecimal d = parseFactor();
                if (d.signum() == 0) throw new ArithmeticException("divide by zero");
                v = v.divide(d, MC);
            } else break;
        }
        return v;
    }

    private BigDecimal parseFactor() {
        if (pos < s.length() && s.charAt(pos) == '-') { pos++; return parseFactor().negate(); }
        if (pos < s.length() && s.charAt(pos) == '+') { pos++; return parseFactor(); }
        BigDecimal v;
        if (pos < s.length() && s.charAt(pos) == '(') {
            pos++;
            v = parseExpr();
            if (pos < s.length() && s.charAt(pos) == ')') pos++;
            else throw new IllegalArgumentException("missing )");
        } else {
            int start = pos;
            while (pos < s.length() && (Character.isDigit(s.charAt(pos)) || s.charAt(pos) == '.')) pos++;
            if (start == pos) throw new IllegalArgumentException("number expected");
            v = new BigDecimal(s.substring(start, pos));
        }
        while (pos < s.length() && s.charAt(pos) == '%') { pos++; v = v.divide(BigDecimal.valueOf(100), MC); }
        return v;
    }
}
