package dev.mdb;

import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServerLoadEvent;
import io.papermc.paper.event.server.ServerResourcesReloadedEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.lang.reflect.Field;
import java.util.logging.Logger;

/**
 * Automatically re-instruments the function library after:
 *   - Server start (ServerLoadEvent)
 *   - /reload (ServerResourcesReloadedEvent)
 *
 * This ensures mdb works seamlessly even when datapacks are hot-reloaded.
 */
public class AutoRepatchListener implements Listener {

    private final JavaPlugin plugin;
    private final DebugSession session;
    private final Logger logger;

    public AutoRepatchListener(JavaPlugin plugin, DebugSession session) {
        this.plugin = plugin;
        this.session = session;
        this.logger = plugin.getLogger();
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onServerLoad(ServerLoadEvent e) {
        // Fires once on initial server start (type STARTUP or RELOAD)
        scheduleRepatch("ServerLoadEvent:" + e.getType());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onResourcesReloaded(ServerResourcesReloadedEvent e) {
        // Fires after /reload — datapacks re-read, function library refreshed
        scheduleRepatch("ServerResourcesReloadedEvent");
    }

    private void scheduleRepatch(String trigger) {
        // 2-tick delay — let library fully reload before we patch
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            try {
                Object craftServer = plugin.getServer();
                Object nmsServer = craftServer.getClass().getMethod("getServer").invoke(craftServer);
                Object functionManager = findField(nmsServer, "functionManager");
                if (functionManager != null) {
                    // Re-init scoreboard reader too (objectives may have changed)
                    session.initScoreboardReader();
                    FunctionLibraryPatcher patcher = new FunctionLibraryPatcher(session, logger);
                    int n = patcher.patchLibrary(functionManager);
                    logger.info("[mdb] Auto-repatch (" + trigger + "): " + n + " functions instrumented.");
                } else {
                    logger.warning("[mdb] Auto-repatch failed: functionManager not found.");
                }
            } catch (Exception ex) {
                logger.warning("[mdb] Auto-repatch error: " + ex.getMessage());
            }
        }, 2L);
    }

    private static Object findField(Object obj, String... names) throws Exception {
        Class<?> clazz = obj.getClass();
        while (clazz != null) {
            for (Field f : clazz.getDeclaredFields()) {
                for (String name : names) {
                    if (f.getName().equals(name) ||
                        f.getType().getSimpleName().toLowerCase().contains("functionmanager")) {
                        f.setAccessible(true);
                        return f.get(obj);
                    }
                }
            }
            clazz = clazz.getSuperclass();
        }
        return null;
    }
}
