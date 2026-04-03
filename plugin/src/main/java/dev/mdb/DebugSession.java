package dev.mdb;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Central hub: breakpoints, stepping, call stack, watches, scoreboard reads.
 */
public class DebugSession {

    private final JavaPlugin plugin;
    private final String host;
    private final int port;
    private final int breakpointTimeoutSeconds;
    private final boolean traceAll;
    private final Gson gson = new Gson();

    // breakpoints: "namespace:path" -> set of line numbers (1-indexed)
    private final Map<String, Set<Integer>> breakpoints = new ConcurrentHashMap<>();

    // watchpoints
    private final WatchList watchList = new WatchList();

    // pause latch — non-null when paused
    private final AtomicReference<CountDownLatch> pauseLatch = new AtomicReference<>(null);

    // step mode: pause after every command
    private volatile boolean stepping = false;

    // scoreboard reader (init after world load)
    private ScoreboardReader scoreboardReader;
    // storage/NBT reader
    private StorageReader storageReader;

    private PluginWebSocketClient wsClient;

    public DebugSession(JavaPlugin plugin, String host, int port, int timeoutSeconds, boolean traceAll) {
        this.plugin = plugin;
        this.host = host;
        this.port = port;
        this.breakpointTimeoutSeconds = timeoutSeconds;
        this.traceAll = traceAll;
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    public void initScoreboardReader() {
        scoreboardReader = new ScoreboardReader(plugin.getLogger());
        storageReader = new StorageReader(plugin.getLogger());
    }

    public void connect() {
        try {
            URI uri = new URI("ws://" + host + ":" + port + "/plugin");
            wsClient = new PluginWebSocketClient(uri, this, plugin.getLogger());
            wsClient.connectBlocking(3, TimeUnit.SECONDS);
        } catch (Exception e) {
            plugin.getLogger().warning("[mdb] Could not connect: " + e.getMessage());
        }
    }

    public void disconnect() {
        if (wsClient != null) {
            try { wsClient.closeBlocking(); } catch (Exception ignored) {}
        }
        resume();
    }

    public boolean isConnected() {
        return wsClient != null && wsClient.isOpen();
    }

    // ── Called from InstrumentedAction ───────────────────────────────────────

    public void onFunctionEnter(String functionId) {
        if (traceAll) plugin.getLogger().info("[mdb] >> " + functionId);
        CallStack.push(functionId);
        send(Map.of("type", "functionEnter", "function", functionId));
    }

    public void onFunctionExit(String functionId) {
        if (traceAll) plugin.getLogger().info("[mdb] << " + functionId);
        CallStack.pop();
        send(Map.of("type", "functionExit", "function", functionId));
    }

    /**
     * Called BEFORE each command line executes.
     * Blocks the MC main thread if a breakpoint or step is active.
     */
    public void onBeforeCommand(String functionId, int line, String command,
                                 Map<String, Integer> ignored) {
        if (traceAll) plugin.getLogger().info("[mdb] cmd [" + functionId + ":" + line + "] " + command);

        CallStack.updateCurrentLine(line);

        boolean isBreakpoint = hasBreakpoint(functionId, line);
        if (!isBreakpoint && !stepping) return;

        pauseAt(functionId, line, command, isBreakpoint ? "breakpoint" : "step");
    }

    /**
     * Called AFTER each command executes — check watchpoints.
     */
    public void onAfterCommand(String functionId, int line, String command,
                                Map<String, Integer> ignored) {
        if (watchList.isEmpty() || scoreboardReader == null) return;

        WatchList.WatchHit hit = watchList.detectChange(scoreboardReader);
        if (hit == null) return;

        // Notify clients
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "watchHit");
        msg.addProperty("watch", hit.key.toString());
        msg.addProperty("objective", hit.key.objective);
        msg.addProperty("entry", hit.key.entry);
        if (hit.oldValue != null) msg.addProperty("oldValue", hit.oldValue);
        else msg.addProperty("oldValue", (Integer) null);
        if (hit.newValue != null) msg.addProperty("newValue", hit.newValue);
        else msg.addProperty("newValue", (Integer) null);
        // Include location
        JsonObject loc = new JsonObject();
        loc.addProperty("function", functionId);
        loc.addProperty("line", line);
        loc.addProperty("command", command);
        msg.add("location", loc);
        sendRaw(gson.toJson(msg));

        // Pause like a breakpoint
        pauseAt(functionId, line, command, "watch");
    }

    // ── Pause logic ───────────────────────────────────────────────────────────

    private void pauseAt(String functionId, int line, String command, String reason) {
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "stopped");
        msg.addProperty("reason", reason);

        JsonObject loc = new JsonObject();
        loc.addProperty("function", functionId);
        loc.addProperty("line", line);
        loc.addProperty("command", command);
        msg.add("location", loc);

        // Attach call stack
        List<CallStack.Frame> stack = CallStack.snapshot();
        JsonArray stackArr = new JsonArray();
        for (CallStack.Frame frame : stack) {
            JsonObject f = new JsonObject();
            f.addProperty("function", frame.functionId);
            f.addProperty("line", frame.currentLine);
            stackArr.add(f);
        }
        msg.add("stack", stackArr);

