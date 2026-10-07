package app.focuson.shorts;

import android.os.Handler;

/**
 * Turns per-screen samples into Shorts / Reels stays. Ported from ShortsDetection's
 * ShortsSessionTracker:
 * - entering fires once per stay (swipes inside the player do not re-fire)
 * - "not the player" for {@link #EXIT_GRACE_MS} is re-checked with the probe, then ends
 *   the stay at the time it was first seen missing
 * - another app in front ends it at once
 * Main thread only.
 */
final class ShortsSessionTracker {
    static final long EXIT_GRACE_MS = 1000L;

    interface Listener {
        void onEntered(String kind);

        void onExited(String kind, long endedAt, String reason);
    }

    /** Current player kind ("youtube" / "instagram"), or null when not on a player. */
    interface Probe {
        String probe();
    }

    private final Handler handler;
    private final Probe probe;
    private final Listener listener;

    private String kind;
    /** Wall time when "not the player" was first seen. 0 = not waiting to exit. */
    private long missingSince;

    private final Runnable graceCheck = new Runnable() {
        @Override
        public void run() {
            if (kind == null || missingSince == 0L) return;
            if (kind.equals(probe.probe())) {
                missingSince = 0L;
                return;
            }
            exit(missingSince, "플레이어 아님 " + EXIT_GRACE_MS + "ms 지속");
        }
    };

    ShortsSessionTracker(Handler handler, Probe probe, Listener listener) {
        this.handler = handler;
        this.probe = probe;
        this.listener = listener;
    }

    String currentKind() {
        return kind;
    }

    /** @param sampled the player kind on screen, or null for another screen of a watched app */
    void onSample(String sampled, long now) {
        if (sampled != null) {
            if (sampled.equals(kind)) {
                cancelPendingExit();
                return;
            }
            if (kind != null) exit(now, "다른 플레이어로 바뀜");
            kind = sampled;
            missingSince = 0L;
            listener.onEntered(sampled);
            return;
        }
        if (kind != null && missingSince == 0L) {
            missingSince = now;
            handler.postDelayed(graceCheck, EXIT_GRACE_MS);
        }
    }

    /** @param label a fixed reason such as "다른 앱" or "화면 꺼짐"; never another app's name */
    void onLeftApp(String label, long now) {
        if (kind != null) exit(now, label);
    }

    /** Ends the stay right away, e.g. when the user picks "나가기". */
    void forceExit(long now, String reason) {
        if (kind != null) exit(now, reason);
    }

    void release() {
        cancelPendingExit();
        kind = null;
    }

    private void exit(long endedAt, String reason) {
        String ended = kind;
        cancelPendingExit();
        kind = null;
        listener.onExited(ended, endedAt, reason);
    }

    private void cancelPendingExit() {
        missingSince = 0L;
        handler.removeCallbacks(graceCheck);
    }
}
