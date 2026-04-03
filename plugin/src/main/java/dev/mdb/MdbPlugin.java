package dev.mdb;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import java.lang.reflect.Field;

public class MdbPlugin extends JavaPlugin {

    private DebugSession session;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        String host = getConfig().getString("debug-server.host", "localhost");
        int port = getConfig().getInt("debug-server.port", 2525);
        int timeout = getConfig().getInt("debug-server.breakpoint-timeout-seconds", 30);
        boolean traceAll = getConfig().getBoolean("logging.trace-all", false);

        session = new DebugSession(this, host, port, timeout, traceAll);

        // Register event listeners
        getServer().getPluginManager().registerEvents(new FunctionEventListener(session, getLogger()), this);
        getServer().getPluginManager().registerEvents(new AutoRepatchListener(this, session), this);
        getLogger().info("[mdb] Listeners registered.");

        // Connect to debug server (non-blocking)
        session.connect();

        getLogger().info("[mdb] Plugin enabled. Connecting to " + host + ":" + port);
    }

    @Override
    public void onDisable() {
        if (session != null) {
            session.disconnect();
        }
        getLogger().info("[mdb] Plugin disabled.");
    }

    private Object findField(Object obj, String... names) {
        try {
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
        } catch (Exception ignored) {}
        return null;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("mdb")) return false;

        if (args.length == 0) {
            sender.sendMessage("[mdb] Usage: /mdb <status|connect|disconnect>");
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "status" -> {
                boolean connected = session != null && session.isConnected();
                sender.sendMessage("[mdb] Status: " + (connected ? "§aConnected" : "§cDisconnected"));
            }
            case "connect" -> {
                if (session != null) session.connect();
                sender.sendMessage("[mdb] Attempting to connect...");
            }
            case "disconnect" -> {
                if (session != null) session.disconnect();
                sender.sendMessage("[mdb] Disconnected.");
            }
            case "repatch" -> {
                sender.sendMessage("[mdb] Re-patching function library...");
                getServer().getScheduler().runTask(this, () -> {
                    try {
                        Object craftServer = getServer();
                        Object nmsServer = craftServer.getClass().getMethod("getServer").invoke(craftServer);
                        Object functionManager = findField(nmsServer, "functionManager");
                        if (functionManager != null) {
                            FunctionLibraryPatcher patcher = new FunctionLibraryPatcher(session, getLogger());
                            int n = patcher.patchLibrary(functionManager);
                            sender.sendMessage("[mdb] Patched " + n + " functions.");
                        } else {
                            sender.sendMessage("[mdb] §cCould not find functionManager.");
                        }
                    } catch (Exception e) {
                        sender.sendMessage("[mdb] §cRepatch failed: " + e.getMessage());
                    }
                });
            }
            default -> sender.sendMessage("[mdb] Unknown subcommand: " + args[0] + ". Use: status|connect|disconnect|repatch");
        }
        return true;
    }
}
