package dev.mdb;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;

/**
 * Patches the ServerFunctionLibrary's functions map so every CommandFunction
 * is replaced with an instrumented proxy.
 *
 * The proxy wraps CommandFunction<T>:
 *   - id() → pass-through
 *   - instantiate(...) → call original, then wrap the result's entries with InstrumentedAction
 *
 * The instrumented InstantiatedFunction returns a new list where each entry is
 * a InstrumentedAction proxy that notifies DebugSession before/after execution.
 *
 * Called once after server load.
 */
public class FunctionLibraryPatcher {

    private final DebugSession session;
    private final Logger logger;

    public FunctionLibraryPatcher(DebugSession session, Logger logger) {
        this.session = session;
        this.logger = logger;
    }

    @SuppressWarnings("unchecked")
    public int patchLibrary(Object functionManager) {
        try {
            // Get the library field from ServerFunctionManager
            Field libraryField = findField(functionManager.getClass(), "library");
            if (libraryField == null) {
                logger.warning("[mdb] Could not find 'library' field on ServerFunctionManager");
                return 0;
            }
            libraryField.setAccessible(true);
            Object library = libraryField.get(functionManager);
            if (library == null) {
                logger.warning("[mdb] ServerFunctionLibrary is null");
                return 0;
            }

            // Get the functions map
            Field functionsField = findField(library.getClass(), "functions");
            if (functionsField == null) {
                logger.warning("[mdb] Could not find 'functions' field on ServerFunctionLibrary");
                return 0;
            }
            functionsField.setAccessible(true);
            Map<Object, Object> functions = (Map<Object, Object>) functionsField.get(library);
            if (functions == null) {
                logger.warning("[mdb] functions map is null");
                return 0;
            }

            // Build a new mutable map with wrapped functions
            java.util.HashMap<Object, Object> newMap = new java.util.HashMap<>(functions.size());
            int patched = 0;
            for (Map.Entry<Object, Object> entry : functions.entrySet()) {
                Object resourceLocation = entry.getKey();
                Object commandFunction = entry.getValue();
                String functionId = resourceLocation.toString();

                if (!isAlreadyPatched(commandFunction)) {
                    Object wrapped = wrapCommandFunction(commandFunction, functionId);
                    newMap.put(resourceLocation, wrapped);
                    patched++;
                } else {
                    newMap.put(resourceLocation, commandFunction);
                }
            }

            // Replace the immutable map with our mutable patched map
            functionsField.set(library, newMap);

            logger.info("[mdb] Patched " + patched + " functions in library.");
            return patched;

        } catch (Exception e) {
            logger.warning("[mdb] Library patching failed: " + e.getMessage());
            e.printStackTrace();
            return 0;
        }
    }

    /**
     * Creates a proxy that wraps a CommandFunction<T>.
     * intercepts instantiate() to return an instrumented InstantiatedFunction.
     */
    private Object wrapCommandFunction(Object original, String functionId) {
        Class<?>[] ifaces = collectInterfaces(original.getClass());
        if (ifaces.length == 0) return original;

        return Proxy.newProxyInstance(
            original.getClass().getClassLoader(),
            ifaces,
            (proxy, method, args) -> {
                String name = method.getName();

                if ("instantiate".equals(name)) {
                    // Call original instantiate
                    Object instantiated = method.invoke(original, args);
                    // Wrap the resulting InstantiatedFunction
                    return wrapInstantiatedFunction(instantiated, functionId);
                }

                // id(), toString(), etc. — pass through
                return method.invoke(original, args);
            }
        );
    }

    /**
     * Wraps an InstantiatedFunction to inject per-line hooks.
     * Returns a proxy that overrides entries() to return instrumented actions.
     */
    @SuppressWarnings("unchecked")
    private Object wrapInstantiatedFunction(Object instantiated, String functionId) {
        if (instantiated == null) return null;

        try {
            Method entriesMethod = instantiated.getClass().getMethod("entries");
            List<Object> originalEntries = (List<Object>) entriesMethod.invoke(instantiated);

            List<Object> instrumentedEntries = new ArrayList<>(originalEntries.size());
            for (int i = 0; i < originalEntries.size(); i++) {
                Object entry = originalEntries.get(i);
                String cmdText = extractCommandText(entry);
                Object wrapped = InstrumentedAction.createProxy(entry, session, functionId, i + 1, cmdText);
                instrumentedEntries.add(wrapped);
            }

            // Create proxy for InstantiatedFunction that returns our list from entries()
            Class<?>[] ifaces = collectInterfaces(instantiated.getClass());
            if (ifaces.length == 0) return instantiated;

            final List<Object> finalEntries = instrumentedEntries;
            return Proxy.newProxyInstance(
                instantiated.getClass().getClassLoader(),
                ifaces,
                (proxy, method, args) -> {
                    if ("entries".equals(method.getName())) {
                        return finalEntries;
                    }
                    return method.invoke(instantiated, args);
                }
            );
        } catch (Exception e) {
            logger.warning("[mdb] wrapInstantiatedFunction failed for " + functionId + ": " + e.getMessage());
            return instantiated;
        }
    }

    private String extractCommandText(Object entry) {
        if (entry == null) return "<null>";
        try {
            Field f = findField(entry.getClass(), "commandInput");
            if (f != null) { f.setAccessible(true); Object v = f.get(entry); return v != null ? v.toString() : ""; }
        } catch (Exception ignored) {}
        String s = entry.toString();
        return s.length() > 120 ? s.substring(0, 120) : s;
    }

    private boolean isAlreadyPatched(Object obj) {
        return obj != null && Proxy.isProxyClass(obj.getClass());
    }

    private Class<?>[] collectInterfaces(Class<?> clazz) {
        java.util.Set<Class<?>> ifaces = new java.util.LinkedHashSet<>();
        for (Class<?> c = clazz; c != null; c = c.getSuperclass()) {
            for (Class<?> i : c.getInterfaces()) {
                ifaces.add(i);
            }
        }
        return ifaces.toArray(new Class[0]);
    }

    private static Field findField(Class<?> clazz, String name) {
        if (clazz == null) return null;
        for (Field f : clazz.getDeclaredFields()) {
            if (f.getName().equals(name)) return f;
        }
        return findField(clazz.getSuperclass(), name);
    }
}
