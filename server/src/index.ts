import { DebugServer } from './DebugServer'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as url from 'url'

const PLUGIN_PORT = parseInt(process.env.PLUGIN_PORT ?? '2525')
const CLIENT_PORT = parseInt(process.env.CLIENT_PORT ?? '2526')
const WEB_PORT    = parseInt(process.env.WEB_PORT    ?? '2527')

// Datapack root — configurable via DATAPACK_ROOT env var
const DATAPACK_ROOT = process.env.DATAPACK_ROOT
  ?? path.resolve(process.cwd(), '../../../mc-test-server/world/datapacks')

const server = new DebugServer(PLUGIN_PORT, CLIENT_PORT)
server.start()

console.log(`[mdb-server] Plugin endpoint: ws://localhost:${PLUGIN_PORT}/plugin`)
console.log(`[mdb-server] Client endpoint: ws://localhost:${CLIENT_PORT}/client`)
console.log(`[mdb-server] Datapack root:   ${DATAPACK_ROOT}`)

// ── File tree helper ─────────────────────────────────────────────────────────

interface TreeNode {
  name: string
  path: string          // relative to DATAPACK_ROOT
  type: 'dir' | 'file'
  children?: TreeNode[]
}

function buildTree(absDir: string, relBase: string): TreeNode[] {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }) }
  catch { return [] }

  const nodes: TreeNode[] = []
  for (const e of entries) {
    const rel = relBase ? `${relBase}/${e.name}` : e.name
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: rel, type: 'dir', children: buildTree(path.join(absDir, e.name), rel) })
    } else if (e.name.endsWith('.mcfunction') || e.name.endsWith('.json') || e.name === 'pack.mcmeta') {
      nodes.push({ name: e.name, path: rel, type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

// Convert file path in tree to function id:  
//   "mdb_demo/data/mdb_demo/function/loop.mcfunction"
//   → "mdb_demo:loop"
function pathToFunctionId(relPath: string): string | null {
  // relPath: <pack>/data/<namespace>/function/<...>.mcfunction
  const m = relPath.match(/^[^/]+\/data\/([^/]+)\/function\/(.+)\.mcfunction$/)
  if (!m) return null
  return `${m[1]}:${m[2]}`
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const webDistPath = path.resolve(__dirname, '../../web/dist')

const mime: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json',
}

const httpServer = http.createServer((req, res) => {
  const parsed = url.parse(req.url ?? '/', true)
  const pathname = parsed.pathname ?? '/'

  // CORS for dev
  res.setHeader('Access-Control-Allow-Origin', '*')

  // ── API: GET /api/tree ────────────────────────────────────────────────────
  if (pathname === '/api/tree') {
    const tree = fs.existsSync(DATAPACK_ROOT)
      ? buildTree(DATAPACK_ROOT, '')
      : []
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(tree))
    return
  }

  // ── API: GET /api/file?path=<rel> ─────────────────────────────────────────
  if (pathname === '/api/file') {
    const relPath = (parsed.query['path'] as string) ?? ''
    // Security: no path traversal
    const absPath = path.resolve(DATAPACK_ROOT, relPath)
    if (!absPath.startsWith(path.resolve(DATAPACK_ROOT))) {
      res.writeHead(403); res.end('Forbidden'); return
    }
    if (!fs.existsSync(absPath)) {
      res.writeHead(404); res.end('Not found'); return
    }
    const content = fs.readFileSync(absPath, 'utf8')
    const functionId = pathToFunctionId(relPath)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ path: relPath, content, functionId, lines: content.split('\n') }))
    return
  }

  // ── Static Web UI ─────────────────────────────────────────────────────────
  if (fs.existsSync(webDistPath)) {
    let filePath = path.join(webDistPath, pathname === '/' ? 'index.html' : pathname)
    if (!fs.existsSync(filePath)) filePath = path.join(webDistPath, 'index.html')
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': mime[ext] ?? 'text/plain' })
    fs.createReadStream(filePath).pipe(res)
  } else {
    res.writeHead(404); res.end('Web UI not built')
  }
})

httpServer.listen(WEB_PORT, () => {
  console.log(`[mdb-server] Web UI: http://localhost:${WEB_PORT}`)
})

process.on('SIGINT', () => {
  console.log('\n[mdb-server] Shutting down...')
  server.stop()
  process.exit(0)
})
