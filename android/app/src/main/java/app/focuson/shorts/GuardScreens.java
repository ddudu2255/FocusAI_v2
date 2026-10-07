package app.focuson.shorts;

import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Decides whether a window is the YouTube Shorts player or the Instagram Reels
 * player. Resource ids and view class names are structural. A content
 * description is consulted only when it is a short selected tab label
 * (Shorts / 쇼츠 / Reels / 릴스) and is not kept.
 */
public final class GuardScreens {
    public static final String YOUTUBE = "com.google.android.youtube";
    public static final String INSTAGRAM = "com.instagram.android";
    public static final String YOUTUBE_ID = YOUTUBE + ":id/";

    /**
     * Only on the Shorts player. Verified on SM-S936N (ShortsDetection) for the
     * Shorts tab, Shorts under a video, home feed, search results and channel tab.
     */
    public static final String[] YOUTUBE_SHORTS_IDS = {
        YOUTUBE_ID + "reel_recycler",
        YOUTUBE_ID + "reel_player_page_container"
    };

    /**
     * Only on the long-form player. Any of these visible means not Shorts. During the
     * long-form to Shorts animation reel_recycler and watch_player show together.
     * Do not use reel_time_bar (also on long-form) or reel_feedback_play/pause
     * (only while tapping).
     */
    public static final String[] YOUTUBE_LONGFORM_IDS = {
        YOUTUBE_ID + "watch_player",
        YOUTUBE_ID + "watch_panel",
        YOUTUBE_ID + "watch_list",
        YOUTUBE_ID + "player_overlays",
        YOUTUBE_ID + "metapanel_overlay_recycler_view"
    };

    /** Full-screen Reels viewer. Feed previews and stories do not use this. */
    private static final String[] INSTAGRAM_REELS = {
        "clips_viewer"
    };

    private GuardScreens() {}

    public static final class Hit {
        public final List<String> ids;
        public final boolean shortsTab;
        public final boolean reelsTab;
        public final boolean clipsClass;

        public Hit(List<String> ids, boolean shortsTab, boolean reelsTab, boolean clipsClass) {
            this.ids = ids == null ? Collections.emptyList() : ids;
            this.shortsTab = shortsTab;
            this.reelsTab = reelsTab;
            this.clipsClass = clipsClass;
        }
    }

    public static boolean isWatchedPackage(String packageName) {
        return YOUTUBE.equals(packageName) || INSTAGRAM.equals(packageName);
    }

    /** View class names such as ClipsViewer. Stories use ReelViewer and do not match. */
    public static boolean viewClassIsReels(String className) {
        if (className == null) return false;
        return className.contains("Clips");
    }

    /**
     * Selected navigation tab only. Long captions, names, and typed text do not match.
     * @return "youtube", "instagram", or null
     */
    public static String selectedTabKind(String description, boolean selected) {
        if (!selected || description == null) return null;
        String trimmed = description.trim();
        if (trimmed.isEmpty() || trimmed.length() > 24) return null;
        String lower = trimmed.toLowerCase(Locale.ROOT);
        if (lower.equals("shorts") || lower.equals("쇼츠")
            || lower.startsWith("shorts ") || trimmed.startsWith("쇼츠 ")) {
            return "youtube";
        }
        if (lower.equals("reels") || lower.equals("릴스")
            || lower.startsWith("reels ") || trimmed.startsWith("릴스 ")) {
            return "instagram";
        }
        return null;
    }

    public static String classify(String packageName, List<String> resourceIds) {
        return classify(packageName, new Hit(resourceIds, false, false, false));
    }

    public static String classify(String packageName, Hit hit) {
        if (packageName == null || hit == null) return null;
        if (YOUTUBE.equals(packageName)) {
            return isYoutubeShorts(hit.ids) ? "youtube" : null;
        }
        if (INSTAGRAM.equals(packageName)) {
            return containsMarker(hit.ids, INSTAGRAM_REELS) ? "instagram" : null;
        }
        return null;
    }

    /**
     * @param visibleIds full YouTube view ids that are visible to the user
     * @return true when a Shorts id is visible and no long-form id is
     */
    public static boolean isYoutubeShorts(List<String> visibleIds) {
        return firstExact(visibleIds, YOUTUBE_SHORTS_IDS) != null
            && firstExact(visibleIds, YOUTUBE_LONGFORM_IDS) == null;
    }

    /** First id in {@code wanted} that appears exactly in {@code ids}, or null. */
    public static String firstExact(List<String> ids, String[] wanted) {
        if (ids == null) return null;
        for (String id : wanted) {
            if (ids.contains(id)) return id;
        }
        return null;
    }

    private static String leafOf(String id) {
        if (id == null || id.isEmpty()) return null;
        int slash = id.lastIndexOf('/');
        if (slash >= 0 && slash + 1 < id.length()) return id.substring(slash + 1);
        return id;
    }

    private static boolean containsMarker(List<String> resourceIds, String[] markers) {
        if (resourceIds == null) return false;
        for (String id : resourceIds) {
            String leaf = leafOf(id);
            if (leaf == null) continue;
            for (String marker : markers) {
                if (leaf.contains(marker)) return true;
            }
        }
        return false;
    }
}
