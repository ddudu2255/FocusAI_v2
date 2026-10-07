package app.focuson.shorts;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.List;

/**
 * Bottom sheet drawn over the Shorts player from the accessibility service. One sheet
 * stays up while {@link GuardFlow} swaps its steps (method, reason, commitment...).
 * TYPE_ACCESSIBILITY_OVERLAY + FLAG_NOT_FOCUSABLE keeps YouTube as the active window,
 * so detection keeps working underneath. No text input.
 */
final class GuardOverlay {
    static final long ANIM_MS = 250L;
    static final float SCRIM_ALPHA = 0.9f;

    static final int SHEET = Color.parseColor("#1C1C1E");
    static final int CARD = Color.parseColor("#2C2C2E");
    static final int CARD_ON = Color.parseColor("#3A3A3C");
    static final int TEXT = Color.parseColor("#F5F5F7");
    static final int MUTED = Color.parseColor("#A1A1A6");
    static final int GOOD = Color.parseColor("#2E7D4F");
    static final int BAD = Color.parseColor("#8E2C2C");
    private static final int TRACK = Color.parseColor("#3A3A3C");
    private static final int[] BAND_TONE = {
        Color.parseColor("#7BD88F"), Color.parseColor("#F5B754"), Color.parseColor("#FF6B6B")
    };

    interface Tick {
        /** @return true to keep ticking */
        boolean run();
    }

    private final Context context;
    private final Handler handler;
    private final WindowManager windows;

    private FrameLayout root;
    private View scrim;
    private LinearLayout sheet;
    private TextView noticeText;
    private TextView gaugeText;
    private View gaugeFill;
    private View gaugeRest;
    private TextView title;
    private TextView subtitle;
    private LinearLayout body;
    private TextView leaveButton;
    private boolean closing;
    private Runnable ticker;

    GuardOverlay(Context context, Handler handler) {
        this.context = context;
        this.handler = handler;
        this.windows = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    boolean isShowing() {
        return root != null;
    }

    /** Shows the sheet if needed. Further calls only update the content. */
    void open() {
        if (root != null && !closing) return;
        dismissNow();
        build();
        attach();
    }

    /** Small line above the gauge, e.g. "작은 창으로 보던 쇼츠예요". Null hides it. */
    void notice(String text) {
        if (root == null) return;
        noticeText.setText(text == null ? "" : text);
        noticeText.setVisibility(text == null ? View.GONE : View.VISIBLE);
    }

    /** Gauge row: "오늘 목표의 64% · 남은 7분" with a bar in the band's colour. */
    void gauge(double ratio, double remainingSeconds, int band) {
        if (root == null) return;
        int percent = (int) Math.round(ratio * 100);
        String rest = remainingSeconds > 0
            ? "남은 " + GuardCopy.clock(remainingSeconds)
            : "목표 " + GuardCopy.clock(-remainingSeconds) + " 넘음";
        gaugeText.setText("오늘 목표의 " + percent + "% · " + rest);
        int tone = BAND_TONE[Math.max(1, Math.min(3, band)) - 1];
        gaugeText.setTextColor(tone);
        float filled = (float) Math.max(0.02, Math.min(1.0, ratio));
        gaugeFill.setBackground(rounded(tone, dp(3), false));
        gaugeFill.setLayoutParams(new LinearLayout.LayoutParams(0, dp(6), filled));
        gaugeRest.setLayoutParams(new LinearLayout.LayoutParams(0, dp(6), 1f - filled));
    }

    /** Replaces the step content. Stops any running countdown. */
    void step(String titleText, String subtitleText, View content) {
        if (root == null) return;
        stopTicker();
        title.setText(titleText);
        subtitle.setText(subtitleText == null ? "" : subtitleText);
        subtitle.setVisibility(subtitleText == null || subtitleText.isEmpty() ? View.GONE : View.VISIBLE);
        body.removeAllViews();
        if (content != null) body.addView(content, matchWrap());
    }

    /** The bottom button, always in the same place. A null label hides it. */
    void leave(String label, Runnable action) {
        if (root == null) return;
        if (label == null) {
            leaveButton.setVisibility(View.GONE);
            leaveButton.setOnClickListener(null);
            return;
        }
        leaveButton.setVisibility(View.VISIBLE);
        leaveButton.setText(label);
        leaveButton.setOnClickListener(v -> {
            if (!closing) action.run();
        });
    }

    /** Slides the sheet away, then runs {@code after} once the player is uncovered. */
    void close(Runnable after) {
        stopTicker();
        if (root == null) {
            if (after != null) after.run();
            return;
        }
        if (closing) return;
        closing = true;
        View closingRoot = root;
        scrim.animate().alpha(0f).setDuration(ANIM_MS).start();
        sheet.animate().translationY(sheet.getHeight() + dp(40)).setDuration(ANIM_MS)
            .withEndAction(() -> {
                if (root == closingRoot) dismissNow();
            })
            .start();
        if (after != null) handler.postDelayed(after, ANIM_MS);
    }

    /** Removes the sheet without callbacks, e.g. when the user already left the player. */
    void dismissNow() {
        stopTicker();
        closing = false;
        if (root == null) return;
        View old = root;
        root = null;
        try {
            windows.removeView(old);
        } catch (RuntimeException ignored) {
            // Already detached.
        }
    }

    void startTicker(long periodMs, Tick tick) {
        stopTicker();
        ticker = new Runnable() {
            @Override
            public void run() {
                if (ticker != this) return;
                if (tick.run()) handler.postDelayed(this, periodMs);
            }
        };
        handler.post(ticker);
    }

    void stopTicker() {
        if (ticker != null) handler.removeCallbacks(ticker);
        ticker = null;
    }

    // --- Builders used by GuardFlow --------------------------------------------

    LinearLayout vertical() {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    TextView chip(String label) {
        TextView view = text(label, 15, TEXT, false);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(8), 0, dp(8), 0);
        view.setBackground(rounded(CARD, dp(14), false));
        view.setClickable(true);
        return view;
    }

    TextView button(String label, boolean primary) {
        TextView view = text(label, 16, primary ? SHEET : TEXT, true);
        view.setGravity(Gravity.CENTER);
        GradientDrawable bg = rounded(primary ? TEXT : Color.TRANSPARENT, dp(14), false);
        if (!primary) bg.setStroke(dp(1), Color.parseColor("#48484A"));
        view.setBackground(bg);
        view.setClickable(true);
        return view;
    }

    /** Lays views out in rows of {@code columns}, each {@code heightDp} tall. */
    LinearLayout grid(List<? extends View> items, int columns, int heightDp) {
        LinearLayout grid = vertical();
        for (int i = 0; i < items.size(); i += columns) {
            LinearLayout row = new LinearLayout(context);
            row.setOrientation(LinearLayout.HORIZONTAL);
            for (int j = i; j < i + columns; j++) {
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(heightDp), 1f);
                lp.setMargins(j == i ? 0 : dp(4), dp(4), j == i + columns - 1 ? 0 : dp(4), dp(4));
                if (j < items.size()) {
                    row.addView(items.get(j), lp);
                } else {
                    row.addView(new View(context), lp);
                }
            }
            grid.addView(row);
        }
        return grid;
    }

