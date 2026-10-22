package app.focuson.shorts;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Decides whether a window is the YouTube Shorts player or the Instagram Reels
 * player. Resource ids are structural and must be on screen. A content
 * description is consulted only when it is a short selected tab label
 * (Shorts / 쇼츠 / Reels / 릴스) and is not kept. The Reels tab label alone
 * is not the viewer.
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

    public static final String INSTAGRAM_ID = INSTAGRAM + ":id/";

    /**
     * Full-screen Reels viewer only. Exact ids, same as the Shorts ids.
     * Instagram keeps these nodes in the window on home, DMs, profile, explore,
     * and a cold start, but with size 0. A feed preview uses other ids.
     */
    public static final String[] INSTAGRAM_REELS_IDS = {
        INSTAGRAM_ID + "clips_viewer_view_pager",
        INSTAGRAM_ID + "clips_viewer_container"
    };

    /**
     * Visible on home, DMs, profile, or explore, not on the Reels viewer.
     * Same role as the long-form ids: if one of these is on screen, it is not Reels.
     * The bottom tab bar stays visible on the viewer, so tab ids are not here.
     */
    public static final String[] INSTAGRAM_NOT_REELS_IDS = {
        INSTAGRAM_ID + "row_feed_button_like",
        INSTAGRAM_ID + "row_feed_button_comment",
        INSTAGRAM_ID + "row_feed_profile_header",
        INSTAGRAM_ID + "row_feed_photo_imageview",
        INSTAGRAM_ID + "inbox_refreshable_thread_list_recyclerview",
        INSTAGRAM_ID + "row_inbox_container",
        INSTAGRAM_ID + "profile_header_container",
        INSTAGRAM_ID + "row_profile_header",
        INSTAGRAM_ID + "profile_header_full_name",
        INSTAGRAM_ID + "action_bar_search_hints_text_layout",
        INSTAGRAM_ID + "action_bar_search_edit_text"
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
            return isInstagramReels(hit.ids) ? "instagram" : null;
        }
        return null;
    }

    /**
     * One node from an Instagram window. {@code width} and {@code height} are the
     * bounds on screen. A node Instagram still reports as visible at 0×0 does not count.
     */
    public static final class Mark {
        public final String id;
        public final boolean visibleToUser;
        public final int width;
        public final int height;

        public Mark(String id, boolean visibleToUser, int width, int height) {
            this.id = id;
            this.visibleToUser = visibleToUser;
            this.width = width;
            this.height = height;
        }
    }

    /** True when the node is actually on screen. Size 0 is not the Reels viewer. */
    public static boolean countsOnScreen(boolean visibleToUser, int width, int height) {
        return visibleToUser && width > 0 && height > 0;
    }

    /** Ids that passed {@link #countsOnScreen}. Hidden and 0×0 nodes are dropped. */
    public static List<String> onScreenIds(List<Mark> marks) {
        if (marks == null) return Collections.emptyList();
        List<String> ids = new ArrayList<>();
        for (Mark mark : marks) {
            if (mark == null || mark.id == null) continue;
            if (countsOnScreen(mark.visibleToUser, mark.width, mark.height)) ids.add(mark.id);
        }
        return ids;
    }

    /** Classifies a window after dropping nodes that are not actually on screen. */
    public static String classifyWindow(String packageName, List<Mark> marks) {
        return classify(packageName, onScreenIds(marks));
    }

    /**
     * True when this window is the player, which is what opens the intervention sheet.
     * Home, DMs, profile, explore, and an Instagram window that only holds a 0×0
     * Reels pager return false.
     */
    public static boolean opensSheet(String packageName, List<Mark> marks) {
        return classifyWindow(packageName, marks) != null;
    }

    /**
     * @param onScreenIds Instagram view ids that are visible and non-zero
     * @return true when a Reels viewer id is on screen and no home/DM/profile/explore id is
     */
    public static boolean isInstagramReels(List<String> onScreenIds) {
        return firstExact(onScreenIds, INSTAGRAM_REELS_IDS) != null
            && firstExact(onScreenIds, INSTAGRAM_NOT_REELS_IDS) == null;
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

}
