package dev.mdb;

import org.bukkit.Bukkit;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.*;
import java.util.logging.Logger;

/**
 * Reads Minecraft command storage (NBT) and entity/block NBT.
 *
 * MC command storage: `data get storage <namespace:key> <path>`
 * Backed by CommandStorage (NMS) which holds CompoundTag per ResourceLocation.
 *
 * Path syntax (subset of NBT path):
 *   - ""           → entire CompoundTag as JSON-like string
 *   - "foo"        → top-level key "foo"
 *   - "foo.bar"    → nested key
 *   - "list[0]"    → list element (not yet implemented)
 */
public class StorageReader {

    private final Logger logger;
    private Object nmsServer;
    private Object commandStorage;  // net.minecraft.world.level.storage.CommandStorage
    private Method storageGetMethod;       // CommandStorage.get(ResourceLocation)
    private Method storageKeysMethod;      // CommandStorage.keys()
    private Class<?> resourceLocationClass;
    private Method resourceLocationParse;
    private Method compoundTagToStringMethod;
    private boolean ready = false;

    public StorageReader(Logger logger) {
        this.logger = logger;
        init();
    }

    private void init() {
        try {
            Object craftServer = Bukkit.getServer();
            nmsServer = craftServer.getClass().getMethod("getServer").invoke(craftServer);

            // Get commandStorage field
            Field csField = findField(nmsServer.getClass(), "commandStorage");
            if (csField == null) {
                logger.warning("[mdb] StorageReader: commandStorage field not found");
                return;
            }
            csField.setAccessible(true);
            commandStorage = csField.get(nmsServer);
            if (commandStorage == null) {
                logger.warning("[mdb] StorageReader: commandStorage is null (not yet initialized?)");
                return;
            }

            // CommandStorage.get(ResourceLocation) -> CompoundTag
            storageGetMethod = commandStorage.getClass().getMethod("get",
                Class.forName("net.minecraft.resources.ResourceLocation", true,
                    nmsServer.getClass().getClassLoader()));

            // CommandStorage.keys() -> Stream<ResourceLocation>
            storageKeysMethod = commandStorage.getClass().getMethod("keys");

            // ResourceLocation.parse(String)
            resourceLocationClass = Class.forName("net.minecraft.resources.ResourceLocation",
                true, nmsServer.getClass().getClassLoader());
            try {
                resourceLocationParse = resourceLocationClass.getMethod("parse", String.class);
            } catch (NoSuchMethodException e) {
                resourceLocationParse = resourceLocationClass.getMethod("tryParse", String.class);
            }

            // CompoundTag.toString() gives SNBT representation
            ready = true;
            logger.info("[mdb] StorageReader ready.");
        } catch (Exception e) {
            logger.warning("[mdb] StorageReader init failed: " + e.getMessage());
        }
    }

    /**
     * Read storage at namespace:key, optionally navigating to a subpath.
     *
     * @param storageId  e.g. "my_pack:data"
     * @param path       e.g. "player.health" or "" for root
     * @return StorageResult with value or error
     */
    public StorageResult read(String storageId, String path) {
        if (!ready || commandStorage == null) {
            // Try lazy init
            init();
            if (!ready) return StorageResult.error("StorageReader not ready");
        }

        try {
            Object resourceLocation = resourceLocationParse.invoke(null, storageId);
            Object compoundTag = storageGetMethod.invoke(commandStorage, resourceLocation);

            if (compoundTag == null) {
                return StorageResult.error("Storage '" + storageId + "' is empty or not found");
            }

            if (path == null || path.isEmpty()) {
                return StorageResult.ok(nbtToString(compoundTag));
            }

            // Navigate path
            Object value = navigatePath(compoundTag, path);
            if (value == null) {
                return StorageResult.error("Path '" + path + "' not found in '" + storageId + "'");
            }
            return StorageResult.ok(nbtToString(value));

        } catch (Exception e) {
            return StorageResult.error(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /**
     * List all storage keys (ResourceLocations).
     */
    @SuppressWarnings("unchecked")
    public List<String> listKeys() {
        if (!ready) return Collections.singletonList("(StorageReader not ready)");
        try {
            Object stream = storageKeysMethod.invoke(commandStorage);
            // Convert Stream<ResourceLocation> to List<String>
            Method toList = stream.getClass().getMethod("toList");
            List<Object> locations;
            locations = (List<Object>) toList.invoke(stream);
            List<String> result = new ArrayList<>();
            for (Object loc : locations) {
                result.add(loc.toString());
            }
            result.sort(String::compareTo);
            return result;
        } catch (Exception e) {
            logger.warning("[mdb] listKeys failed: " + e.getMessage());
            return Collections.emptyList();
        }
    }

    // ── NBT path navigation ───────────────────────────────────────────────────

    /**
     * Navigate a dot-separated path through CompoundTag/ListTag.
     * e.g. "player.health" → tag.get("player").get("health")
     */
    private Object navigatePath(Object tag, String path) {
        String[] parts = path.split("\\.", 2);
        String key = parts[0];

        // Handle list index: "items[0]"
        int bracketIdx = key.indexOf('[');
        int listIndex = -1;
        if (bracketIdx >= 0) {
            try {
                listIndex = Integer.parseInt(key.substring(bracketIdx + 1, key.length() - 1));
                key = key.substring(0, bracketIdx);
            } catch (NumberFormatException ignored) {}
        }

        Object child = getTagValue(tag, key);
        if (child == null) return null;

        if (listIndex >= 0) {
            child = getListElement(child, listIndex);
            if (child == null) return null;
        }

        if (parts.length == 1) return child;
        return navigatePath(child, parts[1]);
    }

    private Object getTagValue(Object tag, String key) {
        try {
            // CompoundTag.get(String) -> Tag
            Method get = tag.getClass().getMethod("get", String.class);
            return get.invoke(tag, key);
        } catch (Exception e) {
            try {
                // Try getCompound, getInt, getString etc. as fallback
                Method get = tag.getClass().getMethod("get", String.class);
                return get.invoke(tag, key);
            } catch (Exception ex) {
                return null;
            }
        }
    }

    private Object getListElement(Object listTag, int index) {
        try {
            Method get = listTag.getClass().getMethod("get", int.class);
            return get.invoke(listTag, index);
        } catch (Exception e) {
            return null;
        }
    }

    private String nbtToString(Object tag) {
        if (tag == null) return "null";
        try {
            // CompoundTag/ListTag toString() gives SNBT
            return tag.toString();
        } catch (Exception e) {
            return tag.getClass().getSimpleName() + "(" + e.getMessage() + ")";
        }
    }

    private static Field findField(Class<?> clazz, String name) {
        if (clazz == null) return null;
        for (Field f : clazz.getDeclaredFields()) {
            if (f.getName().equals(name)) return f;
        }
        return findField(clazz.getSuperclass(), name);
    }

    // ── Result type ───────────────────────────────────────────────────────────

    public static class StorageResult {
        public final boolean ok;
        public final String value;
        public final String error;

        private StorageResult(boolean ok, String value, String error) {
            this.ok = ok; this.value = value; this.error = error;
        }

        public static StorageResult ok(String value) { return new StorageResult(true, value, null); }
        public static StorageResult error(String msg) { return new StorageResult(false, null, msg); }
    }
}
