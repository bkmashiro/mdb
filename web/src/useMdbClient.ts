import { useCallback, useEffect, useRef, useState } from 'react'

export interface StackFrame {
  function: string
  line: number
}

export interface Location {
  function: string
  line: number
  command: string
}

export interface Breakpoint {
  function: string
  line: number
}

export interface Watch {
  objective: string
  entry: string
}

export interface WatchHit {
  watch: string
  objective: string
  entry: string
  oldValue: number | null
  newValue: number | null
  location: Location
}

export interface ScoreEntry {
  entry: string
  value: number
}

export interface DebugState {
  connected: boolean
  pluginConnected: boolean
  paused: boolean
  reason: string | null
  location: Location | null
  stack: StackFrame[]
  breakpoints: Breakpoint[]
  watches: Watch[]
  eventLog: string[]
  // source viewer
  sourceFunction: string | null
  sourceLines: string[]
  // scoreboard
  scoreboardData: Record<string, ScoreEntry[]>  // objective -> entries
  // storage
  lastStorageId: string | null
  lastStorageValue: string | null
}

const MAX_LOG = 200

export function useMdbClient(wsUrl: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const [state, setState] = useState<DebugState>({
    connected: false,
    pluginConnected: false,
    paused: false,
    reason: null,
    location: null,
    stack: [],
    breakpoints: [],
    watches: [],
    eventLog: [],
    sourceFunction: null,
    sourceLines: [],
    scoreboardData: {},
    lastStorageId: null,
    lastStorageValue: null,
  })

  const log = useCallback((msg: string) => {
    setState(s => ({
      ...s,
      eventLog: [...s.eventLog.slice(-(MAX_LOG - 1)), `${new Date().toLocaleTimeString()} ${msg}`],
    }))
  }, [])

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  useEffect(() => {
    let ws: WebSocket
    let reconnectTimer: number

    const connect = () => {
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setState(s => ({ ...s, connected: true }))
        log('Connected to debug server')
      }

      ws.onclose = () => {
        setState(s => ({ ...s, connected: false, pluginConnected: false }))
        wsRef.current = null
        log('Disconnected — reconnecting in 3s...')
        reconnectTimer = window.setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        log('WebSocket error')
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          handleMessage(msg)
        } catch {
          log(`[raw] ${e.data}`)
        }
      }
    }

    const handleMessage = (msg: any) => {
      switch (msg.type) {
        case 'hello':
          setState(s => ({
            ...s,
            pluginConnected: msg.pluginConnected,
            breakpoints: msg.breakpoints ?? [],
            watches: msg.watches ?? [],
          }))
          log(`Plugin: ${msg.pluginConnected ? '✓ connected' : '✗ not connected'}`)
          break

        case 'pluginDisconnected':
          setState(s => ({ ...s, pluginConnected: false }))
          log('⚠ Plugin disconnected')
          break

        case 'functionEnter':
          log(`>> ${msg.function}`)
          break

        case 'functionExit':
          log(`<< ${msg.function}`)
          break

        case 'stopped':
          setState(s => ({
            ...s,
            paused: true,
            reason: msg.reason,
            location: msg.location,
            stack: msg.stack ?? [],
            // If source is attached, update source viewer
            sourceFunction: msg.source ? msg.location.function : s.sourceFunction,
            sourceLines: msg.source ?? s.sourceLines,
          }))
          log(`⏸ ${msg.reason} at ${msg.location.function}:${msg.location.line} — ${msg.location.command}`)
          break

        case 'source':
          if (!msg.error) {
            setState(s => ({ ...s, sourceFunction: msg.function, sourceLines: msg.lines ?? [] }))
          } else {
            log(`source error: ${msg.error}`)
          }
          break

        case 'watchHit':
          log(`⚡ watch ${msg.watch}: ${msg.oldValue} → ${msg.newValue}`)
          break

        case 'printResult':
          if (msg.error) {
            log(`print error: ${msg.error}`)
          } else if (msg.entry !== undefined) {
            log(`${msg.objective}[${msg.entry}] = ${msg.value ?? '(unset)'}`)
            // Update scoreboard panel
            setState(s => {
              const prev = s.scoreboardData[msg.objective] ?? []
              const filtered = prev.filter(e => e.entry !== msg.entry)
              const next = msg.value != null
                ? [...filtered, { entry: msg.entry, value: msg.value }]
                : filtered
              next.sort((a, b) => a.entry.localeCompare(b.entry))
              return { ...s, scoreboardData: { ...s.scoreboardData, [msg.objective]: next } }
            })
          } else {
            // Full objective dump
            const entries: ScoreEntry[] = Object.entries(msg.scores ?? {})
              .map(([entry, value]) => ({ entry, value: value as number }))
            entries.sort((a, b) => a.entry.localeCompare(b.entry))
            log(`${msg.objective}: ${entries.length} entries`)
            setState(s => ({ ...s, scoreboardData: { ...s.scoreboardData, [msg.objective]: entries } }))
          }
          break

        case 'storageResult':
          if (msg.error) {
            log(`storage error: ${msg.error}`)
          } else {
            log(`storage ${msg.id}${msg.path ? '.' + msg.path : ''}: loaded`)
            setState(s => ({ ...s, lastStorageId: msg.id, lastStorageValue: msg.value ?? null }))
          }
          break

        case 'storageList':
          log(`storage keys: ${(msg.keys ?? []).join(', ') || '(empty)'}`)
          break

        case 'commandAck':
          log(`▶ /${msg.command}`)
          break

        case 'objectives':
          log(`objectives: ${(msg.objectives ?? []).join(', ')}`)
          break

        default:
          log(`[event:${msg.type}] ${JSON.stringify(msg).slice(0, 80)}`)
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [wsUrl, log])

  const actions = {
    continue: () => { send({ type: 'continue' }); setState(s => ({ ...s, paused: false })) },
    step: () => { send({ type: 'step' }); setState(s => ({ ...s, paused: false })) },
    setBreakpoint: (fn: string, line: number) => {
      send({ type: 'setBreakpoint', function: fn, line })
      setState(s => ({
        ...s,
        breakpoints: [...s.breakpoints.filter(b => !(b.function === fn && b.line === line)),
                      { function: fn, line }]
      }))
    },
    clearBreakpoint: (fn: string, line: number) => {
      send({ type: 'clearBreakpoint', function: fn, line })
      setState(s => ({
        ...s,
        breakpoints: s.breakpoints.filter(b => !(b.function === fn && b.line === line))
      }))
    },
    clearAllBreakpoints: () => { send({ type: 'clearAllBreakpoints' }); setState(s => ({ ...s, breakpoints: [] })) },
    print: (objective: string, entry?: string) => {
      const msg: any = { type: 'print', objective }
      if (entry) msg.entry = entry
      send(msg)
    },
    watch: (objective: string, entry: string) => {
      send({ type: 'watch', objective, entry })
      setState(s => ({
        ...s,
        watches: [...s.watches.filter(w => !(w.objective === objective && w.entry === entry)),
                  { objective, entry }]
      }))
    },
    unwatch: (objective: string, entry: string) => {
      send({ type: 'unwatch', objective, entry })
      setState(s => ({
        ...s,
        watches: s.watches.filter(w => !(w.objective === objective && w.entry === entry))
      }))
    },
    storage: (id: string, path?: string) => send({ type: 'storage', id, path: path ?? '' }),
    listStorage: () => send({ type: 'listStorage' }),
    listObjectives: () => send({ type: 'listObjectives' }),
    getSource: (fn: string) => send({ type: 'getSource', function: fn }),
    runCommand: (command: string) => send({ type: 'runCommand', command }),
    raw: send,
  }

  return { state, actions }
}
