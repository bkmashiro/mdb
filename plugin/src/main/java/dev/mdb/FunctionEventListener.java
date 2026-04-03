package dev.mdb;

import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServerCommandEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;

/**
 * Phase 1: Intercept /function commands via Bukkit events.
 *
 * This gives us function-level enter/exit events without needing to
 * replace the FunctionManager. Per-line interception comes in Phase 3.
 */
public class FunctionEventListener implements Listener {

    private final DebugSession session;

    public FunctionEventListener(DebugSession session) {
        this.session = session;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onServerCommand(ServerCommandEvent e) {
        interceptCommand(e.getCommand());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerCommand(PlayerCommandPreprocessEvent e) {
        // Strip leading slash
        String cmd = e.getMessage();
        if (cmd.startsWith("/")) cmd = cmd.substring(1);
        interceptCommand(cmd);
    }

    private void interceptCommand(String command) {
        if (command == null) return;
        command = command.trim();
        if (command.startsWith("function ")) {
            String functionId = command.substring("function ".length()).trim();
            // Remove any trailing arguments (macro calls use "with storage ...")
            int spaceIdx = functionId.indexOf(' ');
            if (spaceIdx > 0) functionId = functionId.substring(0, spaceIdx);
            session.onFunctionEnter(functionId);
            // Note: we can't easily hook exit at this level for Phase 1
            // Exit events will come in Phase 3 via FunctionManager instrumentation
        }
    }
}
