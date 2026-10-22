package app.focuson.shorts;

/**
 * "나가기" state shared by YouTube and Instagram.
 * While Back has not left the player, that same player is not a new entry and
 * does not open the sheet again. A later window that is not the player does not
 * open it either. Opening the player again does.
 */
final class LeaveGate {
    private String leavingKind;
    private boolean sawOtherSinceLeave;

    void begin(String kind) {
        leavingKind = kind;
        sawOtherSinceLeave = false;
    }

    void clear() {
        leavingKind = null;
    }

    String kind() {
        return leavingKind;
    }

    /**
     * @return true when this sample is still the player Back has not left yet
     *         and must be ignored. A non-player sample is not ignored; it marks
     *         that the user has left.
     */
    boolean suppress(String classifiedKind) {
        if (leavingKind == null) return false;
        if (classifiedKind == null) {
            sawOtherSinceLeave = true;
            return false;
        }
        return !sawOtherSinceLeave;
    }

    /** True when 나가기 should press Home because the player is still up. */
    boolean stillOnPlayer(String classifiedKind) {
        return leavingKind != null && !sawOtherSinceLeave && leavingKind.equals(classifiedKind);
    }

    /**
     * @param currentKind stay before this sample, or null after 나가기 ends it
     * @param classifiedKind player kind on this window, or null when it is not the player
     * @return true when this window should open the intervention sheet
     */
    boolean opensSheet(String currentKind, String classifiedKind) {
        if (suppress(classifiedKind)) return false;
        return classifiedKind != null && !classifiedKind.equals(currentKind);
    }
}
