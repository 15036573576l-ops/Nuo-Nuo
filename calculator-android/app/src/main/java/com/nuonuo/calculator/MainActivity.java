package com.nuonuo.calculator;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.widget.Button;
import android.widget.GridLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String[] KEYS = {
            "C", "( )", "%", "÷",
            "7", "8", "9", "×",
            "4", "5", "6", "-",
            "1", "2", "3", "+",
            "⌫", "0", ".", "="
    };

    private TextView expressionView;
    private TextView resultView;
    private final StringBuilder expr = new StringBuilder();
    private boolean justEvaluated;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        expressionView = findViewById(R.id.expression);
        resultView = findViewById(R.id.result);
        GridLayout keypad = findViewById(R.id.keypad);

        int margin = dp(5);
        for (int i = 0; i < KEYS.length; i++) {
            String key = KEYS[i];
            Button b = new Button(this);
            b.setText(key);
            b.setAllCaps(false);
            b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
            b.setTextColor(Color.WHITE);
            b.setBackground(roundRect(colorFor(key)));
            b.setOnClickListener(v -> onKey(key));

            GridLayout.LayoutParams lp = new GridLayout.LayoutParams(
                    GridLayout.spec(i / 4, 1f), GridLayout.spec(i % 4, 1f));
            lp.width = 0;
            lp.height = 0;
            lp.setMargins(margin, margin, margin, margin);
            keypad.addView(b, lp);
        }

        if (savedInstanceState != null) {
            expr.append(savedInstanceState.getString("expr", ""));
        }
        refresh();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putString("expr", expr.toString());
    }

    private void onKey(String key) {
        switch (key) {
            case "C":
                expr.setLength(0);
                break;
            case "⌫":
                if (expr.length() > 0) expr.setLength(expr.length() - 1);
                break;
            case "=":
                String r = tryEval();
                if (r != null && !r.startsWith("错误")) {
                    expr.setLength(0);
                    expr.append(r);
                    justEvaluated = true;
                    expressionView.setText(expr);
                    resultView.setText("");
                } else {
                    resultView.setText(r == null ? "" : r);
                }
                return;
            case "( )":
                expr.append(shouldOpenParen() ? "(" : ")");
                break;
            case ".":
                if (justEvaluated) expr.setLength(0);
                if (!currentNumberHasDot()) {
                    if (expr.length() == 0 || !Character.isDigit(last())) expr.append('0');
                    expr.append('.');
                }
                break;
            case "+": case "-": case "×": case "÷":
                if (expr.length() > 0 && isOperator(last())) expr.setLength(expr.length() - 1);
                if (expr.length() > 0 || key.equals("-")) expr.append(key);
                break;
            case "%":
                if (expr.length() > 0 && (Character.isDigit(last()) || last() == ')')) expr.append('%');
                break;
            default: // digits
                if (justEvaluated) expr.setLength(0);
                expr.append(key);
        }
        justEvaluated = false;
        refresh();
    }

    private void refresh() {
        expressionView.setText(expr.length() == 0 ? "0" : expr);
        String r = tryEval();
        resultView.setText(r == null || r.startsWith("错误") ? "" : "= " + r);
    }

    /** Returns formatted result, an error message starting with "错误", or null if empty. */
    private String tryEval() {
        if (expr.length() == 0) return null;
        String e = expr.toString();
        // auto-close parentheses for preview / evaluation
        int open = 0;
        for (char c : e.toCharArray()) {
            if (c == '(') open++;
            else if (c == ')') open--;
        }
        StringBuilder sb = new StringBuilder(e);
        for (int i = 0; i < open; i++) sb.append(')');
        try {
            return Evaluator.format(Evaluator.eval(sb.toString()));
        } catch (ArithmeticException ex) {
            return "错误：不能除以 0";
        } catch (RuntimeException ex) {
            return "错误：表达式不完整";
        }
    }

    private boolean shouldOpenParen() {
        if (expr.length() == 0) return true;
        int open = 0;
        for (int i = 0; i < expr.length(); i++) {
            if (expr.charAt(i) == '(') open++;
            else if (expr.charAt(i) == ')') open--;
        }
        char c = last();
        return open == 0 || c == '(' || isOperator(c);
    }

    private boolean currentNumberHasDot() {
        for (int i = expr.length() - 1; i >= 0; i--) {
            char c = expr.charAt(i);
            if (c == '.') return true;
            if (!Character.isDigit(c)) return false;
        }
        return false;
    }

    private char last() {
        return expr.charAt(expr.length() - 1);
    }

    private static boolean isOperator(char c) {
        return c == '+' || c == '-' || c == '×' || c == '÷';
    }

    private static int colorFor(String key) {
        if (key.equals("=")) return 0xFFFF8FB1;
        if (key.equals("C") || key.equals("⌫")) return 0xFF6B4E71;
        if ("÷×-+%( )".contains(key)) return 0xFF4A3F55;
        return 0xFF2E2935;
    }

    private GradientDrawable roundRect(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(18));
        return d;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
