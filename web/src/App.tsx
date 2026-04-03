import { useState, useRef, useEffect, useCallback } from 'react'
import { useMdbClient } from './useMdbClient'
import type { ScoreEntry } from './useMdbClient'
import { FileExplorer } from './FileExplorer'

const WS_URL = `ws://${window.location.hostname}:2526/client`

const C = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  green: '#3fb950',
  red: '#f85149',
  yellow: '#d29922',
  blue: '#58a6ff',
  purple: '#bc8cff',
  orange: '#ffa657',
  cyan: '#39d353',
  currentLine: 'rgba(255,214,0,0.12)',
  bpLine: 'rgba(248,81,73,0.15)',
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  app: { background: C.bg, minHeight: '100vh', color: C.text, fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 12, display: 'grid', gridTemplateRows: 'auto 1fr', gap: 0, overflow: 'hidden', height: '100vh' },
  header: { background: C.panel, borderBottom: `1px solid ${C.border}`, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 12 },
  body: { display: 'grid', gridTemplateColumns: '1fr 1fr 260px', gridTemplateRows: '1fr 1fr', height: 'calc(100vh - 37px)', overflow: 'hidden', gap: 1, background: C.border },
  cell: { background: C.bg, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  panelHeader: { padding: '5px 10px', background: C.panel, borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  panelBody: { flex: 1, overflow: 'auto', padding: 10 },
  badge: (ok: boolean) => ({ background: ok ? '#1a2d1a' : '#2d1a1a', border: `1px solid ${ok ? C.green : C.red}`, borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 700, color: ok ? C.green : C.red }),
  btn: (color = C.blue, small = false) => ({ background: color + '22', border: `1px solid ${color}`, borderRadius: 3, color, padding: small ? '2px 8px' : '3px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600 }),
  input: { background: '#010409', border: `1px solid ${C.border}`, borderRadius: 3, color: C.text, padding: '3px 7px', fontFamily: 'inherit', fontSize: 11, outline: 'none', width: '100%' },
  tag: (c: string) => ({ color: c }),
}

// ── Main App ──────────────────────────────────────────────────────────────────

export function App() {
  const { state, actions } = useMdbClient(WS_URL)
  const logRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'debug' | 'explorer'>('explorer')

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [state.eventLog])

  useEffect(() => {
    if (state.paused && state.pluginConnected) {
      actions.listObjectives()
      // Switch to debug tab when paused
      setTab('debug')
    }
  }, [state.paused])

  return (
    <div style={s.app}>
      <Header state={state} actions={actions} tab={tab} setTab={setTab} />
      {/* Keep both panels mounted — toggle visibility to preserve state */}
      <div style={{ flex: 1, overflow: 'hidden', display: tab === 'explorer' ? 'flex' : 'none', flexDirection: 'column' }}>
        <FileExplorer
          breakpoints={state.breakpoints}
          onSetBreakpoint={actions.setBreakpoint}
          onClearBreakpoint={actions.clearBreakpoint}
          currentLocation={state.location}
        />
      </div>
      <div style={{ ...s.body, display: tab === 'debug' ? 'grid' : 'none' }}>
        <div style={{ ...s.cell, gridColumn: 1, gridRow: 1 }}>
          <SourceViewer state={state} actions={actions} />
        </div>
        <div style={{ ...s.cell, gridColumn: 2, gridRow: 1 }}>
          <ScoreboardPanel state={state} actions={actions} />
        </div>
        <div style={{ ...s.cell, gridColumn: 3, gridRow: '1 / 3' }}>
          <BreakpointPanel state={state} actions={actions} />
          <WatchPanel state={state} actions={actions} />
        </div>
        <div style={{ ...s.cell, gridColumn: 1, gridRow: 2 }}>
          <StoragePanel state={state} actions={actions} />
        </div>
        <div style={{ ...s.cell, gridColumn: 2, gridRow: 2, overflow: 'hidden' }}>
          <EventLog logs={state.eventLog} logRef={logRef} />
          <CommandBar actions={actions} />
        </div>
      </div>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ state, actions, tab, setTab }: any) {
  return (
    <div style={s.header}>
      <span style={{ ...s.tag(C.purple), fontWeight: 700, fontSize: 13 }}>⚙ mdb</span>
      <span style={s.badge(state.connected)}>server {state.connected ? 'ok' : 'offline'}</span>
      <span style={s.badge(state.pluginConnected)}>plugin {state.pluginConnected ? 'ok' : 'offline'}</span>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginLeft: 8, background: '#010409', borderRadius: 4, padding: 2 }}>
        {(['explorer', 'debug'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? C.panel : 'transparent',
            border: tab === t ? `1px solid ${C.border}` : '1px solid transparent',
            borderRadius: 3, color: tab === t ? C.text : C.muted,
            padding: '2px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
          }}>
            {t === 'explorer' ? '📁 Explorer' : '🔐 Debug'}
          </button>
        ))}
      </div>

      {state.paused && (
        <>
          <span style={{ color: C.yellow, marginLeft: 4, fontSize: 11 }}>
            ⏸ {state.reason?.toUpperCase()} — {state.location?.function}:{state.location?.line}
          </span>
          <button style={s.btn(C.green)} onClick={actions.continue}>▶ Continue</button>
          <button style={s.btn(C.blue)} onClick={actions.step}>→ Step</button>
        </>
      )}
    </div>
  )
}

