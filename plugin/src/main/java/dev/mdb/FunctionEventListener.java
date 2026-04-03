package dev.mdb;

import org.bukkit.Bukkit;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServerCommandEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.logging.Logger;

/**
 * Intercepts /function commands via Bukkit events.
 *
 * Phase 1: detect function call → notify DebugSession (functionEnter)
 * Phase 3: retrieve the actual PlainTextFunction object → instrument entries
 */
public class FunctionEventListener implements Listener {

    private final DebugSession session;
    private final FunctionInstrumentor instrumentor;
    private final Logger logger;

    // Reflection handles for fetching function objects from the server
    private Object nmsServer;
    private Object functionManager;
    private Method getFunctionMethod;      // ServerFunctionManager.get(ResourceLocation)
    private Class<?> resourceLocationClass;
    private Method resourceLocationOf;
    private boolean nmsReady = false;

    public FunctionEventListener(DebugSession session, Logger logger) {
        this.session = session;
        this.logger = logger;
        this.instrumentor = new FunctionInstrumentor(session, logger);
        initNmsReflection();
    }

    private void initNmsReflection() {
        try {
            Object craftServer = Bukkit.getServer();
            nmsServer = craftServer.getClass().getMethod("getServer").invoke(craftServer);

            // Get functionManager field from MinecraftServer
            functionManager = findAndGetField(nmsServer, "functionManager");
            if (functionManager == null) {
                logger.warning("[mdb] Could not find functionManager on MinecraftServer");
                return;
            }

            // ServerFunctionManager.get(ResourceLocation) -> Optional<CommandFunction>
            for (Method m : functionManager.getClass().getMethods()) {
                if (m.getName().equals("get") && m.getParameterCount() == 1) {
                    getFunctionMethod = m;
                    break;
                }
            }

            // ResourceLocation.parse(String) or new ResourceLocation(String)
            resourceLocationClass = Class.forName("net.minecraft.resources.ResourceLocation",
                true, nmsServer.getClass().getClassLoader());

            // Try ResourceLocation.parse(String) [1.20.3+]
            try {
                resourceLocationOf = resourceLocationClass.getMethod("parse", String.class);
            } catch (NoSuchMethodException e) {
                // Older: ResourceLocation.tryParse or constructor
                try {
                    resourceLocationOf = resourceLocationClass.getMethod("tryParse", String.class);
                } catch (NoSuchMethodException e2) {
                    resourceLocationOf = null; // Will use constructor
                }
            }

            nmsReady = getFunctionMethod != null;
            if (nmsReady) {
                logger.info("[mdb] NMS reflection ready — Phase 3 per-line instrumentation enabled");
            }
        } catch (Exception e) {
            logger.warning("[mdb] NMS reflection init failed: " + e.getMessage() + " — Phase 1 only");
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onServerCommand(ServerCommandEvent e) {
        interceptCommand(e.getCommand());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerCommand(PlayerCommandPreprocessEvent e) {
        String cmd = e.getMessage();
        if (cmd.startsWith("/")) cmd = cmd.substring(1);
        interceptCommand(cmd);
    }

    private void interceptCommand(String command) {
        if (command == null) return;
        command = command.trim();
        if (!command.startsWith("function ")) return;

        String functionId = command.substring("function ".length()).trim();
        // Remove trailing args (macro: "with storage ...")
        int spaceIdx = functionId.indexOf(' ');
        if (spaceIdx > 0) functionId = functionId.substring(0, spaceIdx);

        session.onFunctionEnter(functionId);

        // Phase 3: instrument the function
        if (nmsReady) {
            instrumentFunction(functionId);
        }
    }

    private void instrumentFunction(String functionId) {
        try {
            // Build ResourceLocation
            Object resourceLocation = createResourceLocation(functionId);
            if (resourceLocation == null) return;

            // ServerFunctionManager.get(ResourceLocation) -> Optional<CommandFunction>
            Object optional = getFunctionMethod.invoke(functionManager, resourceLocation);
            if (optional == null) return;

            // Optional.isPresent() / get()
            Method isPresent = optional.getClass().getMethod("isPresent");
            if (!(Boolean) isPresent.invoke(optional)) return;

            Method get = optional.getClass().getMethod("get");
            Object commandFunction = get.invoke(optional);

            // PlainTextFunction also implements InstantiatedFunction,
            // so call instantiate(null, dispatcher) to get InstantiatedFunction
            // OR it IS-A InstantiatedFunction already (PlainTextFunction)
            // Try entries() directly
            Method entriesMethod = null;
            try {
                entriesMethod = commandFunction.getClass().getMethod("entries");
            } catch (NoSuchMethodException e) {
                // Try instantiate first
                Method instantiate = commandFunction.getClass().getMethod("instantiate",
                    Class.forName("net.minecraft.nbt.CompoundTag", true, nmsServer.getClass().getClassLoader()),
                    com.mojang.brigadier.CommandDispatcher.class);
                commandFunction = instantiate.invoke(commandFunction, (Object) null, getDispatcher());
                entriesMethod = commandFunction.getClass().getMethod("entries");
            }

            if (entriesMethod != null) {
                instrumentor.instrument(commandFunction, functionId);
                logger.fine("[mdb] Instrumented: " + functionId);
            }
        } catch (Exception e) {
            logger.warning("[mdb] Could not instrument " + functionId + ": " + e.getMessage());
        }
    }

    private Object createResourceLocation(String id) {
        try {
            if (resourceLocationOf != null) {
                return resourceLocationOf.invoke(null, id);
            } else {
                // Fall back to constructor(String namespace, String path)
                String[] parts = id.split(":", 2);
                if (parts.length == 2) {
                    return resourceLocationClass.getConstructor(String.class, String.class)
                        .newInstance(parts[0], parts[1]);
                }
            }
        } catch (Exception e) {
            logger.warning("[mdb] ResourceLocation creation failed: " + e.getMessage());
        }
        return null;
    }

    private Object getDispatcher() {
        try {
            Method getDispatcher = functionManager.getClass().getMethod("getDispatcher");
            return getDispatcher.invoke(functionManager);
        } catch (Exception e) {
            return null;
        }
    }

    private static Object findAndGetField(Object obj, String... names) throws Exception {
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
