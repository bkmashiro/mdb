package dev.mdb;

import org.bukkit.plugin.java.JavaPlugin;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Logger;

public class PluginWebSocketClient extends WebSocketClient {

    private final DebugSession session;
    private final JavaPlugin plugin;
    private final Logger logger;
    /** Set to true when user explicitly calls disconnect() — stops auto-reconnect. */
    private final AtomicBoolean intentionalClose = new AtomicBoolean(false);
    private static final int RECONNECT_DELAY_TICKS = 100; // 5s @ 20 TPS

    public PluginWebSocketClient(URI uri, DebugSession session, JavaPlugin plugin, Logger logger) {
        super(uri);
        this.session = session;
        this.plugin = plugin;
        this.logger = logger;
    }

    public void closeIntentionally() {
        intentionalClose.set(true);
        try { closeBlocking(); } catch (Exception ignored) {}
    }

    @Override
    public void onOpen(ServerHandshake handshake) {
        intentionalClose.set(false);
        logger.info("[mdb] Connected to debug server.");
    }

    @Override
    public void onMessage(String message) {
        session.handleServerMessage(message);
    }

    @Override
    public void onClose(int code, String reason, boolean remote) {
        logger.warning("[mdb] Disconnected from debug server (code=" + code + ", reason=" + reason + ")");
        if (!intentionalClose.get()) {
            scheduleReconnect();
        }
    }

    @Override
    public void onError(Exception ex) {
        // Don't spam on connection refused — reconnect loop handles it
        if (ex.getMessage() != null && !ex.getMessage().contains("Connection refused")) {
            logger.warning("[mdb] WebSocket error: " + ex.getMessage());
        }
    }

    private void scheduleReconnect() {
        if (plugin.isEnabled()) {
            plugin.getServer().getScheduler().runTaskLaterAsynchronously(plugin, () -> {
                if (!isOpen() && !intentionalClose.get()) {
                    logger.info("[mdb] Attempting to reconnect...");
                    try { reconnect(); }
                    catch (Exception e) {
                        logger.warning("[mdb] Reconnect failed: " + e.getMessage());
                        scheduleReconnect(); // keep trying
                    }
                }
            }, RECONNECT_DELAY_TICKS);
        }
    }
}
