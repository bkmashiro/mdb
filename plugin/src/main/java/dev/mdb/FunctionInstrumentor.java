package dev.mdb;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import sun.misc.Unsafe;

/**
 * Phase 3: Per-line instrumentation of mcfunction execution.
 *
 * When a PlainTextFunction (or InstantiatedFunction) is about to be executed,
 * we replace its entries() list with InstrumentedAction wrappers.
 *
 * Each InstrumentedAction wraps one UnboundEntryAction (= one command line),
 * calls DebugSession.onBeforeCommand() before executing, and
 * DebugSession.onAfterCommand() after.
 *
 * Called from FunctionEventListener after we detect a /function command.
 */
public class FunctionInstrumentor {

    private final DebugSession session;
    private final Logger logger;

    // Reflection handles — cached after first use
    private Field entriesField;
    private long entriesFieldOffset = -1;
    private Field commandInputField;
    private boolean reflectionReady = false;
    private static final Unsafe UNSAFE = getUnsafe();

    private static Unsafe getUnsafe() {
        try {
            Field f = Unsafe.class.getDeclaredField("theUnsafe");
            f.setAccessible(true);
            return (Unsafe) f.get(null);
        } catch (Exception e) {
            return null;
        }
    }

    public FunctionInstrumentor(DebugSession session, Logger logger) {
        this.session = session;
        this.logger = logger;
    }

    /**
     * Instruments a PlainTextFunction or InstantiatedFunction object.
     * Replaces its entries list with InstrumentedAction wrappers.
     *
     * @param functionObj the net.minecraft.commands.functions.PlainTextFunction instance
     * @param functionId  the namespaced function id (e.g. "my_pack:combat/tick")
     */
    @SuppressWarnings("unchecked")
    public void instrument(Object functionObj, String functionId) {
        try {
            ensureReflectionReady(functionObj);
            if (!reflectionReady) return;

            List<Object> originalEntries = (List<Object>) entriesField.get(functionObj);
            List<Object> instrumented = new ArrayList<>(originalEntries.size());

            for (int i = 0; i < originalEntries.size(); i++) {
                Object entry = originalEntries.get(i);
                String cmdText = extractCommandText(entry);
                instrumented.add(InstrumentedAction.createProxy(entry, session, functionId, i + 1, cmdText));
            }

            // Replace the entries field (it's a final field in a record — needs setAccessible)
            // Use Unsafe to bypass final field restriction (Java record)
            if (UNSAFE != null && entriesFieldOffset >= 0) {
                UNSAFE.putObject(functionObj, entriesFieldOffset, instrumented);
            } else {
                try {
                    entriesField.set(functionObj, instrumented);
                } catch (IllegalAccessException e) {
                    logger.warning("[mdb] Could not replace entries field (final?): " + e.getMessage());
                }
            }

        } catch (Exception e) {
            logger.warning("[mdb] Instrumentation failed for " + functionId + ": " + e.getMessage());
        }
    }

    /**
     * Extract the raw command string from an UnboundEntryAction (typically ExecuteCommand).
     */
    String extractCommandText(Object entryAction) {
        if (entryAction == null) return "<null>";

        // Try "commandInput" field (ExecuteCommand)
        try {
            if (commandInputField == null) {
                commandInputField = findField(entryAction.getClass(), "commandInput");
                if (commandInputField != null) commandInputField.setAccessible(true);
            }
            if (commandInputField != null) {
                Object val = commandInputField.get(entryAction);
                return val != null ? val.toString() : "<empty>";
            }
        } catch (Exception e) {
            // Fall through
        }

        // Fallback: toString()
        String s = entryAction.toString();
        return s.length() > 100 ? s.substring(0, 100) + "..." : s;
    }

    private void ensureReflectionReady(Object functionObj) {
        if (reflectionReady) return;
        try {
            Class<?> clazz = functionObj.getClass();
            entriesField = findField(clazz, "entries");
            if (entriesField != null) {
                entriesField.setAccessible(true);
                if (UNSAFE != null) {
                    entriesFieldOffset = UNSAFE.objectFieldOffset(entriesField);
                }
                reflectionReady = true;
                logger.info("[mdb] Reflection ready for " + clazz.getSimpleName() + ".entries (Unsafe offset: " + entriesFieldOffset + ")");
            } else {
                logger.warning("[mdb] Could not find 'entries' field on " + clazz.getName());
            }
        } catch (Exception e) {
            logger.warning("[mdb] Reflection setup failed: " + e.getMessage());
        }
    }

    private static Field findField(Class<?> clazz, String name) {
        if (clazz == null) return null;
        try {
            return clazz.getDeclaredField(name);
        } catch (NoSuchFieldException e) {
            return findField(clazz.getSuperclass(), name);
        }
    }
}
