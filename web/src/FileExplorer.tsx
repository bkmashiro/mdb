import { useState, useEffect } from 'react'

const C = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  blue: '#58a6ff',
  green: '#3fb950',
  red: '#f85149',
  yellow: '#d29922',
  purple: '#bc8cff',
  hover: '#1f2937',
  selected: '#1d3a5e',
}

const API = `http://${window.location.hostname}:${window.location.port || '2527'}`

export interface OpenFile {
  path: string
  functionId: string | null
  lines: string[]
  content: string
}

interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

interface Props {
  breakpoints: { function: string; line: number }[]
  onSetBreakpoint: (fn: string, line: number) => void
  onClearBreakpoint: (fn: string, line: number) => void
  currentLocation: { function: string; line: number } | null
}

export function FileExplorer({ breakpoints, onSetBreakpoint, onClearBreakpoint, currentLocation }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API}/api/tree`)
      .then(r => r.json())
      .then(setTree)
      .catch(e => setError('Failed to load tree: ' + e.message))
  }, [])

  const openPath = async (relPath: string) => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/file?path=${encodeURIComponent(relPath)}`)
      const data = await r.json()
      setOpenFile(data)
    } catch (e: any) {
      setError('Failed to load file: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const bpSet = new Set(
    breakpoints
      .filter(b => b.function === openFile?.functionId)
      .map(b => b.line)
  )

  const isCurrent = (lineNo: number) =>
    openFile?.functionId != null &&
    currentLocation?.function === openFile.functionId &&
    currentLocation.line === lineNo

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 12 }}>
      {/* File tree sidebar */}
      <div style={{ width: 220, borderRight: `1px solid ${C.border}`, overflow: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '6px 10px', background: C.panel, borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.muted, fontWeight: 600 }}>
          EXPLORER
        </div>
        {error && <div style={{ color: C.red, padding: 8, fontSize: 11 }}>{error}</div>}
        {tree.map(node => (
          <TreeNodeView key={node.path} node={node} depth={0} onOpen={openPath} selectedPath={openFile?.path ?? null} />
        ))}
      </div>

      {/* Source editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 8px', height: 32, flexShrink: 0 }}>
          {openFile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.bg, border: `1px solid ${C.border}`, borderBottom: 'none', padding: '4px 10px', borderRadius: '4px 4px 0 0', fontSize: 11, color: C.text }}>
              <span style={{ color: C.blue }}>📄</span>
              <span>{openFile.path.split('/').pop()}</span>
              {openFile.functionId && <span style={{ color: C.muted, fontSize: 10 }}>({openFile.functionId})</span>}
            </div>
          ) : (
            <span style={{ color: C.muted, fontSize: 11 }}>No file open — click a .mcfunction in the tree</span>
          )}
          {loading && <span style={{ color: C.muted, fontSize: 11, marginLeft: 8 }}>loading…</span>}
        </div>

        {/* Source lines */}
        <div style={{ flex: 1, overflow: 'auto', background: C.bg }}>
          {openFile && openFile.lines.map((line, i) => {
            const lineNo = i + 1
            const hasBp = bpSet.has(lineNo)
            const current = isCurrent(lineNo)
            const isComment = line.trim().startsWith('#')

            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  background: current
                    ? 'rgba(255,214,0,0.12)'
                    : hasBp
                    ? 'rgba(248,81,73,0.10)'
                    : 'transparent',
                  borderLeft: current
                    ? `3px solid ${C.yellow}`
                    : hasBp
                    ? `3px solid ${C.red}`
                    : '3px solid transparent',
                  minHeight: 20,
                  cursor: openFile.functionId ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (!openFile.functionId) return
                  if (hasBp) onClearBreakpoint(openFile.functionId, lineNo)
                  else onSetBreakpoint(openFile.functionId, lineNo)
                }}
                title={openFile.functionId ? (hasBp ? 'Remove breakpoint' : 'Set breakpoint') : ''}
              >
                {/* Gutter: [bp dot] [line number] */}
                <div style={{
                  display: 'flex', alignItems: 'center',
                  width: 52, flexShrink: 0,
                  userSelect: 'none', lineHeight: '20px', fontSize: 11,
                }}>
                  {/* Breakpoint dot column */}
                  <div style={{
                    width: 16, textAlign: 'center', flexShrink: 0,
                    color: hasBp ? C.red : 'transparent',
                    fontSize: 10,
                  }}>
                    {current && hasBp ? '⏸' : hasBp ? '●' : current ? '▶' : ' '}
                  </div>
                  {/* Line number */}
                  <div style={{
                    flex: 1, textAlign: 'right', paddingRight: 8,
                    color: current ? C.yellow : C.muted,
                  }}>
                    {lineNo}
                  </div>
                </div>
                {/* Code */}
                <span style={{
                  color: current
                    ? C.text
                    : isComment
                    ? C.muted
                    : colorize(line),
                  lineHeight: '20px',
                  whiteSpace: 'pre',
                  paddingRight: 16,
                  flex: 1,
                }}>
                  {line || ' '}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Tree node ─────────────────────────────────────────────────────────────────

function TreeNodeView({ node, depth, onOpen, selectedPath }: {
  node: TreeNode
  depth: number
  onOpen: (path: string) => void
  selectedPath: string | null
}) {
  const [open, setOpen] = useState(depth < 1)

  const isMcFunction = node.name.endsWith('.mcfunction')
  const isSelected = node.path === selectedPath

  if (node.type === 'file') {
    // Only show mcfunction files prominently; others as muted
    return (
      <div
        style={{
          paddingLeft: 10 + depth * 12,
          paddingTop: 2, paddingBottom: 2,
          cursor: 'pointer',
          background: isSelected ? C.selected : 'transparent',
          color: isMcFunction ? C.text : C.muted,
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11,
        }}
        onClick={() => onOpen(node.path)}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? C.selected : C.hover }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? C.selected : 'transparent' }}
      >
        <span style={{ color: isMcFunction ? C.green : C.muted, flexShrink: 0 }}>
          {isMcFunction ? '⬡' : '·'}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isMcFunction ? node.name.replace('.mcfunction', '') : node.name}
        </span>
      </div>
    )
  }

  // Dir
  // Skip boring intermediate dirs by collapsing single-child dirs
  const label = simplifyDirLabel(node, depth)

  return (
    <div>
      <div
        style={{
          paddingLeft: 10 + depth * 12,
          paddingTop: 3, paddingBottom: 3,
          cursor: 'pointer',
          color: C.muted,
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 11,
          userSelect: 'none',
        }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted }}
      >
        <span style={{ color: C.purple, width: 10, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        <span style={{ color: open ? C.purple : C.muted }}>{label}</span>
      </div>
      {open && node.children?.map(child => (
        <TreeNodeView key={child.path} node={child} depth={depth + 1} onOpen={onOpen} selectedPath={selectedPath} />
      ))}
    </div>
  )
}

function simplifyDirLabel(node: TreeNode, depth: number): string {
  // Show just the meaningful part of the path
  // e.g. "mdb-demo" at depth 0, but "data/mdb_demo/function" → just "function" at deeper levels
  if (depth === 0) return node.name  // pack name
  return node.name
}

// ── Syntax coloring (minimal) ─────────────────────────────────────────────────

function colorize(line: string): string {
  const cmd = line.trimStart().split(' ')[0]
  switch (cmd) {
    case 'scoreboard': return '#58a6ff'
    case 'execute': return '#a5d6ff'
    case 'function': return '#d2a8ff'
    case 'data': return '#79c0ff'
    case 'say': case 'tellraw': case 'title': return '#3fb950'
    case 'kill': case 'damage': case 'effect': return '#f85149'
    case 'give': case 'summon': return '#ffa657'
    default: return '#e6edf3'
  }
}
