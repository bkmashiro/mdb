package dev.mdb;

import org.bukkit.plugin.java.JavaPlugin;

/**
 * Phase 1: No-op. Function interception is handled by FunctionEventListener
 * via Bukkit events instead of replacing the NMS ServerFunctionManager.
 *
 * Per-line interception via FunctionManager replacement is deferred to Phase 3.
 */
public class FunctionManagerHook {

    private final JavaPlugin plugin;
    private final DebugSession session;

    public FunctionManagerHook(JavaPlugin plugin, DebugSession session) {
        this.plugin = plugin;
        this.session = session;
    }

    public boolean install() {
        plugin.getLogger().info("[mdb] FunctionManagerHook: Phase 1 uses event-based interception; no NMS hook installed.");
        return true;
    }
}
