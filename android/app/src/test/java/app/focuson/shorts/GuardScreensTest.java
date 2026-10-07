package app.focuson.shorts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class GuardScreensTest {
    @Test
    public void detectsYoutubeShortsPlayerOnly() {
        assertEquals(
            "youtube",
            GuardScreens.classify(
                "com.google.android.youtube",
                Collections.singletonList("com.google.android.youtube:id/reel_player_page_container")
            )
        );
        assertNull(
            GuardScreens.classify(
                "com.google.android.youtube",
                Arrays.asList(
                    "com.google.android.youtube:id/watch_player",
                    "com.google.android.youtube:id/reel_recycler",
                    "com.google.android.youtube:id/shorts_shelf"
                )
            )
        );
        assertNull(
            GuardScreens.classify(
                "com.google.android.youtube",
                Collections.singletonList("com.google.android.youtube:id/watch_player")
            )
        );
        assertNull(
            GuardScreens.classify(
                "com.google.android.youtube",
                Collections.singletonList("com.google.android.youtube:id/shorts_shelf")
            )
        );
    }

    private static final String YT = "com.google.android.youtube:id/";

    @Test
    public void youtubeShortsNeedsExactShortsIdWithoutLongform() {
        assertTrue(GuardScreens.isYoutubeShorts(Collections.singletonList(YT + "reel_recycler")));
        assertTrue(GuardScreens.isYoutubeShorts(Arrays.asList(
            YT + "reel_recycler", YT + "reel_player_page_container", YT + "reel_time_bar")));
        // Long-form to Shorts animation: both visible, not Shorts yet.
        assertFalse(GuardScreens.isYoutubeShorts(Arrays.asList(YT + "reel_recycler", YT + "watch_player")));
        assertFalse(GuardScreens.isYoutubeShorts(Arrays.asList(
            YT + "reel_player_page_container", YT + "metapanel_overlay_recycler_view")));
        assertFalse(GuardScreens.isYoutubeShorts(Collections.<String>emptyList()));
        assertFalse(GuardScreens.isYoutubeShorts(null));
    }

    @Test
    public void youtubeIgnoresUnreliableAndSimilarIds() {
        assertFalse(GuardScreens.isYoutubeShorts(Collections.singletonList(YT + "reel_time_bar")));
        assertFalse(GuardScreens.isYoutubeShorts(Arrays.asList(
            YT + "reel_feedback_play", YT + "reel_feedback_pause")));
        // Old substring markers no longer decide.
        assertFalse(GuardScreens.isYoutubeShorts(Collections.singletonList(YT + "reel_player_page")));
        assertFalse(GuardScreens.isYoutubeShorts(Collections.singletonList(YT + "reel_watch_fragment")));
        assertFalse(GuardScreens.isYoutubeShorts(Collections.singletonList(YT + "reel_recycler_x")));
        assertFalse(GuardScreens.isYoutubeShorts(Collections.singletonList("reel_recycler")));
        assertFalse(GuardScreens.isYoutubeShorts(
            Collections.singletonList("com.instagram.android:id/reel_recycler")));
    }

    @Test
    public void detectsSelectedShortsAndReelsTabsOnly() {
        assertEquals("youtube", GuardScreens.selectedTabKind("Shorts", true));
        assertEquals("youtube", GuardScreens.selectedTabKind("쇼츠", true));
        assertEquals("instagram", GuardScreens.selectedTabKind("Reels", true));
        assertEquals("instagram", GuardScreens.selectedTabKind("릴스 탭", true));
        assertNull(GuardScreens.selectedTabKind("Shorts", false));
        assertNull(GuardScreens.selectedTabKind("shortcuts", true));
        assertNull(GuardScreens.selectedTabKind("오늘 본 릴스 캡션이 길어서 저장하면 안 되는 문장", true));
        assertNull(
            GuardScreens.classify(
                "com.google.android.youtube",
                new GuardScreens.Hit(Collections.emptyList(), true, false, false)
            )
        );
        assertNull(
            GuardScreens.classify(
                "com.instagram.android",
                new GuardScreens.Hit(Collections.emptyList(), false, true, false)
            )
        );
        assertNull(
            GuardScreens.classify(
                "com.google.android.youtube",
                new GuardScreens.Hit(Collections.emptyList(), false, true, false)
            )
        );
    }

    @Test
    public void detectsClipsClassButNotStoryClass() {
        assertTrue(GuardScreens.viewClassIsReels("com.instagram.clips.ClipsViewer"));
        assertFalse(GuardScreens.viewClassIsReels("com.instagram.reels.ReelViewer"));
        assertNull(
            GuardScreens.classify(
                "com.instagram.android",
                new GuardScreens.Hit(Collections.emptyList(), false, false, true)
            )
        );
        assertNull(
            GuardScreens.classify(
                "com.instagram.android",
                Collections.singletonList("com.instagram.android:id/clips_video_container")
            )
        );
    }

    @Test
    public void detectsInstagramReelsNotStories() {
        assertEquals(
            "instagram",
            GuardScreens.classify(
                "com.instagram.android",
                Collections.singletonList("com.instagram.android:id/clips_viewer_container")
            )
        );
        assertNull(
            GuardScreens.classify(
                "com.instagram.android",
                Collections.singletonList("com.instagram.android:id/reel_viewer_root")
            )
        );
    }

    @Test
    public void ignoresOtherPackages() {
        assertNull(
            GuardScreens.classify(
                "com.android.chrome",
                Collections.singletonList("com.google.android.youtube:id/reel_player_page_container")
            )
        );
        assertNull(GuardScreens.classify("com.google.android.youtube", (List<String>) null));
    }
}
