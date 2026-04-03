package dev.mdb;

import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.Server;

import java.lang.reflect.Field;
import java.util.logging.Logger;

/**
 * Replaces the NMS ServerFunctionManager with our instrumented version.
 *
 * Uses reflection to swap the field on MinecraftServer.
 * This avoids needing a Java agent or bytecode manipulation.
 */
public class FunctionManagerHook {

    private final JavaPlugin plugin;
    private final DebugSession session;
    private final Logger logger;

    public FunctionManagerHook(JavaPlugin plugin, DebugSession session) {
        this.plugin = plugin;
        this.session = session;
        this.logger = plugin.getLogger();
    }

    public boolean install() {
        try {
            // Get the NMS MinecraftServer instance via CraftServer (using reflection to avoid import)
            Object craftServer = Bukkit.getServer();
            Object nmsServer = craftServer.getClass()
                    .getMethod("getServer")
                    .invoke(craftServer);

            // Find the functionManager field (name may vary by MC version/mapping)
            Field functionManagerField = findFunctionManagerField(nmsServer.getClass());
            if (functionManagerField == null) {
                logger.severe("[mdb] Could not find functionManager field on MinecraftServer");
                return false;
            }

            functionManagerField.setAccessible(true);
            Object original = functionManagerField.get(nmsServer);

            logger.info("[mdb] Found functionManager: " + original.getClass().getName());

            // Wrap it with a dynamic proxy
            Object wrapped = MdbFunctionManager.create(original, session, logger);
            functionManagerField.set(nmsServer, wrapped);

            logger.info("[mdb] Replaced functionManager with MdbFunctionManager");
            return true;

        } catch (Exception e) {
            logger.severe("[mdb] Hook installation failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            e.printStackTrace();
            return false;
        }
    }

    private Field findFunctionManagerField(Class<?> clazz) {
        // Try common field names (Mojang mapped name)
        String[] candidateNames = { "functionManager", "f", "functions" };
        for (String name : candidateNames) {
            try {
                Field f = clazz.getDeclaredField(name);
                // Check it looks like a function manager
                if (f.getType().getSimpleName().toLowerCase().contains("function")) {
                    return f;
                }
            } catch (NoSuchFieldException ignored) {}
        }

        // Fallback: scan all fields for one whose type name contains "FunctionManager"
        for (Field f : clazz.getDeclaredFields()) {
            if (f.getType().getSimpleName().contains("FunctionManager") ||
                f.getType().getSimpleName().contains("ServerFunction")) {
                return f;
            }
        }

        // Try superclass
        if (clazz.getSuperclass() != null) {
            return findFunctionManagerField(clazz.getSuperclass());
        }

        return null;
    }
}
