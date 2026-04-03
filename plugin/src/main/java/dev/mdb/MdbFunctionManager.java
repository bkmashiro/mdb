package dev.mdb;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Logger;

/**
 * Dynamic proxy wrapper around the real ServerFunctionManager.
 *
 * We use a dynamic proxy here because ServerFunctionManager is not final,
 * but creating a subclass would require knowing the exact NMS class hierarchy.
 * A proxy lets us intercept calls generically.
 *
 * The key methods to intercept:
 *   - execute(CommandFunction, CommandSourceStack) — whole function execution
 *
 * For per-line interception, we need to instrument at the CommandFunction.Entry
 * level, which requires additional work (see MdbFunctionExecutor).
 */
public class MdbFunctionManager implements InvocationHandler {

    private final Object original;
    private final DebugSession session;
    private final Logger logger;

    private MdbFunctionManager(Object original, DebugSession session, Logger logger) {
        this.original = original;
        this.session = session;
        this.logger = logger;
    }

    /**
     * Creates a proxy that wraps the original function manager.
     * The proxy implements all interfaces that the original implements.
     */
    public static Object create(Object original, DebugSession session, Logger logger) {
        Class<?>[] interfaces = original.getClass().getInterfaces();
        if (interfaces.length == 0) {
            // Not an interface-based manager — fall back to subclass approach
            logger.warning("[mdb] FunctionManager does not implement interfaces; proxy not possible.");
            return original;
        }

        return Proxy.newProxyInstance(
            original.getClass().getClassLoader(),
            interfaces,
            new MdbFunctionManager(original, session, logger)
        );
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        String methodName = method.getName();

        // Intercept the execute method
        if (methodName.equals("execute") && args != null && args.length >= 1) {
            return interceptExecute(method, args);
        }

        // Pass everything else through
        return method.invoke(original, args);
    }

    private Object interceptExecute(Method method, Object[] args) throws Throwable {
        // args[0] is CommandFunction (or ResourceLocation ID depending on overload)
        // Extract function ID for logging
        String functionId = extractFunctionId(args[0]);

        session.onFunctionEnter(functionId);

        try {
            // TODO: Phase 3 — instrument per-line execution here
            // For now, just delegate to the original and report enter/exit
            Object result = method.invoke(original, args);
            return result;
        } finally {
            session.onFunctionExit(functionId);
        }
    }

    private String extractFunctionId(Object arg) {
        if (arg == null) return "<unknown>";
        try {
            // Try getId() which returns ResourceLocation
            Method getId = arg.getClass().getMethod("getId");
            Object loc = getId.invoke(arg);
            return loc != null ? loc.toString() : arg.toString();
        } catch (Exception e) {
            // Try toString
            return arg.toString();
        }
    }
}
