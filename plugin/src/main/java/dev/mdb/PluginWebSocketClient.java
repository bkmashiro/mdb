package dev.mdb;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.util.logging.Logger;

public class PluginWebSocketClient extends WebSocketClient {

    private final DebugSession session;
    private final Logger logger;

    public PluginWebSocketClient(URI uri, DebugSession session, Logger logger) {
        super(uri);
        this.session = session;
        this.logger = logger;
    }

    @Override
    public void onOpen(ServerHandshake handshake) {
        logger.info("[mdb] Connected to debug server.");
    }

    @Override
    public void onMessage(String message) {
        session.handleServerMessage(message);
    }

    @Override
    public void onClose(int code, String reason, boolean remote) {
        logger.warning("[mdb] Disconnected from debug server (code=" + code + ", reason=" + reason + ")");
    }

    @Override
    public void onError(Exception ex) {
        logger.warning("[mdb] WebSocket error: " + ex.getMessage());
    }
}
