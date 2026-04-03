package dev.mdb;

import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Watch points: break when a scoreboard value changes.
 *
 * Format: objective + entry → last known value
 * After each command executes, the scoreboard reader checks watched entries.
 * If the value changed, a "watchHit" event is sent and execution pauses.
 */
public class WatchList {

    public static class WatchKey {
        public final String objective;
        public final String entry;

        public WatchKey(String objective, String entry) {
            this.objective = objective;
            this.entry = entry;
        }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof WatchKey)) return false;
            WatchKey w = (WatchKey) o;
            return Objects.equals(objective, w.objective) && Objects.equals(entry, w.entry);
        }

        @Override
        public int hashCode() { return Objects.hash(objective, entry); }

        @Override
        public String toString() { return objective + "[" + entry + "]"; }
    }

    private static final int UNOBSERVED = Integer.MIN_VALUE;

    // WatchKey → last known value (UNOBSERVED = not yet observed)
    private final Map<WatchKey, Integer> watches = new ConcurrentHashMap<>();

    public void add(String objective, String entry) {
        watches.put(new WatchKey(objective, entry), UNOBSERVED);
    }

    public void remove(String objective, String entry) {
        watches.remove(new WatchKey(objective, entry));
    }

    public void clear() {
        watches.clear();
    }

    public boolean isEmpty() {
        return watches.isEmpty();
    }

    public Set<WatchKey> keys() {
        return watches.keySet();
    }

    /**
     * Check if a value changed. Returns the WatchKey if changed, else null.
     * Updates the stored value.
     */
    public WatchKey checkChanged(ScoreboardReader reader) {
        for (Map.Entry<WatchKey, Integer> e : watches.entrySet()) {
            WatchKey key = e.getKey();
            Integer current = reader.readScore(key.objective, key.entry);
            int previous = e.getValue();
            int currentVal = current != null ? current : UNOBSERVED;
            if (previous == UNOBSERVED || currentVal != previous) {
                e.setValue(currentVal);
                return key;
            }
        }
        return null;
    }

    /**
     * Called after a command executes. Returns a changed WatchKey (or null).
     *
     * On first call (previous == null), just records the baseline without firing.
     * This avoids false positives when a watch is added mid-execution.
     */
    public WatchHit detectChange(ScoreboardReader reader) {
        for (Map.Entry<WatchKey, Integer> e : watches.entrySet()) {
            WatchKey key = e.getKey();
            Integer current = reader.readScore(key.objective, key.entry);
            int previous = e.getValue();
            if (previous == UNOBSERVED) {
                // First observation — establish baseline, don't fire
                e.setValue(current != null ? current : UNOBSERVED);
                continue;
            }
            int currentVal = current != null ? current : UNOBSERVED;
            if (currentVal != previous) {
                e.setValue(currentVal);
                return new WatchHit(key, previous == UNOBSERVED ? null : previous,
                                         current);
            }
        }
        return null;
    }

    /** Sync current values without triggering (e.g. at watch set time). */
    public void sync(ScoreboardReader reader) {
        for (Map.Entry<WatchKey, Integer> e : watches.entrySet()) {
            Integer val = reader.readScore(e.getKey().objective, e.getKey().entry);
            e.setValue(val != null ? val : UNOBSERVED);
        }
    }

    public static class WatchHit {
        public final WatchKey key;
        public final Integer oldValue;
        public final Integer newValue;

        WatchHit(WatchKey key, Integer oldValue, Integer newValue) {
            this.key = key;
            this.oldValue = oldValue;
            this.newValue = newValue;
        }
    }
}
