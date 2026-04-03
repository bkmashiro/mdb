import { useState, useEffect } from 'react'

const C = {
  bg: '#0d1117', panel: '#161b22', border: '#30363d',
  text: '#e6edf3', muted: '#8b949e',
  green: '#3fb950', red: '#f85149', yellow: '#d29922',
  blue: '#58a6ff', purple: '#bc8cff', orange: '#ffa657',
  hover: '#1a2233', selected: '#1d3a5e',
}

const API = `http://${window.location.hostname}:${window.location.port || '2527'}`

interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: TreeNode[]
}

export interface OpenFile {
  path: string
  functionId: string | null
  lines: string[]
  content: string
}

interface Props {
  breakpoints: { function: string; line: number }[]
  currentLocation: { function: string; line: number } | null
  onOpen: (file: OpenFile) => void
  openPath: string | null
  onSetBreakpoint: (fn: string, line: number) => void
  onClearBreakpoint: (fn: string, line: number) => void
}

export function FileTree({ onOpen, openPath }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API}/api/tree`)
      .then(r => r.json())
      .then(setTree)
      .catch(e => setError('Tree load failed: ' + e.message))
  }, [])

  const openFile = async (relPath: string) => {
    try {
      const r = await fetch(`${API}/api/file?path=${encodeURIComponent(relPath)}`)
      const data = await r.json()
      onOpen(data)
    } catch (e: any) {
      setError('File load failed: ' + e.message)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 11 }}>
      <div style={{ padding: '5px 8px', background: C.panel, borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1, flexShrink: 0 }}>
        EXPLORER
      </div>
      {error && <div style={{ color: C.red, padding: 6, fontSize: 10 }}>{error}</div>}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tree.map(node => (
          <TreeNode key={node.path} node={node} depth={0} onOpen={openFile} selectedPath={openPath} />
        ))}
      </div>
    </div>
  )
}

function TreeNode({ node, depth, onOpen, selectedPath }: {
  node: TreeNode; depth: number
  onOpen: (path: string) => void; selectedPath: string | null
}) {
  const [open, setOpen] = useState(depth < 1)
  const isMcFn = node.name.endsWith('.mcfunction')
  const isSelected = node.path === selectedPath

  if (node.type === 'file') {
    return (
      <div
        style={{
          paddingLeft: 8 + depth * 10, paddingTop: 2, paddingBottom: 2,
          cursor: 'pointer',
          background: isSelected ? C.selected : 'transparent',
          color: isMcFn ? C.text : C.muted,
          display: 'flex', alignItems: 'center', gap: 4,
          borderLeft: isSelected ? `2px solid ${C.blue}` : '2px solid transparent',
        }}
        onClick={() => onOpen(node.path)}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = C.hover }}
        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <span style={{ color: isMcFn ? C.green : C.muted, flexShrink: 0, fontSize: 9 }}>
          {isMcFn ? '⬡' : '·'}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isMcFn ? node.name.replace('.mcfunction', '') : node.name}
        </span>
      </div>
    )
  }

  // Skip over boring "data" level — collapse namespace into pack
  const displayName = getDisplayName(node, depth)

  return (
    <div>
      <div
        style={{
          paddingLeft: 8 + depth * 10, paddingTop: 3, paddingBottom: 3,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          color: C.muted, userSelect: 'none',
        }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted }}
      >
        <span style={{ color: C.purple, fontSize: 9, width: 8, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
        </span>
      </div>
      {open && node.children?.map(child => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onOpen={onOpen} selectedPath={selectedPath} />
      ))}
    </div>
  )
}

function getDisplayName(node: TreeNode, _depth: number): string {
  // At depth 0: show pack name
  // "data", "function" sub-dirs are noise — keep them short
  if (node.name === 'data') return '▸ data'
  return node.name
}
