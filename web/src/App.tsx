import { useState, useRef, useEffect } from 'react'
import { useMdbClient } from './useMdbClient'

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
}

const s = {
  app: { background: C.bg, minHeight: '100vh', color: C.text, fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 13, display: 'grid', gridTemplateRows: 'auto 1fr', gap: 0 },
  header: { background: C.panel, borderBottom: `1px solid ${C.border}`, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 16 },
  body: { display: 'grid', gridTemplateColumns: '1fr 320px', height: 'calc(100vh - 41px)', overflow: 'hidden' },
  left: { display: 'grid', gridTemplateRows: 'auto 1fr auto', overflow: 'hidden' },
  panel: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, margin: 8, overflow: 'auto' },
  right: { display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  badge: (ok: boolean) => ({ background: ok ? C.green : C.red, borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: '#fff' }),
  btn: (color = C.blue) => ({ background: color, border: 'none', borderRadius: 4, color: '#fff', padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }),
  input: { background: '#010409', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '4px 8px', fontFamily: 'inherit', fontSize: 12, outline: 'none' },
  label: { color: C.muted, fontSize: 11, marginBottom: 4, display: 'block' },
  tag: (c: string) => ({ color: c, fontWeight: 700 }),
}

export function App() {
  const { state, actions } = useMdbClient(WS_URL)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [state.eventLog])

  return (
    <div style={s.app}>
      <Header state={state} actions={actions} />
      <div style={s.body}>
        <div style={s.left}>
          <PausedView state={state} actions={actions} />
          <EventLog logs={state.eventLog} logRef={logRef} />
          <CommandBar actions={actions} />
        </div>
        <div style={s.right}>
          <BreakpointPanel state={state} actions={actions} />
          <WatchPanel state={state} actions={actions} />
        </div>
      </div>
    </div>
  )
}

function Header({ state, actions }: any) {
  return (
    <div style={s.header}>
      <span style={{ ...s.tag(C.purple), fontSize: 16 }}>⚙ mdb</span>
      <span style={s.badge(state.connected)}>server {state.connected ? 'connected' : 'disconnected'}</span>
      <span style={s.badge(state.pluginConnected)}>plugin {state.pluginConnected ? 'connected' : 'offline'}</span>
      {state.paused && (
        <>
          <span style={{ ...s.tag(C.yellow), marginLeft: 8 }}>
            ⏸ {state.reason?.toUpperCase()} — {state.location?.function}:{state.location?.line}
          </span>
          <button style={s.btn(C.green)} onClick={actions.continue}>▶ Continue</button>
          <button style={s.btn(C.blue)} onClick={actions.step}>→ Step</button>
        </>
      )}
      <span style={{ flex: 1 }} />
    </div>
  )
}

