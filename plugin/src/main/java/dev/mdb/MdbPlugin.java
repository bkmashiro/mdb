package dev.mdb;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;

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

        // Phase 1: Use Bukkit event listener to intercept /function commands
        getServer().getPluginManager().registerEvents(new FunctionEventListener(session), this);
        getLogger().info("[mdb] FunctionEventListener registered.");

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
            default -> sender.sendMessage("[mdb] Unknown subcommand: " + args[0]);
        }
        return true;
    }
}