// ── Source Viewer ─────────────────────────────────────────────────────────────

function SourceViewer({ state, actions }: any) {
  const currentLine = state.location?.line ?? -1
  const fn = state.sourceFunction
  const bpLines = new Set(
    state.breakpoints.filter((b: any) => b.function === fn).map((b: any) => b.line)
  )

  return (
    <>
      <div style={s.panelHeader}>
        <span style={s.tag(C.blue)}>📄 Source</span>
        {fn && <span style={{ color: C.muted }}>{fn}</span>}
        {!fn && <span style={{ color: C.muted }}>— not loaded</span>}
        {fn && <button style={{ ...s.btn(C.muted, true), marginLeft: 'auto' }}
          onClick={() => actions.getSource(fn)}>⟳</button>}
      </div>
      <div style={{ ...s.panelBody, padding: 0 }}>
        {state.sourceLines.length === 0 && (
          <div style={{ padding: 16, color: C.muted }}>
            {fn ? 'Loading…' : 'Pause execution to load source, or use: getSource <fn>'}
          </div>
        )}
        {state.sourceLines.map((line: string, i: number) => {
          const lineNo = i + 1
          const isCurrent = lineNo === currentLine
          const isBp = bpLines.has(lineNo)
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                background: isCurrent ? C.currentLine : isBp ? C.bpLine : 'transparent',
                borderLeft: isCurrent ? `3px solid ${C.yellow}` : isBp ? `3px solid ${C.red}` : '3px solid transparent',
                minHeight: 18,
              }}
              onClick={() => {
                if (fn) {
                  if (isBp) actions.clearBreakpoint(fn, lineNo)
                  else actions.setBreakpoint(fn, lineNo)
                }
              }}
              title={fn ? (isBp ? 'Click to remove breakpoint' : 'Click to set breakpoint') : ''}
              className="source-line"
            >
              {/* Gutter: dot + line number */}
              <div style={{ display: 'flex', alignItems: 'center', width: 52, flexShrink: 0, userSelect: 'none', fontSize: 11 }}>
                <div style={{ width: 14, textAlign: 'center', color: isBp ? C.red : 'transparent', fontSize: 10 }}>
                  {isCurrent && isBp ? '⏸' : isBp ? '●' : isCurrent ? '▶' : ' '}
                </div>
                <div style={{ flex: 1, textAlign: 'right', paddingRight: 8, color: isCurrent ? C.yellow : C.muted }}>{lineNo}</div>
              </div>
              <span style={{ color: colorizeCommand(line), lineHeight: '18px', whiteSpace: 'pre', paddingRight: 8 }}>
                {line || ' '}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function colorizeCommand(line: string): string {
  if (!line || line.startsWith('#')) return C.muted
  const cmd = line.split(' ')[0]
  if (['scoreboard', 'data', 'execute', 'function'].includes(cmd)) return C.blue
  if (['say', 'tellraw', 'title'].includes(cmd)) return C.green
  if (['kill', 'damage'].includes(cmd)) return C.red
  return C.text
}

// ── Scoreboard Panel ──────────────────────────────────────────────────────────

function ScoreboardPanel({ state, actions }: any) {
  const [selectedObj, setSelectedObj] = useState<string | null>(null)
  const [customObj, setCustomObj] = useState('')

  const objectives = Object.keys(state.scoreboardData)
  const displayObj = selectedObj ?? objectives[0] ?? null
  const entries: ScoreEntry[] = displayObj ? (state.scoreboardData[displayObj] ?? []) : []

  const refresh = (obj: string) => {
    actions.print(obj)
  }

  return (
    <>
      <div style={s.panelHeader}>
        <span style={s.tag(C.orange)}>📊 Scoreboard</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
          <input
            style={{ ...s.input, width: 120 }}
            value={customObj}
            onChange={e => setCustomObj(e.target.value)}
            placeholder="objective"
            onKeyDown={e => { if (e.key === 'Enter' && customObj) { refresh(customObj); setSelectedObj(customObj); setCustomObj('') } }}
          />
          <button style={s.btn(C.orange, true)} onClick={() => { if (customObj) { refresh(customObj); setSelectedObj(customObj); setCustomObj('') } }}>load</button>
        </div>
      </div>
      <div style={s.panelBody}>
        {/* Objective tabs */}
        {objectives.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {objectives.map(obj => (
              <button key={obj}
                style={{ ...s.btn(obj === displayObj ? C.orange : C.muted, true), opacity: obj === displayObj ? 1 : 0.6 }}
                onClick={() => { setSelectedObj(obj); refresh(obj) }}>
                {obj}
              </button>
            ))}
          </div>
        )}
        {/* Entries table */}
        {entries.length === 0 && <div style={{ color: C.muted }}>No data — enter an objective and click load</div>}
        {entries.length > 0 && (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: C.muted, fontWeight: 400, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>entry</th>
                <th style={{ textAlign: 'right', color: C.muted, fontWeight: 400, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>value</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ color: C.blue, padding: '2px 0' }}>{e.entry}</td>
                  <td style={{ textAlign: 'right', color: C.green, fontWeight: 700 }}>{e.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {displayObj && (
          <button style={{ ...s.btn(C.muted, true), marginTop: 8 }} onClick={() => refresh(displayObj!)}>⟳ refresh</button>
        )}
      </div>
    </>
  )
}

// ── Storage / NBT Tree ────────────────────────────────────────────────────────

function StoragePanel({ state, actions }: any) {
  const [storageId, setStorageId] = useState('')
  const [path, setPath] = useState('')

  return (
    <>
      <div style={s.panelHeader}>
        <span style={s.tag(C.cyan)}>📦 Storage / NBT</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
          <input style={{ ...s.input, width: 130 }} value={storageId} onChange={e => setStorageId(e.target.value)} placeholder="ns:key" />
          <input style={{ ...s.input, width: 80 }} value={path} onChange={e => setPath(e.target.value)} placeholder="path" />
          <button style={s.btn(C.cyan, true)} onClick={() => { if (storageId) actions.storage(storageId, path || undefined) }}>load</button>
        </div>
      </div>
      <div style={s.panelBody}>
        {!state.lastStorageValue && <div style={{ color: C.muted }}>Enter a storage namespace:key and click load</div>}
        {state.lastStorageValue && (
          <>
            <div style={{ color: C.muted, marginBottom: 8, fontSize: 11 }}>{state.lastStorageId}</div>
            <NbtTree snbt={state.lastStorageValue} />
          </>
        )}
      </div>
    </>
  )
}

// SNBT parser & tree renderer
function NbtTree({ snbt }: { snbt: string }) {
  const node = parseSnbt(snbt)
  return <NbtNode value={node} depth={0} />
}

type NbtValue =
  | { kind: 'compound'; entries: { key: string; value: NbtValue }[] }
  | { kind: 'list'; items: NbtValue[] }
  | { kind: 'string'; v: string }
  | { kind: 'number'; v: string }
  | { kind: 'bool'; v: boolean }
  | { kind: 'raw'; v: string }

function NbtNode({ value, depth, label }: { value: NbtValue; depth: number; label?: string }) {
  const [open, setOpen] = useState(depth < 2)

  const indent = depth * 14

  if (value.kind === 'compound') {
    return (
      <div style={{ marginLeft: indent }}>
        <span onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', color: C.purple, userSelect: 'none' }}>
          {open ? '▼' : '▶'} {label && <span style={{ color: C.text }}>{label}: </span>}
          <span style={{ color: C.muted }}>{'{'}{!open ? `…${value.entries.length}}` : '}'}</span>
        </span>
        {open && value.entries.map((e, i) => (
          <div key={i} style={{ marginLeft: 14 }}>
            <NbtNode value={e.value} depth={depth + 1} label={e.key} />
          </div>
        ))}
        {open && <span style={{ color: C.muted, marginLeft: 14 }}>{'}'}</span>}
      </div>
    )
  }

  if (value.kind === 'list') {
    return (
      <div style={{ marginLeft: indent }}>
        <span onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', color: C.blue, userSelect: 'none' }}>
          {open ? '▼' : '▶'} {label && <span style={{ color: C.text }}>{label}: </span>}
          <span style={{ color: C.muted }}>{'['}{!open ? `…${value.items.length}]` : ']'}</span>
        </span>
        {open && value.items.map((item, i) => (
          <div key={i} style={{ marginLeft: 14 }}>
            <NbtNode value={item} depth={depth + 1} label={String(i)} />
          </div>
        ))}
        {open && <span style={{ color: C.muted, marginLeft: 14 }}>{']'}</span>}
      </div>
    )
  }

  const valColor = value.kind === 'string' ? C.orange
    : value.kind === 'number' ? C.green
    : value.kind === 'bool' ? C.purple
    : C.text

  return (
    <div style={{ marginLeft: indent, lineHeight: '18px' }}>
      {label && <span style={{ color: C.text }}>{label}: </span>}
      <span style={{ color: valColor }}>{value.kind === 'string' ? `"${value.v}"` : value.v}</span>
    </div>
  )
}

// ── Minimal SNBT parser ───────────────────────────────────────────────────────
// Handles: {key:val,...}, [item,...], "string", numbers, booleans, suffixed numbers (1b, 2.0f)
function parseSnbt(s: string): NbtValue {
  s = s.trim()
  if (s.startsWith('{')) return parseCompound(s)
  if (s.startsWith('[')) return parseList(s)
  if (s.startsWith('"')) return { kind: 'string', v: s.slice(1, -1).replace(/\\"/g, '"') }
  if (s === 'true') return { kind: 'bool', v: true }
  if (s === 'false') return { kind: 'bool', v: false }
  if (/^-?\d/.test(s)) return { kind: 'number', v: s }
  return { kind: 'raw', v: s }
}

function parseCompound(s: string): NbtValue {
  const inner = s.slice(1, -1).trim()
  const entries: { key: string; value: NbtValue }[] = []
  if (!inner) return { kind: 'compound', entries }
  for (const [k, v] of splitKV(inner)) {
    entries.push({ key: k, value: parseSnbt(v) })
  }
  return { kind: 'compound', entries }
}

function parseList(s: string): NbtValue {
  const inner = s.slice(1, -1).trim()
  // Skip typed array prefix: [B;, [I;, [L;
  const body = /^\[([BIL]);/.test(s) ? inner.replace(/^[BIL];/, '') : inner
  const items = body ? splitItems(body).map(parseSnbt) : []
  return { kind: 'list', items }
}

// Split "key:val, key2:val2" respecting nesting
function splitKV(s: string): [string, string][] {
  const result: [string, string][] = []
  let depth = 0; let start = 0; let inStr = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' && s[i - 1] !== '\\') inStr = !inStr
    if (inStr) continue
    if (c === '{' || c === '[') depth++
    if (c === '}' || c === ']') depth--
    if (c === ',' && depth === 0) {
      const pair = s.slice(start, i).trim()
      const colon = pair.indexOf(':')
      if (colon > 0) result.push([pair.slice(0, colon).trim(), pair.slice(colon + 1).trim()])
      start = i + 1
    }
  }
  const last = s.slice(start).trim()
  const colon = last.indexOf(':')
  if (colon > 0) result.push([last.slice(0, colon).trim(), last.slice(colon + 1).trim()])
  return result
}

function splitItems(s: string): string[] {
  const result: string[] = []
  let depth = 0; let start = 0; let inStr = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' && s[i - 1] !== '\\') inStr = !inStr
    if (inStr) continue
    if (c === '{' || c === '[') depth++
    if (c === '}' || c === ']') depth--
    if (c === ',' && depth === 0) {
      result.push(s.slice(start, i).trim())
      start = i + 1
    }
  }
  const last = s.slice(start).trim()
  if (last) result.push(last)
  return result
}

// ── Event Log ─────────────────────────────────────────────────────────────────

function EventLog({ logs, logRef }: any) {
  return (
    <div ref={logRef} style={{ ...s.panelBody, flex: 1, overflowY: 'auto', minHeight: 0, fontSize: 11 }}>
      <div style={{ ...s.panelHeader, position: 'sticky', top: 0, zIndex: 1 }}>
        <span style={s.tag(C.muted)}>📋 Event Log</span>
      </div>
      {logs.map((line: string, i: number) => (
        <div key={i} style={{
          color: line.includes('⏸') ? C.yellow
            : line.includes('⚡') ? C.orange
            : line.includes('>>') ? C.green
            : line.includes('error') ? C.red
            : C.muted,
          marginBottom: 1, fontFamily: 'inherit'
        }}>
          {line}
        </div>
      ))}
    </div>
  )
}

// ── Command Bar ───────────────────────────────────────────────────────────────

function CommandBar({ actions }: any) {
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)

  const run = useCallback(() => {
    const trimmed = cmd.trim()
    if (!trimmed) return
    setHistory(h => [trimmed, ...h.slice(0, 49)])
    setHistIdx(-1)

    const parts = trimmed.split(/\s+/)
    switch (parts[0]) {
      case 'break': case 'b':
        if (parts[2]) actions.setBreakpoint(parts[1], parseInt(parts[2]))
        break
      case 'clear':
        if (parts[2]) actions.clearBreakpoint(parts[1], parseInt(parts[2]))
        break
      case 'clearall': actions.clearAllBreakpoints(); break
      case 'continue': case 'c': actions.continue(); break
      case 'step': case 's': actions.step(); break
      case 'print': case 'p':
        if (parts[1]) actions.print(parts[1], parts[2])
        break
      case 'watch': case 'w':
        if (parts[2]) actions.watch(parts[1], parts[2])
        break
      case 'unwatch':
        if (parts[2]) actions.unwatch(parts[1], parts[2])
        break
      case 'storage': case 'nbt':
        if (parts[1] === 'list') actions.listStorage()
        else if (parts[1]) actions.storage(parts[1], parts.slice(2).join('.') || undefined)
        break
      case 'source':
        if (parts[1]) actions.getSource(parts[1])
        break
      case 'run': case '/':
        // run <mc command>   e.g. run function mdb_demo:main
        actions.runCommand(parts.slice(1).join(' '))
        break
      case 'obj': case 'objectives': actions.listObjectives(); break
      default:
        actions.raw({ type: parts[0], ...Object.fromEntries(parts.slice(1).map((v: string, i: number) => [`arg${i}`, v])) })
    }
    setCmd('')
  }, [cmd, actions])

  return (
    <div style={{ padding: '6px 8px', background: C.panel, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ color: C.purple, fontSize: 12, flexShrink: 0 }}>(mdb)</span>
        <input
          style={{ ...s.input }}
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') run()
            if (e.key === 'ArrowUp') { const idx = Math.min(histIdx + 1, history.length - 1); setHistIdx(idx); setCmd(history[idx] ?? '') }
            if (e.key === 'ArrowDown') { const idx = Math.max(histIdx - 1, -1); setHistIdx(idx); setCmd(idx === -1 ? '' : history[idx]) }
          }}
          placeholder="run function mdb_demo:main  |  break fn line  |  step  |  print obj  |  storage ns:key"
          autoFocus
        />
        <button style={{ ...s.btn(C.purple, true), flexShrink: 0 }} onClick={run}>run</button>
      </div>
    </div>
  )
}

// ── Breakpoint Panel ──────────────────────────────────────────────────────────

function BreakpointPanel({ state, actions }: any) {
  const [fn, setFn] = useState('')
  const [line, setLine] = useState('')

  return (
    <div style={{ background: C.bg, borderBottom: `1px solid ${C.border}`, padding: 10, flexShrink: 0 }}>
      <div style={{ color: C.muted, fontSize: 11, marginBottom: 6 }}>🔴 Breakpoints ({state.breakpoints.length})</div>
      <div style={{ maxHeight: 100, overflowY: 'auto', marginBottom: 6 }}>
        {state.breakpoints.map((bp: any, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ color: C.red, fontSize: 10 }}>● {bp.function}:{bp.line}</span>
            <button onClick={() => actions.clearBreakpoint(bp.function, bp.line)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: '0 4px', fontSize: 12 }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input style={{ ...s.input, flex: 2 }} value={fn} onChange={e => setFn(e.target.value)} placeholder="fn:path" />
        <input style={{ ...s.input, width: 40 }} value={line} onChange={e => setLine(e.target.value)} placeholder="ln" type="number" />
        <button style={s.btn(C.red, true)} onClick={() => { if (fn && line) { actions.setBreakpoint(fn, parseInt(line)); setFn(''); setLine('') } }}>+</button>
      </div>
    </div>
  )
}

// ── Watch Panel ───────────────────────────────────────────────────────────────

function WatchPanel({ state, actions }: any) {
  const [obj, setObj] = useState('')
  const [entry, setEntry] = useState('')

  return (
    <div style={{ background: C.bg, flex: 1, padding: 10, overflow: 'auto' }}>
      <div style={{ color: C.muted, fontSize: 11, marginBottom: 6 }}>⚡ Watches ({state.watches.length})</div>
      <div style={{ marginBottom: 6 }}>
        {state.watches.map((w: any, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ color: C.orange, fontSize: 10 }}>⚡ {w.objective}[{w.entry}]</span>
            <button onClick={() => actions.unwatch(w.objective, w.entry)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: '0 4px', fontSize: 12 }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input style={{ ...s.input, flex: 1 }} value={obj} onChange={e => setObj(e.target.value)} placeholder="objective" />
        <input style={{ ...s.input, flex: 1 }} value={entry} onChange={e => setEntry(e.target.value)} placeholder="$entry" />
        <button style={s.btn(C.orange, true)} onClick={() => { if (obj && entry) { actions.watch(obj, entry); setObj(''); setEntry('') } }}>+</button>
      </div>
    </div>
  )
}
