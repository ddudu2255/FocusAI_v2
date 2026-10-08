package app.focuson.shorts;

import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Thompson sampling over the arms the web side scored (lib/ai.ts banditTables).
 * Each arm has a Beta(alpha, beta) posterior; draw once from each and take the highest.
 * Arms without a record use Beta(1, 1), so new methods still get tried.
 * No Android types, so it can be unit tested with a seeded Random.
 */
final class GuardBandit {
    private GuardBandit() {}

    static String pick(List<String> arms, Map<String, double[]> posteriors, Random random) {
        return pick(arms, posteriors, random, null, 0L, 0, 1);
    }

    /**
     * Same, with habituation (ai-2): an arm shown recently has its draw scaled by
     * 1 - strength * 0.5^(hours since shown / recoveryHours), so a fresh arm gets a turn.
     * Learning is unchanged; only the pick leans away from repeats for a while.
     */
    static String pick(
        List<String> arms,
        Map<String, double[]> posteriors,
        Random random,
        Map<String, Long> lastShown,
        long now,
        double strength,
        double recoveryHours
    ) {
        if (arms == null || arms.isEmpty()) return null;
        String best = arms.get(0);
        double bestDraw = -1;
        for (String arm : arms) {
            double[] ab = posteriors == null ? null : posteriors.get(arm);
            double alpha = ab == null ? 1 : Math.max(0.01, ab[0]);
            double beta = ab == null ? 1 : Math.max(0.01, ab[1]);
            double draw = beta(alpha, beta, random);
            Long shown = lastShown == null ? null : lastShown.get(arm);
            draw *= freshness(shown == null ? 0L : shown, now, strength, recoveryHours);
            if (draw > bestDraw) {
                bestDraw = draw;
                best = arm;
            }
        }
        return best;
    }

    /** 1 for never or long ago; 1 - strength right after being shown. */
    static double freshness(long shownAt, long now, double strength, double recoveryHours) {
        if (strength <= 0 || shownAt <= 0 || now < shownAt || recoveryHours <= 0) return 1;
        double hours = (now - shownAt) / 3_600_000.0;
        return 1 - Math.min(1, strength) * Math.pow(0.5, hours / recoveryHours);
    }

    /** Mean of the posterior, for showing what the AI has learned. */
    static double mean(double[] ab) {
        return ab == null ? 0.5 : ab[0] / (ab[0] + ab[1]);
    }

    static double beta(double alpha, double beta, Random random) {
        double x = gamma(alpha, random);
        double y = gamma(beta, random);
        return x + y == 0 ? 0.5 : x / (x + y);
    }

    /** Marsaglia–Tsang; for shape < 1 uses the boost gamma(a + 1) * U^(1 / a). */
    static double gamma(double shape, Random random) {
        if (shape < 1) {
            double u = random.nextDouble();
            return gamma(shape + 1, random) * Math.pow(u, 1.0 / shape);
        }
        double d = shape - 1.0 / 3.0;
        double c = 1.0 / Math.sqrt(9 * d);
        while (true) {
            double x = random.nextGaussian();
            double v = 1 + c * x;
            if (v <= 0) continue;
            v = v * v * v;
            double u = random.nextDouble();
            if (u < 1 - 0.0331 * x * x * x * x) return d * v;
            if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
        }
    }
}
