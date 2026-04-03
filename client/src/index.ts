#!/usr/bin/env node
/**
 * mdb — Minecraft Datapack Debugger CLI
 * GDB-inspired REPL for debugging mcfunction files.
 */

import * as readline from 'readline'
import { WebSocket } from 'ws'

const SERVER_HOST = process.env.MDB_HOST ?? 'localhost'
const CLIENT_PORT = parseInt(process.env.MDB_CLIENT_PORT ?? '2526')

class MdbClient {
  private ws: WebSocket | null = null
  private rl: readline.Interface
  private connected = false
  private paused = false
  private currentLocation: { function: string; line: number; command: string } | null = null

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '(mdb) '
    })
  }

  connect(host: string, port: number) {
    const url = `ws://${host}:${port}/client`
    console.log(`[mdb] Connecting to ${url}...`)

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      this.connected = true
      console.log('[mdb] Connected to debug server.')
      console.log('[mdb] Type "help" for available commands.\n')
      this.rl.prompt()
    })

    this.ws.on('message', (data) => {
      const json = data.toString()
      try {
        const msg = JSON.parse(json)
        this.handleServerMessage(msg)
      } catch {
        console.log('[raw]', json)
      }
    })

    this.ws.on('close', () => {
      this.connected = false
      console.log('\n[mdb] Disconnected from debug server.')
      process.exit(0)
    })

    this.ws.on('error', (err) => {
      console.error(`[mdb] Connection error: ${err.message}`)
      console.error(`[mdb] Is the debug server running? Start with: node server/dist/index.js`)
      process.exit(1)
    })
  }

  private handleServerMessage(msg: any) {
    switch (msg.type) {
      case 'hello':
        console.log(`[mdb] Plugin connected: ${msg.pluginConnected ? '✓' : '✗ (not yet)'}`)
        if (msg.breakpoints?.length > 0) {
          console.log(`[mdb] Active breakpoints: ${msg.breakpoints.length}`)
        }
        break

      case 'pluginDisconnected':
        console.log('[mdb] ⚠ Plugin disconnected from server')
        break

      case 'functionEnter':
        process.stdout.write(`\n>> ${msg.function}\n`)
        this.rl.prompt()
        break

      case 'functionExit':
        process.stdout.write(`\n<< ${msg.function}\n`)
        this.rl.prompt()
        break

      case 'stopped': {
        this.paused = true
        this.currentLocation = msg.location
        const loc = msg.location
        console.log(`\n⏸  Stopped at ${loc.function}:${loc.line} [${msg.reason}]`)
        console.log(`   ${loc.command}`)
        if (msg.scores && Object.keys(msg.scores).length > 0) {
          console.log('   Scores:', JSON.stringify(msg.scores))
        }
        this.rl.prompt()
        break
      }

      default:
        // Compact display for unknown events
        console.log('\n[event]', JSON.stringify(msg))
        this.rl.prompt()
    }
  }

  private send(msg: object) {
    if (!this.connected || !this.ws) {
      console.log('[mdb] Not connected.')
      return
    }
    this.ws.send(JSON.stringify(msg))
  }

  private handleCommand(line: string) {
    const parts = line.trim().split(/\s+/)
    const cmd = parts[0]?.toLowerCase()

    switch (cmd) {
      case '':
        break

      case 'help':
        console.log(`
Commands:
  break <function> <line>   Set a breakpoint  (e.g. break my_pack:tick 5)
  clear <function> <line>   Clear a breakpoint
  clearall                  Clear all breakpoints
  continue / c              Resume execution
  step / s                  Step to next command
  print <scoreboard_name>   (planned) Show scoreboard value
  bt                        (planned) Show call stack
  status                    Show connection status
  quit / q                  Exit
`)
        break

      case 'break':
      case 'b': {
        if (parts.length < 3) {
          console.log('Usage: break <function> <line>')
          break
        }
        const fn = parts[1]
        const line = parseInt(parts[2])
        if (isNaN(line)) { console.log('Line must be a number'); break }
        this.send({ type: 'setBreakpoint', function: fn, line })
        console.log(`Breakpoint set: ${fn}:${line}`)
        break
      }

      case 'clear': {
        if (parts.length < 3) { console.log('Usage: clear <function> <line>'); break }
        const fn = parts[1]; const line = parseInt(parts[2])
        this.send({ type: 'clearBreakpoint', function: fn, line })
        console.log(`Breakpoint cleared: ${fn}:${line}`)
        break
      }

      case 'clearall':
        this.send({ type: 'clearAllBreakpoints' })
        console.log('All breakpoints cleared.')
        break

      case 'continue':
      case 'c':
        this.send({ type: 'continue' })
        this.paused = false
        break

      case 'step':
      case 's':
        this.send({ type: 'step' })
        this.paused = false
        break

      case 'status':
        console.log(`Connected: ${this.connected}`)
        console.log(`Paused:    ${this.paused}`)
        if (this.currentLocation) {
          console.log(`Location:  ${this.currentLocation.function}:${this.currentLocation.line}`)
        }
        break

      case 'quit':
      case 'q':
        console.log('Bye.')
        process.exit(0)
        break

      default:
        console.log(`Unknown command: ${cmd}. Type "help" for help.`)
    }
  }

  run() {
    this.rl.on('line', (line) => {
      this.handleCommand(line)
      this.rl.prompt()
    })

    this.rl.on('close', () => {
      console.log('\nBye.')
      process.exit(0)
    })

    this.connect(SERVER_HOST, CLIENT_PORT)
  }
}

new MdbClient().run()
