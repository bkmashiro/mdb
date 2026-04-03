package dev.mdb;

import java.lang.reflect.Method;
import java.util.Collections;
import java.util.Map;
import java.util.logging.Logger;

/**
 * Wraps one UnboundEntryAction (= one command line in a mcfunction).
 *
 * Before delegating to the original action, notifies DebugSession so it can:
 *   - Check if there's a breakpoint at this line
 *   - Block the MC main thread (CountDownLatch) if needed
 *   - Send a "stopped" event to connected clients
 *
 * This class implements the same interface via duck-typing: it must look like
 * an UnboundEntryAction<T> to the MC execution engine.
 *
 * Since we can't import NMS interfaces directly (no paperweight in this Phase),
 * we use a Proxy approach backed by this class's logic.
 *
 * Actually: because PlainTextFunction stores entries as List<UnboundEntryAction<T>>,
 * and UnboundEntryAction is an interface, we can create a JDK dynamic proxy for it.
 *
 * This class is the InvocationHandler for that proxy.
 */
public class InstrumentedAction implements java.lang.reflect.InvocationHandler {

    private final Object originalAction;
    private final DebugSession session;
    private final String functionId;
    private final int lineNumber;   // 1-indexed
    private final String commandText;

    public InstrumentedAction(Object originalAction, DebugSession session,
                               String functionId, int lineNumber, String commandText) {
        this.originalAction = originalAction;
        this.session = session;
        this.functionId = functionId;
        this.lineNumber = lineNumber;
        this.commandText = commandText;
    }

    /**
     * Creates a proxy that wraps the originalAction.
     * The proxy implements all interfaces of the original (including UnboundEntryAction<T>).
     */
    public static Object createProxy(Object original, DebugSession session,
                                     String functionId, int line, String cmdText) {
        Class<?>[] ifaces = original.getClass().getInterfaces();
        if (ifaces.length == 0) {
            // No interfaces to proxy — return original unchanged
            return original;
        }
        return java.lang.reflect.Proxy.newProxyInstance(
            original.getClass().getClassLoader(),
            ifaces,
            new InstrumentedAction(original, session, functionId, line, cmdText)
        );
    }

    @Override
    public Object invoke(Object proxy, java.lang.reflect.Method method, Object[] args) throws Throwable {
        String name = method.getName();

        // Intercept the "execute" method (UnboundEntryAction.execute)
        if ("execute".equals(name)) {
            session.onBeforeCommand(functionId, lineNumber, commandText, Collections.emptyMap());
            try {
                return method.invoke(originalAction, args);
            } finally {
                session.onAfterCommand(functionId, lineNumber, commandText, Collections.emptyMap());
            }
        }

        // Intercept "bind" — MC 1.21 goes through bind(source) -> EntryAction -> execute
        // We must wrap the returned EntryAction so its execute() is also intercepted
        if ("bind".equals(name)) {
            Object entryAction = method.invoke(originalAction, args);
            if (entryAction == null) return null;
            return wrapEntryAction(entryAction, proxy.getClass().getClassLoader());
        }

        // Default: pass through
        return method.invoke(originalAction, args);
    }

    /**
     * Wraps an EntryAction so its execute() triggers before/after hooks.
     */
    private Object wrapEntryAction(Object entryAction, ClassLoader cl) {
        Class<?>[] ifaces = entryAction.getClass().getInterfaces();
        if (ifaces.length == 0) return entryAction;

        final DebugSession s = session;
        final String fid = functionId;
        final int ln = lineNumber;
        final String cmd = commandText;

        return java.lang.reflect.Proxy.newProxyInstance(
            entryAction.getClass().getClassLoader(),
            ifaces,
            (p, m, a) -> {
                if ("execute".equals(m.getName())) {
                    s.onBeforeCommand(fid, ln, cmd, Collections.emptyMap());
                    try {
                        return m.invoke(entryAction, a);
                    } finally {
                        s.onAfterCommand(fid, ln, cmd, Collections.emptyMap());
                    }
                }
                return m.invoke(entryAction, a);
            }
        );
    }
}
