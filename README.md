# mdb — Minecraft Datapack Debugger

> GDB-inspired debugger for Minecraft datapacks.

Set breakpoints, step through mcfunction line by line, and inspect scoreboard variables in real time.

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│   mdb client    │◄──────────────────►│  mdb server      │
│   (CLI)         │                    │  (Node.js)       │
└─────────────────┘                    └────────┬─────────┘
                                                │ WebSocket
                                       ┌────────▼─────────┐
                                       │  Paper Plugin    │
                                       │  (Java)          │
                                       │  hooks into MC   │
                                       └──────────────────┘
```

## Components

- `plugin/` — Paper plugin (Java) that hooks into `ServerFunctionManager`
- `server/` — Debug server (Node.js) that bridges plugin ↔ client
- `client/` — CLI client (TypeScript)

## Usage (planned)

```
mdb attach --host localhost --port 2525
(mdb) break my_pack:combat/on_hit 5
(mdb) continue
(mdb) step
(mdb) print counter
counter = 3  [scoreboard: counter rs]
(mdb) watch health
```

## Status

🚧 Work in progress