        sendRaw(gson.toJson(msg));

        // Block MC main thread
        CountDownLatch latch = new CountDownLatch(1);
        pauseLatch.set(latch);
        try {
            boolean resumed = latch.await(breakpointTimeoutSeconds, TimeUnit.SECONDS);
            if (!resumed) {
                plugin.getLogger().warning("[mdb] Breakpoint timeout (" + breakpointTimeoutSeconds + "s) — auto-resuming.");
                stepping = false;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            pauseLatch.set(null);
        }
    }

    // ── Server message handler ────────────────────────────────────────────────

    public void handleServerMessage(String json) {
        try {
            JsonObject msg = gson.fromJson(json, JsonObject.class);
            String type = msg.get("type").getAsString();

            switch (type) {
                case "step" -> { stepping = true;  resume(); }
                case "continue" -> { stepping = false; resume(); }

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

                case "watch" -> {
                    String obj = msg.get("objective").getAsString();
                    String entry = msg.get("entry").getAsString();
                    watchList.add(obj, entry);
                    // baseline is established on first detectChange call (value=null)
                    plugin.getLogger().info("[mdb] Watch: " + obj + "[" + entry + "]");
                }
                case "unwatch" -> {
                    String obj = msg.get("objective").getAsString();
                    String entry = msg.get("entry").getAsString();
                    watchList.remove(obj, entry);
                }
                case "unwatchAll" -> watchList.clear();

                case "print" -> {
                    String objective = msg.has("objective") ? msg.get("objective").getAsString() : null;
                    String entry = msg.has("entry") ? msg.get("entry").getAsString() : null;
                    handlePrint(objective, entry);
                }
                case "listObjectives" -> {
                    if (scoreboardReader != null) {
                        var names = scoreboardReader.listObjectives();
                        JsonObject resp = new JsonObject();
                        resp.addProperty("type", "objectives");
                        JsonArray arr = new JsonArray();
                        names.forEach(arr::add);
                        resp.add("objectives", arr);
                        sendRaw(gson.toJson(resp));
                    }
                }

                case "storage" -> {
                    // storage <id> [path]
                    String storageId = msg.has("id") ? msg.get("id").getAsString() : null;
                    String path = msg.has("path") ? msg.get("path").getAsString() : "";
                    handleStorage(storageId, path);
                }

                case "listStorage" -> {
                    handleListStorage();
                }

                default -> plugin.getLogger().warning("[mdb] Unknown message type: " + type);
            }
        } catch (Exception e) {
            plugin.getLogger().warning("[mdb] Failed to parse server message: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    // ── Storage / NBT ──────────────────────────────────────────────────

    private void handleStorage(String storageId, String path) {
        JsonObject resp = new JsonObject();
        resp.addProperty("type", "storageResult");
        if (storageId == null) {
            resp.addProperty("error", "id required");
        } else if (storageReader == null) {
            resp.addProperty("error", "StorageReader not ready");
        } else {
            StorageReader.StorageResult result = storageReader.read(storageId, path);
            resp.addProperty("id", storageId);
            resp.addProperty("path", path != null ? path : "");
            if (result.ok) resp.addProperty("value", result.value);
            else resp.addProperty("error", result.error);
        }
        sendRaw(gson.toJson(resp));
    }

    private void handleListStorage() {
        JsonObject resp = new JsonObject();
        resp.addProperty("type", "storageList");
        if (storageReader == null) {
            resp.addProperty("error", "StorageReader not ready");
        } else {
            JsonArray arr = new JsonArray();
            storageReader.listKeys().forEach(arr::add);
            resp.add("keys", arr);
        }
        sendRaw(gson.toJson(resp));
    }

    // ── Print / scoreboard ────────────────────────────────────────────────────

    private void handlePrint(String objective, String entry) {
        JsonObject resp = new JsonObject();
        resp.addProperty("type", "printResult");
        if (scoreboardReader == null) {
            resp.addProperty("error", "ScoreboardReader not initialized");
        } else if (objective == null) {
            resp.addProperty("error", "objective required");
        } else if (entry != null) {
            Integer val = scoreboardReader.readScore(objective, entry);
            resp.addProperty("objective", objective);
            resp.addProperty("entry", entry);
            if (val != null) resp.addProperty("value", val);
            else resp.addProperty("error", "not set");
        } else {
            Map<String, Integer> scores = scoreboardReader.readObjective(objective);
            resp.addProperty("objective", objective);
            JsonObject scoresObj = new JsonObject();
            scores.forEach(scoresObj::addProperty);
            resp.add("scores", scoresObj);
        }
        sendRaw(gson.toJson(resp));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private boolean hasBreakpoint(String functionId, int line) {
        Set<Integer> lines = breakpoints.get(functionId);
        return lines != null && lines.contains(line);
    }

    private void resume() {
        CountDownLatch latch = pauseLatch.getAndSet(null);
        if (latch != null) latch.countDown();
    }

    private void send(Map<String, ?> data) { sendRaw(gson.toJson(data)); }

    private void sendRaw(String json) {
        if (isConnected()) {
            try { wsClient.send(json); } catch (Exception ignored) {}
        }
    }
}
