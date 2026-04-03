package dev.mdb;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Per-thread call stack for tracking function call chains.
 *
 * MC executes all functions on the main server thread (sequentially),
 * so a single ThreadLocal<Deque> is sufficient.
 *
 * Usage:
 *   - push(functionId) on functionEnter
 *   - pop() on functionExit
 *   - snapshot() to get current stack for "stopped" events
 */
public class CallStack {

    public static class Frame {
        public final String functionId;
        public int currentLine;

        Frame(String functionId) {
            this.functionId = functionId;
            this.currentLine = 0;
        }
    }

    private static final ThreadLocal<Deque<Frame>> STACK =
        ThreadLocal.withInitial(ArrayDeque::new);

    public static void push(String functionId) {
        STACK.get().push(new Frame(functionId));
    }

    public static void pop() {
        Deque<Frame> stack = STACK.get();
        if (!stack.isEmpty()) stack.pop();
    }

    public static void updateCurrentLine(int line) {
        Deque<Frame> stack = STACK.get();
        if (!stack.isEmpty()) stack.peek().currentLine = line;
    }

    /** Returns a snapshot of the stack from top (current) to bottom (root caller). */
    public static List<Frame> snapshot() {
        return new ArrayList<>(STACK.get());
    }

    public static int depth() {
        return STACK.get().size();
    }

    public static void clear() {
        STACK.get().clear();
    }
}
