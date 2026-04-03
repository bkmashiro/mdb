package dev.mdb;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.logging.Logger;

/**
 * Wrapper around the real NMS ServerFunctionManager.
 *
 * Since ServerFunctionManager is a concrete class (not an interface), we can't
 * use a JDK dynamic proxy. Instead we:
 *   1. Keep a reference to the original instance
 *   2. Use reflection to call its methods
 *   3. Override the field on MinecraftServer with THIS object (which is the same type,
 *      obtained by creating a thin subclass at runtime using the original's class)
 *
 * For Phase 1 (observation only), we intercept the "execute" method calls by
 * wrapping them via a MethodInterceptor using a simple reflection approach.
 *
 * NOTE: Full per-line interception requires accessing CommandFunction.getEntries()
 * which will be done in Phase 3.
 */
public class MdbFunctionManager {

    private final Object original;
    private final DebugSession session;
    private final Logger logger;

    // Cached reflective handles
    private Method executeMethod;
    private Method getIdMethod;

    public MdbFunctionManager(Object original, DebugSession session, Logger logger) {
        this.original = original;
        this.session = session;
        this.logger = logger;
        cacheReflectionHandles();
    }

    /**
     * Returns a proxy object for the original ServerFunctionManager.
     * We use a cglib-style approach: create a subclass at runtime.
     *
     * Since we don't have cglib, we use a simpler approach:
     * - Intercept calls via the DebugServerFunctionManager subclass
     *   (which IS-A ServerFunctionManager, created dynamically)
     *
     * For now, returns original (Phase 1 just logs on function enter/exit via
     * the execute method interception in FunctionManagerHook).
     */
    public static Object create(Object original, DebugSession session, Logger logger) {
        // Phase 1 note: We can't proxy a class without cglib/ByteBuddy.
        // Instead, FunctionManagerHook will install a command listener that
        // intercepts /function execution at the Bukkit event level.
        // The real per-line interception (Phase 3) will use ByteBuddy or
        // a Fabric-style accessor. For now, log the fact.
        logger.warning("[mdb] Class-based FunctionManager wrapping not yet implemented.");
        logger.warning("[mdb] Using Bukkit event-based interception for Phase 1.");
        return original; // Return original unchanged for now
    }

    private void cacheReflectionHandles() {
        try {
            Class<?> clazz = original.getClass();
            // Find execute(CommandFunction, CommandSourceStack) or similar
            for (Method m : clazz.getMethods()) {
                if (m.getName().equals("execute") && m.getParameterCount() >= 1) {
                    executeMethod = m;
                    break;
                }
            }
        } catch (Exception e) {
            logger.warning("[mdb] Failed to cache reflection handles: " + e.getMessage());
        }
    }

    /**
     * Called to execute a function. Notifies the debug session.
     * This is invoked from the Bukkit event interceptor.
     */
    public void onFunctionExecuted(String functionId) {
        session.onFunctionEnter(functionId);
        // onFunctionExit is called after the original completes
    }
}