    void tint(View view, int color) {
        if (view.getBackground() instanceof GradientDrawable) {
            ((GradientDrawable) view.getBackground()).setColor(color);
        }
    }

    GradientDrawable rounded(int color, int radius, boolean topOnly) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        if (topOnly) {
            drawable.setCornerRadii(new float[] {radius, radius, radius, radius, 0, 0, 0, 0});
        } else {
            drawable.setCornerRadius(radius);
        }
        return drawable;
    }

    GradientDrawable oval(int color) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        drawable.setColor(color);
        return drawable;
    }

    View spacer(int heightDp) {
        View view = new View(context);
        view.setLayoutParams(new LinearLayout.LayoutParams(1, dp(heightDp)));
        return view;
    }

    static LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    LinearLayout.LayoutParams matchHeight(int heightDp) {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(heightDp));
    }

    int dp(int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value, context.getResources().getDisplayMetrics()));
    }

    // --- Window ----------------------------------------------------------------

    private void build() {
        closing = false;
        root = new FrameLayout(context);
        root.setClickable(true);

        scrim = new View(context);
        scrim.setBackgroundColor(Color.BLACK);
        scrim.setAlpha(0f);
        root.addView(scrim, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        sheet = vertical();
        sheet.setClickable(true);
        sheet.setBackground(rounded(SHEET, dp(24), true));
        int pad = dp(20);
        sheet.setPadding(pad, pad, pad, pad);

        noticeText = text("", 13, TEXT, true);
        noticeText.setPadding(0, 0, 0, dp(6));
        noticeText.setVisibility(View.GONE);
        sheet.addView(noticeText);
        gaugeText = text("", 13, MUTED, true);
        sheet.addView(gaugeText);
        LinearLayout bar = new LinearLayout(context);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackground(rounded(TRACK, dp(3), false));
        gaugeFill = new View(context);
        gaugeRest = new View(context);
        bar.addView(gaugeFill, new LinearLayout.LayoutParams(0, dp(6), 0.02f));
        bar.addView(gaugeRest, new LinearLayout.LayoutParams(0, dp(6), 0.98f));
        LinearLayout.LayoutParams barLp = matchWrap();
        barLp.setMargins(0, dp(6), 0, dp(12));
        sheet.addView(bar, barLp);

        title = text("", 22, TEXT, true);
        sheet.addView(title);
        subtitle = text("", 14, MUTED, false);
        subtitle.setPadding(0, dp(4), 0, 0);
        sheet.addView(subtitle);
        body = vertical();
        LinearLayout.LayoutParams bodyLp = matchWrap();
        bodyLp.setMargins(0, dp(14), 0, 0);
        sheet.addView(body, bodyLp);
        leaveButton = button("나가기", false);
        LinearLayout.LayoutParams leaveLp = matchHeight(52);
        leaveLp.setMargins(0, dp(12), 0, 0);
        sheet.addView(leaveButton, leaveLp);

        FrameLayout.LayoutParams sheetLp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        root.addView(sheet, sheetLp);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            sheet.setPadding(pad, pad, pad, pad + insets.getSystemWindowInsetBottom());
            return insets;
        });
    }

    private void attach() {
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.BOTTOM;
        try {
            windows.addView(root, params);
        } catch (RuntimeException e) {
            root = null;
            return;
        }
        sheet.setTranslationY(dp(600));
        sheet.post(() -> {
            sheet.setTranslationY(sheet.getHeight());
            sheet.animate().translationY(0f).setDuration(ANIM_MS).start();
            scrim.animate().alpha(SCRIM_ALPHA).setDuration(ANIM_MS).start();
        });
    }
}
