import { useState, useRef, useEffect, useCallback } from 'react'
import { useMdbClient } from './useMdbClient'
import type { ScoreEntry } from './useMdbClient'
import { FileTree } from './FileTree'

const WS_URL = `ws://${window.location.hostname}:2526/client`

const C = {
  bg: '#0d1117', panel: '#161b22', border: '#30363d',
  text: '#e6edf3', muted: '#8b949e',
  green: '#3fb950', red: '#f85149', yellow: '#d29922',
  blue: '#58a6ff', purple: '#bc8cff', orange: '#ffa657', cyan: '#39d353',
  hover: '#1f2937', selected: '#1d3a5e',
  currentLine: 'rgba(255,214,0,0.10)', bpLine: 'rgba(248,81,73,0.08)',
}

const s = {
  app: {
    background: C.bg, color: C.text,
    fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 12,
    display: 'grid', gridTemplateRows: 'auto 1fr',
    height: '100vh', overflow: 'hidden',
  },
  header: {
    background: C.panel, borderBottom: `1px solid ${C.border}`,
    padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 10,
  },
  badge: (ok: boolean) => ({
    background: ok ? '#1a2d1a' : '#2d1a1a',
    border: `1px solid ${ok ? C.green : C.red}`,
    borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700,
    color: ok ? C.green : C.red,
  }),
  btn: (color = C.blue, sm = false) => ({
    background: color + '22', border: `1px solid ${color}`,
    borderRadius: 3, color, padding: sm ? '2px 8px' : '3px 10px',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
  }),
  input: {
    background: '#010409', border: `1px solid ${C.border}`,
    borderRadius: 3, color: C.text, padding: '3px 7px',
    fontFamily: 'inherit', fontSize: 11, outline: 'none',
  },
  panelHead: {
    padding: '4px 8px', background: C.panel,
    borderBottom: `1px solid ${C.border}`,
    fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
  },
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const { state, actions } = useMdbClient(WS_URL)
  const logRef = useRef<HTMLDivElement>(null)
  const [openFile, setOpenFile] = useState<{ path: string; functionId: string | null; lines: string[] } | null>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [state.eventLog])

  // Auto-refresh already-loaded objectives when paused (don't dump all)
  useEffect(() => {
    if (state.paused && state.pluginConnected) {
      Object.keys(state.scoreboardData).forEach(obj => actions.print(obj))
    }
  }, [state.paused])

  // When stopped, if source attached update current view
  useEffect(() => {
    if (state.sourceFunction && state.sourceLines.length > 0) {
      setOpenFile(f => f?.functionId === state.sourceFunction
        ? { ...f, lines: state.sourceLines }
        : f)
    }
  }, [state.sourceFunction, state.sourceLines])

  const handleOpenFile = (file: { path: string; functionId: string | null; lines: string[] }) => {
    setOpenFile(file)
  }

  return (
    <div style={s.app}>
      <Header state={state} actions={actions} openFile={openFile} />
      {/* Main 3-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 240px', height: '100%', overflow: 'hidden' }}>
        {/* Col 1: File tree */}
        <div style={{ borderRight: `1px solid ${C.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <FileTree
            breakpoints={state.breakpoints}
            currentLocation={state.location}
            onOpen={handleOpenFile}
            openPath={openFile?.path ?? null}
            onSetBreakpoint={actions.setBreakpoint}
            onClearBreakpoint={actions.clearBreakpoint}
          />
        </div>

        {/* Col 2: Source viewer */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: `1px solid ${C.border}` }}>
          <SourcePanel
            openFile={openFile}
            state={state}
            actions={actions}
          />
        </div>

        {/* Col 3: Side panels */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ScoreboardPanel state={state} actions={actions} />
          <BreakpointPanel state={state} actions={actions} />
          <WatchPanel state={state} actions={actions} />
          <div ref={logRef} style={{ flex: 1, overflowY: 'auto', fontSize: 10, padding: '4px 8px', minHeight: 0 }}>
            {state.eventLog.slice(-80).map((line, i) => (
              <div key={i} style={{
                color: line.includes('⏸') ? C.yellow : line.includes('⚡') ? C.orange
                  : line.includes('▶') ? C.green : line.includes('error') ? C.red : C.muted,
                marginBottom: 1, lineHeight: '15px',
              }}>{line}</div>
            ))}
          </div>
          <CommandBar actions={actions} />
        </div>
      </div>
    </div>
  )
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ state, actions }: any) {
  return (
    <div style={s.header}>
      <span style={{ color: C.purple, fontWeight: 700, fontSize: 13 }}>⚙ mdb</span>
      <span style={s.badge(state.connected)}>server {state.connected ? 'ok' : 'offline'}</span>
      <span style={s.badge(state.pluginConnected)}>plugin {state.pluginConnected ? 'ok' : 'offline'}</span>
      {state.paused && (
        <>
          <span style={{ color: C.yellow, fontSize: 11, marginLeft: 4 }}>
            ⏸ {state.reason?.toUpperCase()} — {state.location?.function}:{state.location?.line}
          </span>
          <button style={s.btn(C.green)} onClick={actions.continue}>▶ Continue</button>
          <button style={s.btn(C.blue)} onClick={actions.step}>→ Step</button>
        </>
      )}
    </div>
  )
}

// ── Source Panel ──────────────────────────────────────────────────────────────

function SourcePanel({ openFile, state, actions }: any) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentLine = state.location?.line ?? -1
  const fn = openFile?.functionId ?? null
  const bpLines = new Set(
    state.breakpoints.filter((b: any) => b.function === fn).map((b: any) => b.line)
  )

  // Scroll current line into view
  useEffect(() => {
    if (!state.paused || !scrollRef.current || !fn || fn !== state.location?.function) return
    const lineEl = scrollRef.current.querySelector(`[data-line="${currentLine}"]`) as HTMLElement
    if (lineEl) lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [state.paused, currentLine, fn])

  if (!openFile) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
        Select a file from the explorer
      </div>
    )
  }

  return (
    <>
      {/* Tab bar with filename + run button */}
      <div style={{ ...s.panelHead, background: C.panel, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: C.green }}>⬡</span>
          <span style={{ color: C.text }}>{openFile.path.split('/').pop()?.replace('.mcfunction', '')}</span>
          {fn && <span style={{ color: C.muted, fontSize: 10 }}>{fn}</span>}
        </div>
        {fn && (
          <button
            style={{ ...s.btn(C.purple, true) }}
            onClick={() => actions.runCommand(`function ${fn}`)}
            title={`Run: function ${fn}`}
          >
            ▶ run
          </button>
        )}
      </div>

      {/* Source lines */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', background: C.bg }}>
        {openFile.lines.map((line: string, i: number) => {
          const lineNo = i + 1
          const hasBp = bpLines.has(lineNo)
          const isCurrent = fn === state.location?.function && lineNo === currentLine
          const isComment = line.trim().startsWith('#')

          return (
            <div
              key={i}
              data-line={lineNo}
              style={{
                display: 'flex', minHeight: 20,
                background: isCurrent ? C.currentLine : hasBp ? C.bpLine : 'transparent',
                borderLeft: isCurrent ? `3px solid ${C.yellow}` : hasBp ? `3px solid ${C.red}` : '3px solid transparent',
                cursor: fn ? 'pointer' : 'default',
              }}
              onClick={() => {
                if (!fn) return
                if (hasBp) actions.clearBreakpoint(fn, lineNo)
                else actions.setBreakpoint(fn, lineNo)
              }}
            >
              {/* Gutter: [dot] [num] */}
              <div style={{ display: 'flex', alignItems: 'center', width: 52, flexShrink: 0, userSelect: 'none', fontSize: 11 }}>
                <div style={{ width: 14, textAlign: 'center', color: hasBp ? C.red : 'transparent', fontSize: 10, lineHeight: '20px' }}>
                  {isCurrent && hasBp ? '⏸' : hasBp ? '●' : isCurrent ? '▶' : '\u00a0'}
                </div>
                <div style={{ flex: 1, textAlign: 'right', paddingRight: 8, color: isCurrent ? C.yellow : C.muted, lineHeight: '20px' }}>
                  {lineNo}
                </div>
              </div>
              {/* Code */}
              <span style={{ color: isComment ? C.muted : colorize(line), lineHeight: '20px', whiteSpace: 'pre', paddingRight: 16 }}>
                {line || ' '}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function colorize(line: string): string {
  const cmd = line.trimStart().split(' ')[0]
  switch (cmd) {
    case 'scoreboard': return '#58a6ff'
    case 'execute':    return '#a5d6ff'
    case 'function':   return '#d2a8ff'
    case 'data':       return '#79c0ff'
    case 'say': case 'tellraw': case 'title': return '#3fb950'
    case 'kill': case 'damage': return '#f85149'
    case 'give': case 'summon': return '#ffa657'
    default: return C.text
  }
}

// ── Scoreboard Panel ──────────────────────────────────────────────────────────

function ScoreboardPanel({ state, actions }: any) {
  const [obj, setObj] = useState('')
  const objectives = Object.keys(state.scoreboardData)
  const [sel, setSel] = useState<string | null>(null)
  const displayObj = sel ?? objectives[0] ?? null
  const entries: ScoreEntry[] = displayObj ? (state.scoreboardData[displayObj] ?? []) : []

  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={{ ...s.panelHead, justifyContent: 'space-between' }}>
        <span style={{ color: C.orange }}>📊</span>
        <div style={{ display: 'flex', gap: 3, flex: 1, marginLeft: 4 }}>
          <input style={{ ...s.input, flex: 1, fontSize: 10 }} value={obj} onChange={e => setObj(e.target.value)}
            placeholder="objective" onKeyDown={e => { if (e.key === 'Enter' && obj) { actions.print(obj); setSel(obj); setObj('') } }} />
          <button style={s.btn(C.orange, true)} onClick={() => { if (obj) { actions.print(obj); setSel(obj); setObj('') } }}>load</button>
        </div>
      </div>
      {objectives.length > 0 && (
        <div style={{ display: 'flex', gap: 3, padding: '3px 6px', flexWrap: 'wrap' }}>
          {objectives.map(o => (
            <button key={o} style={{ ...s.btn(o === displayObj ? C.orange : C.muted, true), opacity: o === displayObj ? 1 : 0.5, fontSize: 10 }}
              onClick={() => { setSel(o); actions.print(o) }}>{o}</button>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <div style={{ padding: '2px 8px 4px', maxHeight: 100, overflowY: 'auto' }}>
          {entries.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', lineHeight: '16px' }}>
              <span style={{ color: C.blue, fontSize: 11 }}>{e.entry}</span>
              <span style={{ color: C.green, fontWeight: 700, fontSize: 11 }}>{e.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Breakpoint Panel ──────────────────────────────────────────────────────────

function BreakpointPanel({ state, actions }: any) {
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={s.panelHead}>
        <span style={{ color: C.red }}>●</span>
        <span>Breakpoints ({state.breakpoints.length})</span>
      </div>
      <div style={{ maxHeight: 80, overflowY: 'auto', padding: '2px 8px' }}>
        {state.breakpoints.map((bp: any, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', lineHeight: '18px' }}>
            <span style={{ color: C.red, fontSize: 10 }}>● {bp.function}:{bp.line}</span>
            <button onClick={() => actions.clearBreakpoint(bp.function, bp.line)}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, padding: '0 2px' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Watch Panel ───────────────────────────────────────────────────────────────

function WatchPanel({ state, actions }: any) {
  const [obj, setObj] = useState('')
  const [entry, setEntry] = useState('')
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={s.panelHead}>
        <span style={{ color: C.orange }}>⚡</span>
        <span>Watches ({state.watches.length})</span>
      </div>
      <div style={{ maxHeight: 60, overflowY: 'auto', padding: '2px 8px' }}>
        {state.watches.map((w: any, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', lineHeight: '18px' }}>
            <span style={{ color: C.orange, fontSize: 10 }}>⚡ {w.objective}[{w.entry}]</span>
            <button onClick={() => actions.unwatch(w.objective, w.entry)}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, padding: '0 2px' }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3, padding: '3px 6px' }}>
        <input style={{ ...s.input, flex: 1, fontSize: 10 }} value={obj} onChange={e => setObj(e.target.value)} placeholder="obj" />
        <input style={{ ...s.input, flex: 1, fontSize: 10 }} value={entry} onChange={e => setEntry(e.target.value)} placeholder="$entry" />
        <button style={s.btn(C.orange, true)} onClick={() => { if (obj && entry) { actions.watch(obj, entry); setObj(''); setEntry('') } }}>+</button>
      </div>
    </div>
  )
}

// ── Storage Panel ─────────────────────────────────────────────────────────────

function StorageSection({ state, actions }: any) {
  const [id, setId] = useState('')
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={{ ...s.panelHead, justifyContent: 'space-between' }}>
        <span style={{ color: C.cyan }}>📦</span>
        <div style={{ display: 'flex', gap: 3, flex: 1, marginLeft: 4 }}>
          <input style={{ ...s.input, flex: 1, fontSize: 10 }} value={id} onChange={e => setId(e.target.value)} placeholder="ns:key" onKeyDown={e => { if (e.key === 'Enter' && id) { actions.storage(id); setId('') } }} />
          <button style={s.btn(C.cyan, true)} onClick={() => { if (id) { actions.storage(id); setId('') } }}>load</button>
        </div>
      </div>
      {state.lastStorageValue && (
        <div style={{ padding: '4px 8px', maxHeight: 80, overflowY: 'auto', fontSize: 10 }}>
          <div style={{ color: C.muted, marginBottom: 2 }}>{state.lastStorageId}</div>
          <NbtMini snbt={state.lastStorageValue} />
        </div>
      )}
    </div>
  )
}

// Compact inline NBT display
function NbtMini({ snbt }: { snbt: string }) {
  const [expanded, setExpanded] = useState(false)
  const short = snbt.length > 120 ? snbt.slice(0, 120) + '…' : snbt
  return (
    <div style={{ color: C.cyan, wordBreak: 'break-all', cursor: 'pointer', lineHeight: '15px' }}
      onClick={() => setExpanded(e => !e)}>
      {expanded ? snbt : short}
      {snbt.length > 120 && <span style={{ color: C.muted }}> {expanded ? '[less]' : '[more]'}</span>}
    </div>
  )
}

// ── Command Bar ───────────────────────────────────────────────────────────────

function CommandBar({ actions }: any) {
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)

  const run = useCallback(() => {
    const t = cmd.trim(); if (!t) return
    setHistory(h => [t, ...h.slice(0, 49)]); setHistIdx(-1)
    const parts = t.split(/\s+/)
    switch (parts[0]) {
      case 'b': case 'break': if (parts[2]) actions.setBreakpoint(parts[1], parseInt(parts[2])); break
      case 'clear': if (parts[2]) actions.clearBreakpoint(parts[1], parseInt(parts[2])); break
      case 'clearall': actions.clearAllBreakpoints(); break
      case 'c': case 'continue': actions.continue(); break
      case 's': case 'step': actions.step(); break
      case 'p': case 'print': if (parts[1]) actions.print(parts[1], parts[2]); break
      case 'w': case 'watch': if (parts[2]) actions.watch(parts[1], parts[2]); break
      case 'unwatch': if (parts[2]) actions.unwatch(parts[1], parts[2]); break
      case 'storage': case 'nbt':
        if (parts[1] === 'list') actions.listStorage()
        else if (parts[1]) actions.storage(parts[1], parts.slice(2).join('.') || undefined); break
      case 'source': if (parts[1]) actions.getSource(parts[1]); break
      case 'run': case '/': actions.runCommand(parts.slice(1).join(' ')); break
      case 'obj': case 'objectives': actions.listObjectives(); break
      default: actions.raw({ type: parts[0], ...Object.fromEntries(parts.slice(1).map((v: string, i: number) => [`arg${i}`, v])) })
    }
    setCmd('')
  }, [cmd, actions])

  return (
    <div style={{ padding: '5px 6px', background: C.panel, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 5 }}>
        <span style={{ color: C.purple, lineHeight: '22px', flexShrink: 0 }}>(mdb)</span>
        <input style={{ ...s.input, flex: 1 }} value={cmd} onChange={e => setCmd(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') run()
            if (e.key === 'ArrowUp') { const i = Math.min(histIdx + 1, history.length - 1); setHistIdx(i); setCmd(history[i] ?? '') }
            if (e.key === 'ArrowDown') { const i = Math.max(histIdx - 1, -1); setHistIdx(i); setCmd(i === -1 ? '' : history[i]) }
          }}
          placeholder="run function ns:name  |  break fn line  |  step  |  print obj"
          autoFocus
        />
        <button style={{ ...s.btn(C.purple, true), flexShrink: 0 }} onClick={run}>↵</button>
      </div>
    </div>
  )
}

// re-export unused to avoid lint errors
export { StorageSection }
