import { WebSocket, WebSocketServer } from 'ws'

interface Breakpoint {
  function: string
  line: number
}

interface Watch {
  objective: string
  entry: string
}

/**
 * mdb debug bridge server.
 *
 * Listens on two ports:
 *   - pluginPort: accepts connection from the Paper plugin
 *   - clientPort: accepts connections from CLI/web clients
 *
 * Bridges messages between plugin and clients, and manages breakpoint state.
 */
export class DebugServer {
  private pluginWss: WebSocketServer
  private clientWss: WebSocketServer
  private pluginSocket: WebSocket | null = null
  private clientSockets: Set<WebSocket> = new Set()
  private breakpoints: Breakpoint[] = []
  private watches: Watch[] = []

  constructor(private pluginPort: number, private clientPort: number) {
    this.pluginWss = new WebSocketServer({ port: pluginPort })
    this.clientWss = new WebSocketServer({ port: clientPort })
  }

  start() {
    this.pluginWss.on('connection', (ws) => {
      console.log('[mdb-server] Plugin connected')
      this.pluginSocket = ws

      // Send current breakpoints and watches to freshly connected plugin
      for (const bp of this.breakpoints) {
        this.sendToPlugin({ type: 'setBreakpoint', function: bp.function, line: bp.line })
      }
      for (const w of this.watches) {
        this.sendToPlugin({ type: 'watch', objective: w.objective, entry: w.entry })
      }

      ws.on('message', (data) => {
        const json = data.toString()
        try {
          const msg = JSON.parse(json)
          // Log only interesting events (skip high-frequency cmd traces)
          if (!['cmdTrace'].includes(msg.type)) {
            console.log('[plugin→]', JSON.stringify(msg))
          }
          // Forward to all connected clients
          this.broadcastToClients(json)
        } catch (e) {
          console.warn('[mdb-server] Invalid JSON from plugin:', json)
        }
      })

      ws.on('close', () => {
        console.log('[mdb-server] Plugin disconnected')
        this.pluginSocket = null
        this.broadcastToClients(JSON.stringify({ type: 'pluginDisconnected' }))
      })
    })

    this.clientWss.on('connection', (ws) => {
      console.log('[mdb-server] Client connected')
      this.clientSockets.add(ws)

      // Send current state to new client
      ws.send(JSON.stringify({
        type: 'hello',
        pluginConnected: this.pluginSocket !== null,
        breakpoints: this.breakpoints,
        watches: this.watches
      }))

      ws.on('message', (data) => {
        const json = data.toString()
        try {
          const msg = JSON.parse(json)
          console.log('[client→]', JSON.stringify(msg))
          this.handleClientMessage(msg, json)
        } catch (e) {
          console.warn('[mdb-server] Invalid JSON from client:', json)
        }
      })

      ws.on('close', () => {
        this.clientSockets.delete(ws)
        console.log('[mdb-server] Client disconnected')
      })
    })
  }

  stop() {
    this.pluginWss.close()
    this.clientWss.close()
  }

  private handleClientMessage(msg: any, raw: string) {
    switch (msg.type) {
      case 'setBreakpoint': {
        const bp: Breakpoint = { function: msg.function, line: msg.line }
        this.breakpoints.push(bp)
        this.sendToPlugin(msg)
        break
      }
      case 'clearBreakpoint': {
        this.breakpoints = this.breakpoints.filter(
          b => !(b.function === msg.function && b.line === msg.line)
        )
        this.sendToPlugin(msg)
        break
      }
      case 'clearAllBreakpoints': {
        this.breakpoints = []
        this.sendToPlugin(msg)
        break
      }
      case 'watch': {
        const w: Watch = { objective: msg.objective, entry: msg.entry }
        // Avoid duplicates
        if (!this.watches.some(x => x.objective === w.objective && x.entry === w.entry)) {
          this.watches.push(w)
        }
        this.sendToPlugin(msg)
        break
      }
      case 'unwatch': {
        this.watches = this.watches.filter(
          w => !(w.objective === msg.objective && w.entry === msg.entry)
        )
        this.sendToPlugin(msg)
        break
      }
      case 'unwatchAll':
        this.watches = []
        this.sendToPlugin(msg)
        break
      case 'step':
      case 'continue':
      case 'print':
      case 'listObjectives':
      case 'storage':
      case 'listStorage':
        // Forward directly to plugin
        this.sendToPlugin(msg)
        break
      default:
        console.warn('[mdb-server] Unknown client message type:', msg.type)
    }
  }

  private sendToPlugin(msg: object) {
    if (this.pluginSocket && this.pluginSocket.readyState === WebSocket.OPEN) {
      this.pluginSocket.send(JSON.stringify(msg))
    } else {
      console.warn('[mdb-server] No plugin connected — cannot send:', msg)
    }
  }

  private broadcastToClients(json: string) {
    for (const client of this.clientSockets) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json)
      }
    }
  }
}
