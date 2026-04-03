package dev.mdb;

import org.bukkit.Bukkit;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;

/**
 * Reads mcfunction source lines from the datapack files on disk.
 *
 * Path resolution:
 *   "mdb_test:test"  →  world/datapacks/<any>/data/mdb_test/function/test.mcfunction
 *
 * For functions nested in subdirs:
 *   "mdb_test:combat/tick"  →  .../data/mdb_test/function/combat/tick.mcfunction
 *
 * If the function exists in multiple datapacks (overlay), returns from the first one found
 * (same priority order as MC loads them — but for display purposes any copy works).
 */
public class FunctionSourceReader {

    private final Logger logger;
    private File datapacks;

    public FunctionSourceReader(Logger logger) {
        this.logger = logger;
        // world/datapacks relative to server working dir
        datapacks = new File("world/datapacks");
        if (!datapacks.exists()) {
            // Try server root
            datapacks = new File(Bukkit.getWorldContainer(), "world/datapacks");
        }
        if (datapacks.exists()) {
            logger.info("[mdb] FunctionSourceReader: datapacks at " + datapacks.getAbsolutePath());
        } else {
            logger.warning("[mdb] FunctionSourceReader: datapacks dir not found at " + datapacks.getAbsolutePath());
        }
    }

    /**
     * Get source lines for a function.
     * @param functionId  e.g. "mdb_test:test" or "mdb_test:combat/tick"
     * @return list of source lines (1-indexed: index 0 = line 1), or null if not found
     */
    public SourceResult getSource(String functionId) {
        if (!functionId.contains(":")) {
            return SourceResult.error("Invalid function id: " + functionId);
        }

        String[] parts = functionId.split(":", 2);
        String namespace = parts[0];
        String path = parts[1];  // e.g. "test" or "combat/tick"

        // Relative file path inside datapack: data/<namespace>/function/<path>.mcfunction
        String relPath = "data/" + namespace + "/function/" + path + ".mcfunction";

        if (!datapacks.exists()) {
            return SourceResult.error("Datapacks directory not found");
        }

        // Search all datapacks (sorted for determinism)
        File[] packs = datapacks.listFiles(File::isDirectory);
        if (packs == null) return SourceResult.error("No datapacks found");

        java.util.Arrays.sort(packs);
        for (File pack : packs) {
            File fnFile = new File(pack, relPath);
            if (fnFile.exists()) {
                try {
                    List<String> lines = Files.readAllLines(fnFile.toPath());
                    return SourceResult.ok(functionId, lines, fnFile.getAbsolutePath());
                } catch (IOException e) {
                    return SourceResult.error("Failed to read " + fnFile + ": " + e.getMessage());
                }
            }
        }

        return SourceResult.error("Function not found in any datapack: " + functionId);
    }

    // ── Result ────────────────────────────────────────────────────────────────

    public static class SourceResult {
        public final boolean ok;
        public final String functionId;
        public final List<String> lines;  // 0-indexed, line 1 = lines.get(0)
        public final String filePath;
        public final String error;

        private SourceResult(boolean ok, String functionId, List<String> lines, String filePath, String error) {
            this.ok = ok;
            this.functionId = functionId;
            this.lines = lines;
            this.filePath = filePath;
            this.error = error;
        }

        public static SourceResult ok(String id, List<String> lines, String path) {
            return new SourceResult(true, id, lines, path, null);
        }

        public static SourceResult error(String msg) {
            return new SourceResult(false, null, null, null, msg);
        }
    }
}
