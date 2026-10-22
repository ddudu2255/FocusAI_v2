package app.focuson.shorts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class ShortsGuardServiceTest {
    private static final String IG_PKG = "com.instagram.android";
    private static final String IG = "com.instagram.android:id/";

    @Test
    public void reelsUsesTheSameNativeSheetAsShorts() {
        assertTrue(ShortsGuardService.usesNativeSheet("youtube"));
        assertTrue(ShortsGuardService.usesNativeSheet("instagram"));
        assertFalse(ShortsGuardService.usesNativeSheet("practice"));
        assertFalse(ShortsGuardService.usesNativeSheet(null));
        assertFalse(ShortsGuardService.usesNativeSheet(""));
    }

    @Test
    public void instagramHomeDoesNotOpenTheSheet() {
        assertFalse(GuardScreens.opensSheet(IG_PKG, homeFeed()));
        assertFalse(GuardScreens.opensSheet(IG_PKG, justOpened()));
        assertFalse(GuardScreens.opensSheet(IG_PKG, directMessages()));
        assertFalse(GuardScreens.opensSheet(IG_PKG, profile()));
        assertFalse(GuardScreens.opensSheet(IG_PKG, explore()));
    }

    @Test
    public void afterLeaveLaterInstagramWindowDoesNotOpenTheSheet() {
        LeaveGate gate = new LeaveGate();
        gate.begin("instagram");
        assertNull(GuardScreens.classifyWindow(IG_PKG, homeFeed()));
        assertFalse(gate.opensSheet(null, GuardScreens.classifyWindow(IG_PKG, homeFeed())));
        gate.clear();
        assertFalse(gate.opensSheet(null, GuardScreens.classifyWindow(IG_PKG, homeFeed())));
        assertFalse(gate.opensSheet(null, GuardScreens.classifyWindow(IG_PKG, justOpened())));
        assertFalse(gate.opensSheet(null, GuardScreens.classifyWindow(IG_PKG, directMessages())));
        assertFalse(gate.opensSheet(null, GuardScreens.classifyWindow(IG_PKG, profile())));
        assertFalse(gate.opensSheet(null, GuardScreens.classifyWindow(IG_PKG, explore())));
        // YouTube leave still ignores the player until it has actually gone.
        LeaveGate shorts = new LeaveGate();
        shorts.begin("youtube");
        assertFalse(shorts.opensSheet(null, "youtube"));
    }

    @Test
    public void reelsViewerStillOpensTheSheetAfterLeave() {
        assertTrue(GuardScreens.opensSheet(IG_PKG, reelsViewer()));
        assertEquals("instagram", GuardScreens.classifyWindow(IG_PKG, reelsViewer()));

        LeaveGate backToReels = new LeaveGate();
        backToReels.begin("instagram");
        assertFalse(backToReels.opensSheet(null, null));
        assertTrue(backToReels.opensSheet(null, GuardScreens.classifyWindow(IG_PKG, reelsViewer())));

        LeaveGate later = new LeaveGate();
        later.begin("instagram");
        later.clear();
        assertTrue(later.opensSheet(null, GuardScreens.classifyWindow(IG_PKG, reelsViewer())));
    }

    private static GuardScreens.Mark ig(String leaf, boolean visible, int width, int height) {
        return new GuardScreens.Mark(IG + leaf, visible, width, height);
    }

    private static List<GuardScreens.Mark> homeFeed() {
        return Arrays.asList(
            ig("clips_viewer_view_pager", true, 0, 0),
            ig("clips_viewer_container", true, 0, 0),
            ig("row_feed_button_like", true, 1080, 96),
            ig("row_feed_button_comment", true, 1080, 96),
            ig("row_feed_profile_header", true, 1080, 160)
        );
    }

    private static List<GuardScreens.Mark> justOpened() {
        return Arrays.asList(ig("clips_viewer_view_pager", true, 0, 0));
    }

    private static List<GuardScreens.Mark> directMessages() {
        return Arrays.asList(
            ig("clips_viewer_view_pager", true, 0, 0),
            ig("inbox_refreshable_thread_list_recyclerview", true, 1080, 1800),
            ig("row_inbox_container", true, 1080, 220)
        );
    }

    private static List<GuardScreens.Mark> profile() {
        return Arrays.asList(
            ig("clips_viewer_container", true, 1080, 2400),
            ig("profile_header_container", true, 1080, 480),
            ig("profile_header_full_name", true, 480, 64)
        );
    }

    private static List<GuardScreens.Mark> explore() {
        return Arrays.asList(
            ig("clips_viewer_view_pager", true, 0, 0),
            ig("action_bar_search_hints_text_layout", true, 960, 140),
            ig("action_bar_search_edit_text", true, 800, 88)
        );
    }

    private static List<GuardScreens.Mark> reelsViewer() {
        return Arrays.asList(
            ig("clips_viewer_view_pager", true, 1080, 2400),
            ig("clips_tab", true, 140, 140)
        );
    }
}