function PausedView({ state }: any) {
  if (!state.paused) return (
    <div style={{ ...s.panel, color: C.muted, textAlign: 'center', padding: 24 }}>
      Not paused — set a breakpoint or use watch to pause execution
    </div>
  )

  return (
    <div style={s.panel}>
      <div style={{ marginBottom: 8 }}>
        <span style={s.tag(C.yellow)}>⏸ {state.reason}</span>
        {' '}
        <span style={s.tag(C.blue)}>{state.location?.function}</span>
        <span style={s.tag(C.muted)}>:{state.location?.line}</span>
      </div>
      <div style={{ background: '#010409', borderRadius: 4, padding: '6px 10px', marginBottom: 10, color: C.orange }}>
        {state.location?.command}
      </div>
      {state.stack.length > 0 && (
        <>
          <div style={s.label}>Call Stack</div>
          {state.stack.map((frame: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
              <span style={s.tag(i === 0 ? C.green : C.muted)}>#{i}</span>
              <span style={{ color: i === 0 ? C.text : C.muted }}>
                {frame.function}<span style={s.tag(C.muted)}>:{frame.line}</span>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function EventLog({ logs, logRef }: any) {
  return (
    <div ref={logRef} style={{ ...s.panel, flex: 1, overflowY: 'auto', minHeight: 0 }}>
      <div style={{ ...s.label, marginBottom: 6 }}>Event Log</div>
      {logs.map((line: string, i: number) => (
        <div key={i} style={{ color: line.includes('⏸') ? C.yellow : line.includes('⚡') ? C.orange : line.includes('>>') ? C.green : C.muted, marginBottom: 1 }}>
          {line}
        </div>
      ))}
    </div>
  )
}

function CommandBar({ actions }: any) {
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)

  const run = () => {
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
        else if (parts[1]) actions.storage(parts[1], parts.slice(2).join('.'))
        break
      case 'obj': case 'objectives': actions.listObjectives(); break
      default:
        actions.raw({ type: parts[0], ...Object.fromEntries(parts.slice(1).map((v, i) => [`arg${i}`, v])) })
    }
    setCmd('')
  }

  return (
    <div style={{ padding: '8px 8px', background: C.panel, borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ color: C.purple, lineHeight: '28px' }}>(mdb)</span>
        <input
          style={{ ...s.input, flex: 1 }}
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') run()
            if (e.key === 'ArrowUp') {
              const idx = Math.min(histIdx + 1, history.length - 1)
              setHistIdx(idx)
              setCmd(history[idx] ?? '')
            }
            if (e.key === 'ArrowDown') {
              const idx = Math.max(histIdx - 1, -1)
              setHistIdx(idx)
              setCmd(idx === -1 ? '' : history[idx])
            }
          }}
          placeholder="break fn:path line | continue | step | print obj entry | storage ns:key path"
          autoFocus
        />
        <button style={s.btn()} onClick={run}>Run</button>
      </div>
    </div>
  )
}

function BreakpointPanel({ state, actions }: any) {
  const [fn, setFn] = useState('')
  const [line, setLine] = useState('')

  return (
    <div style={s.panel}>
      <div style={{ ...s.label, marginBottom: 8, fontSize: 12, color: C.text }}>Breakpoints ({state.breakpoints.length})</div>
      {state.breakpoints.map((bp: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ color: C.red, fontSize: 11 }}>● {bp.function}:{bp.line}</span>
          <button onClick={() => actions.clearBreakpoint(bp.function, bp.line)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: '0 4px' }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <input style={{ ...s.input, flex: 2 }} value={fn} onChange={e => setFn(e.target.value)} placeholder="fn:path" />
        <input style={{ ...s.input, width: 48 }} value={line} onChange={e => setLine(e.target.value)} placeholder="line" type="number" />
        <button style={s.btn(C.red)} onClick={() => { if (fn && line) { actions.setBreakpoint(fn, parseInt(line)); setFn(''); setLine('') } }}>+</button>
      </div>
    </div>
  )
}

function WatchPanel({ state, actions }: any) {
  const [obj, setObj] = useState('')
  const [entry, setEntry] = useState('')

  return (
    <div style={{ ...s.panel, flex: 1 }}>
      <div style={{ ...s.label, marginBottom: 8, fontSize: 12, color: C.text }}>Watches ({state.watches.length})</div>
      {state.watches.map((w: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ color: C.orange, fontSize: 11 }}>⚡ {w.objective}[{w.entry}]</span>
          <button onClick={() => actions.unwatch(w.objective, w.entry)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: '0 4px' }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <input style={{ ...s.input, flex: 1 }} value={obj} onChange={e => setObj(e.target.value)} placeholder="objective" />
        <input style={{ ...s.input, flex: 1 }} value={entry} onChange={e => setEntry(e.target.value)} placeholder="$entry" />
        <button style={s.btn(C.orange)} onClick={() => { if (obj && entry) { actions.watch(obj, entry); setObj(''); setEntry('') } }}>+</button>
      </div>
    </div>
  )
}
