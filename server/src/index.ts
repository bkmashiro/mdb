import { DebugServer } from './DebugServer'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'

const PLUGIN_PORT = parseInt(process.env.PLUGIN_PORT ?? '2525')
const CLIENT_PORT = parseInt(process.env.CLIENT_PORT ?? '2526')
const WEB_PORT = parseInt(process.env.WEB_PORT ?? '2527')

const server = new DebugServer(PLUGIN_PORT, CLIENT_PORT)
server.start()

console.log(`[mdb-server] Plugin endpoint: ws://localhost:${PLUGIN_PORT}/plugin`)
console.log(`[mdb-server] Client endpoint: ws://localhost:${CLIENT_PORT}/client`)

// Serve Web UI (optional — only if ../web/dist exists)
const webDistPath = path.resolve(__dirname, '../../web/dist')
if (fs.existsSync(webDistPath)) {
  const mime: Record<string, string> = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
  }
  const httpServer = http.createServer((req, res) => {
    let filePath = path.join(webDistPath, req.url === '/' ? 'index.html' : req.url!)
    if (!fs.existsSync(filePath)) filePath = path.join(webDistPath, 'index.html')
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': mime[ext] ?? 'text/plain' })
    fs.createReadStream(filePath).pipe(res)
  })
  httpServer.listen(WEB_PORT, () => {
    console.log(`[mdb-server] Web UI: http://localhost:${WEB_PORT}`)
  })
}

process.on('SIGINT', () => {
  console.log('\n[mdb-server] Shutting down...')
  server.stop()
  process.exit(0)
})
