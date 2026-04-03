# mdb — Minecraft Datapack Debugger

> GDB-inspired debugger for Minecraft mcfunction files. Set breakpoints, step through commands, inspect scoreboards and NBT storage — all while the game is running.

## Features

| Feature | Status |
|---|---|
| Per-line breakpoints | ✅ |
| Step execution (single command) | ✅ |
| MC tick freeze on pause | ✅ |
| Call stack (`bt`) | ✅ |
| Scoreboard read (`print`) | ✅ |
| Watchpoints (break on value change) | ✅ |
| NBT storage read | ✅ |
| Web UI | ✅ |
| CLI REPL | ✅ |
| Auto-repatch after `/reload` | ✅ |
| Plugin reconnect (bp/watch restore) | ✅ |

## Architecture

```
Paper Plugin (Java)
  └── instruments 8000+ mcfunction commands at startup
  └── WebSocket → Debug Server (Node.js, port 2525)
                     └── WebSocket → CLI Client    (port 2526)
                     └── WebSocket → Web UI client (port 2526)
                     └── HTTP      → Web UI static (port 2527)
```

## Quick Start

### 1. Debug Server

```bash
cd server
npm install && npm run build
node dist/index.js
# Plugin WS:  ws://localhost:2525/plugin
# Client WS:  ws://localhost:2526/client
# Web UI:     http://localhost:2527
```

### 2. Paper Plugin

Build and deploy:
```bash
cd plugin
./gradlew shadowJar
cp build/libs/mdb-plugin-0.1.0-SNAPSHOT.jar /path/to/server/plugins/
```

Requires **Paper 1.21.4** + **Java 21**.

### 3. Web UI or CLI

**Web UI** (recommended): open `http://localhost:2527` after starting the server.

**CLI**:
```bash
cd client
npm install && npm run build
node dist/index.js
```

## CLI Commands

```
break <fn> <line>         Set breakpoint     break my_pack:combat/tick 5
clear <fn> <line>         Clear breakpoint
clearall                  Clear all breakpoints
continue / c              Resume execution
step / s                  Step one command
bt                        Print call stack
print <obj> [entry]       Read scoreboard    print stats $kills
watch <obj> <entry>       Watch value        watch stats $kills
unwatch <obj> <entry>     Remove watch
storage <id> [path]       Read NBT storage   storage my_pack:data player.health
storage list              List storage namespaces
objectives                List scoreboard objectives
quit / q                  Exit
```

## In-game Commands

```
/mdb status               Show connection status
/mdb connect              Reconnect to debug server
/mdb disconnect           Disconnect
/mdb repatch              Re-instrument function library
```

## Config (`plugins/mdb/config.yml`)

```yaml
debug-server:
  host: localhost
  port: 2525
  breakpoint-timeout-seconds: 30  # auto-resume safety timeout

logging:
  trace-all: false  # log every command (verbose)
```

## How It Works

On enable, mdb uses reflection to:
1. Access `MinecraftServer.functionManager.library.functions` (the `ImmutableMap` of all loaded mcfunctions)
2. Replace it with a `HashMap` where each `CommandFunction` is wrapped in a JDK dynamic proxy
3. The proxy intercepts `instantiate()` → wraps each `UnboundEntryAction` (one per command line)
4. Before each command executes: `DebugSession.onBeforeCommand()` checks breakpoints/step mode
5. If paused: `CountDownLatch.await()` blocks the MC main thread (tick freeze)
6. Client sends `continue` or `step` → `latch.countDown()` resumes

After `/reload`, `ServerResourcesReloadedEvent` triggers automatic re-instrumentation.

## Requirements

- Paper 1.21.4 (NMS-dependent, other versions may need adjustment)
- Java 21
- Node.js 20+

## License

MIT
