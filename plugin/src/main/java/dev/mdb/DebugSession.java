package dev.mdb;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Manages the connection to the mdb debug server and breakpoint state.
 */
public class DebugSession {

    private final JavaPlugin plugin;
    private final String host;
    private final int port;
    private final int breakpointTimeoutSeconds;
    private final boolean traceAll;
    private final Gson gson = new Gson();
    private ScoreboardReader scoreboardReader;

    // breakpoints: "namespace:path/to/func" -> set of line numbers (1-indexed)
    private final Map<String, Set<Integer>> breakpoints = new ConcurrentHashMap<>();

    // The current latch — non-null when paused at a breakpoint
    private final AtomicReference<CountDownLatch> pauseLatch = new AtomicReference<>(null);

    // "step" mode: pause after every command
    private volatile boolean stepping = false;

    private PluginWebSocketClient wsClient;

    public DebugSession(JavaPlugin plugin, String host, int port, int timeoutSeconds, boolean traceAll) {
        this.plugin = plugin;
        this.host = host;
        this.port = port;
        this.breakpointTimeoutSeconds = timeoutSeconds;
        this.traceAll = traceAll;
    }

    public void initScoreboardReader() {
        scoreboardReader = new ScoreboardReader(plugin.getLogger());
    }

    public void connect() {
        try {
            URI uri = new URI("ws://" + host + ":" + port + "/plugin");
            wsClient = new PluginWebSocketClient(uri, this, plugin.getLogger());
            wsClient.connectBlocking(3, TimeUnit.SECONDS);
        } catch (Exception e) {
            plugin.getLogger().warning("[mdb] Could not connect to debug server: " + e.getMessage());
        }
    }

    public void disconnect() {
        if (wsClient != null) {
            try { wsClient.closeBlocking(); } catch (Exception ignored) {}
        }
        resume(); // release any paused tick
    }

    public boolean isConnected() {
        return wsClient != null && wsClient.isOpen();
    }

    // ── Called from FunctionManagerHook ──────────────────────────────────────

    public void onFunctionEnter(String functionId) {
        if (traceAll) plugin.getLogger().info("[mdb] >> enter: " + functionId);
        send(Map.of("type", "functionEnter", "function", functionId));
    }

    public void onFunctionExit(String functionId) {
        if (traceAll) plugin.getLogger().info("[mdb] << exit: " + functionId);
        send(Map.of("type", "functionExit", "function", functionId));
    }

    /**
     * Called before each command. Returns after the debugger allows execution
     * (either no breakpoint, or user pressed step/continue).
     */
    public void onBeforeCommand(String functionId, int line, String command,
                                 Map<String, Integer> scores) {
        if (traceAll) {
            plugin.getLogger().info("[mdb] cmd [" + functionId + ":" + line + "] " + command);
        }

        boolean isBreakpoint = hasBreakpoint(functionId, line);

        if (!isBreakpoint && !stepping) return;

        // Notify client we stopped
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "stopped");
        msg.addProperty("reason", stepping ? "step" : "breakpoint");
        JsonObject loc = new JsonObject();
        loc.addProperty("function", functionId);
        loc.addProperty("line", line);
        loc.addProperty("command", command);
        msg.add("location", loc);
        JsonObject scoresObj = new JsonObject();
        scores.forEach(scoresObj::addProperty);
        msg.add("scores", scoresObj);
        sendRaw(gson.toJson(msg));

        // Block the MC main thread (tick freeze)
        CountDownLatch latch = new CountDownLatch(1);
        pauseLatch.set(latch);
        try {
            boolean resumed = latch.await(breakpointTimeoutSeconds, TimeUnit.SECONDS);
            if (!resumed) {
                plugin.getLogger().warning("[mdb] Breakpoint timeout — auto-resuming.");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            pauseLatch.set(null);
        }
    }

    public void onAfterCommand(String functionId, int line, String command,
                                Map<String, Integer> scores) {
        // Could send a "commandResult" event here if needed
    }

    // ── Called from WebSocket client (server → plugin commands) ──────────────

    public void handleServerMessage(String json) {
        try {
            JsonObject msg = gson.fromJson(json, JsonObject.class);
            String type = msg.get("type").getAsString();

            switch (type) {
                case "step" -> {
                    stepping = true;
                    resume();
                }
                case "continue" -> {
                    stepping = false;
                    resume();
                }
                case "setBreakpoint" -> {
                    String func = msg.get("function").getAsString();
                    int line = msg.get("line").getAsInt();
                    breakpoints.computeIfAbsent(func, k -> ConcurrentHashMap.newKeySet()).add(line);
                    plugin.getLogger().info("[mdb] Breakpoint set: " + func + ":" + line);
                }
                case "clearBreakpoint" -> {
                    String func = msg.get("function").getAsString();
                    int line = msg.get("line").getAsInt();
                    Set<Integer> lines = breakpoints.get(func);
                    if (lines != null) lines.remove(line);
                }
                case "clearAllBreakpoints" -> breakpoints.clear();

                case "print" -> {
                    // print <objective> [entry]
                    String objective = msg.has("objective") ? msg.get("objective").getAsString() : null;
                    String entry = msg.has("entry") ? msg.get("entry").getAsString() : null;
                    handlePrint(objective, entry);
                }

                case "listObjectives" -> {
                    if (scoreboardReader != null) {
                        var names = scoreboardReader.listObjectives();
                        JsonObject resp = new JsonObject();
                        resp.addProperty("type", "objectives");
                        var arr = new com.google.gson.JsonArray();
                        names.forEach(arr::add);
                        resp.add("objectives", arr);
                        sendRaw(gson.toJson(resp));
                    }
                }

                default -> plugin.getLogger().warning("[mdb] Unknown server message type: " + type);
            }
        } catch (Exception e) {
            plugin.getLogger().warning("[mdb] Failed to parse server message: " + e.getMessage());
        }
    }

    // ── Print / scoreboard helpers ──────────────────────────────────────────

    private void handlePrint(String objective, String entry) {
        if (scoreboardReader == null) {
            sendRaw("{\"type\":\"printResult\",\"error\":\"ScoreboardReader not initialized\"}");
            return;
        }
        JsonObject resp = new JsonObject();
        resp.addProperty("type", "printResult");
        if (objective == null) {
            resp.addProperty("error", "objective required");
        } else if (entry != null) {
            // Single score
            Integer val = scoreboardReader.readScore(objective, entry);
            resp.addProperty("objective", objective);
            resp.addProperty("entry", entry);
            if (val != null) resp.addProperty("value", val);
            else resp.addProperty("error", "not set");
        } else {
            // All scores for objective
            Map<String, Integer> scores = scoreboardReader.readObjective(objective);
            resp.addProperty("objective", objective);
            JsonObject scoresObj = new JsonObject();
            scores.forEach(scoresObj::addProperty);
            resp.add("scores", scoresObj);
        }
        sendRaw(gson.toJson(resp));
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private boolean hasBreakpoint(String functionId, int line) {
        Set<Integer> lines = breakpoints.get(functionId);
        return lines != null && lines.contains(line);
    }

    private void resume() {
        CountDownLatch latch = pauseLatch.getAndSet(null);
        if (latch != null) latch.countDown();
    }

    private void send(Map<String, ?> data) {
        sendRaw(gson.toJson(data));
    }

    private void sendRaw(String json) {
        if (isConnected()) {
            try { wsClient.send(json); } catch (Exception ignored) {}
        }
    }
}
