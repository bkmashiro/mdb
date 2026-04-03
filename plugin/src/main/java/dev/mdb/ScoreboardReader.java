package dev.mdb;

import org.bukkit.Bukkit;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Score;
import org.bukkit.scoreboard.Scoreboard;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.*;
import java.util.logging.Logger;
import java.util.stream.Collectors;

/**
 * Reads scoreboard values via Bukkit API (Paper 1.21.4).
 *
 * Uses Scoreboard.getEntries() to enumerate all tracked entries,
 * then reads each score from the target objective.
 */
public class ScoreboardReader {

    private final Logger logger;

    public ScoreboardReader(Logger logger) {
        this.logger = logger;
    }

    /**
     * Read all entries for a given objective name.
     * Returns a map of entry_name → score_value (only entries that are set).
     */
    public Map<String, Integer> readObjective(String objectiveName) {
        Map<String, Integer> result = new LinkedHashMap<>();
        try {
            Scoreboard sb = Bukkit.getScoreboardManager().getMainScoreboard();
            Objective objective = sb.getObjective(objectiveName);
            if (objective == null) {
                result.put("__error__:objective not found", -1);
                return result;
            }

            // getEntries() returns all tracked string entries (fake players, real players)
            Set<String> entries = sb.getEntries();
            for (String entry : entries) {
                Score score = objective.getScore(entry);
                if (score.isScoreSet()) {
                    result.put(entry, score.getScore());
                }
            }
        } catch (Exception e) {
            logger.warning("[mdb] readObjective failed: " + e.getMessage());
            result.put("__error__:" + e.getMessage(), -1);
        }
        return result;
    }

    /**
     * Read a single score: objective + fake-player/entry name.
     */
    public Integer readScore(String objectiveName, String entry) {
        try {
            Scoreboard sb = Bukkit.getScoreboardManager().getMainScoreboard();
            Objective objective = sb.getObjective(objectiveName);
            if (objective == null) return null;
            Score score = objective.getScore(entry);
            return score.isScoreSet() ? score.getScore() : null;
        } catch (Exception e) {
            logger.warning("[mdb] readScore failed: " + e.getMessage());
            return null;
        }
    }

    /**
     * List all registered objective names on the main scoreboard.
     */
    public List<String> listObjectives() {
        try {
            Scoreboard sb = Bukkit.getScoreboardManager().getMainScoreboard();
            return sb.getObjectives().stream()
                .map(Objective::getName)
                .sorted()
                .collect(Collectors.toList());
        } catch (Exception e) {
            logger.warning("[mdb] listObjectives failed: " + e.getMessage());
            return Collections.emptyList();
        }
    }
}
