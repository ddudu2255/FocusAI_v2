package app.focuson.shorts;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Status bar countdown while Shorts is locked. Skipped when notifications are not allowed. */
final class GuardNotifier {
    private static final String CHANNEL = "shorts_lock";
    private static final int LOCK_ID = 7001;

    private GuardNotifier() {}

    static void showLock(Context context, long blockedUntil) {
        long remaining = blockedUntil - System.currentTimeMillis();
        if (remaining <= 0) {
            cancelLock(context);
            return;
        }
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) return;
        ensureChannel(context);

        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(
            context, LOCK_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_shortsai)
            .setContentTitle("쇼츠 잠금 중")
            .setContentText("잠금이 끝나면 이 알림이 사라져요.")
            .setWhen(blockedUntil)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(remaining)
            .setContentIntent(tap)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        try {
            manager.notify(LOCK_ID, builder.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS was revoked between the check and the call.
        }
    }

    static void cancelLock(Context context) {
        NotificationManagerCompat.from(context).cancel(LOCK_ID);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL, "쇼츠 잠금", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("시간 차단 중 남은 시간을 보여줍니다.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
