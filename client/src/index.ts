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
  private callStack: Array<{ function: string; line: number }> = []

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
      console.log('[mdb] Connected. Type "help" for commands.\n')
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
      console.log('\n[mdb] Disconnected.')
      process.exit(0)
    })

    this.ws.on('error', (err) => {
      console.error(`[mdb] Error: ${err.message}`)
      console.error(`[mdb] Is the debug server running? cd server && node dist/index.js`)
      process.exit(1)
    })
  }

  private handleServerMessage(msg: any) {
    switch (msg.type) {
      case 'hello':
        console.log(`[mdb] Plugin: ${msg.pluginConnected ? '✓ connected' : '✗ not connected'}`)
        if (msg.breakpoints?.length > 0) console.log(`[mdb] Breakpoints: ${msg.breakpoints.length}`)
        break

      case 'pluginDisconnected':
        console.log('[mdb] ⚠ Plugin disconnected')
        break

      case 'functionEnter':
        // Quiet — call stack is shown on 'stopped'
        break

      case 'functionExit':
        break

      case 'stopped': {
        this.paused = true
        this.currentLocation = msg.location
        this.callStack = msg.stack ?? []
        const loc = msg.location
        const reason = msg.reason === 'watch' ? `⚡ watch` : msg.reason === 'step' ? '→ step' : '⏸ breakpoint'
        console.log(`\n${reason}  ${loc.function}:${loc.line}`)
        console.log(`   ${loc.command}`)
        // Show call stack if depth > 1
        if (this.callStack.length > 1) {
          console.log('   Stack:')
          this.callStack.forEach((f, i) => {
            const marker = i === 0 ? '→' : ' '
            console.log(`     ${marker} ${f.function}:${f.line}`)
          })
        }
        this.rl.prompt()
        break
      }

      case 'watchHit': {
        // watchHit is handled as part of 'stopped' now, but keep for legacy
        const old = msg.oldValue !== null ? String(msg.oldValue) : 'unset'
        const nv  = msg.newValue !== null ? String(msg.newValue) : 'unset'
        console.log(`\n⚡ Watch: ${msg.watch} changed ${old} → ${nv}`)
        this.rl.prompt()
        break
      }

      case 'printResult': {
        if (msg.error) {
          console.log(`\n  [print] Error: ${msg.error}`)
        } else if (msg.entry !== undefined) {
          console.log(`\n  ${msg.objective}[${msg.entry}] = ${msg.value ?? '(not set)'}`)
        } else {
          const scores = msg.scores as Record<string, number>
          const entries = Object.entries(scores).sort(([a], [b]) => a.localeCompare(b))
          if (entries.length === 0) {
            console.log(`\n  ${msg.objective}: (empty)`)
          } else {
            console.log(`\n  ${msg.objective}:`)
            entries.forEach(([k, v]) => console.log(`    ${k.padEnd(36)} ${v}`))
          }
        }
        this.rl.prompt()
        break
      }

      case 'objectives': {
        const objs = msg.objectives as string[]
        console.log(`\n  Objectives (${objs.length}):`)
        objs.forEach(o => console.log(`    ${o}`))
        this.rl.prompt()
        break
      }

      case 'storageResult': {
        if (msg.error) {
          console.log(`\n  [storage] Error: ${msg.error}`)
        } else {
          const pathStr = msg.path ? `.${msg.path}` : ''
          console.log(`\n  ${msg.id}${pathStr}:`)
          // Pretty-print SNBT
          console.log('  ' + (msg.value ?? '(empty)').replace(/,/g, ',\n  '))
        }
        this.rl.prompt()
        break
      }

      case 'storageList': {
        if (msg.error) {
          console.log(`\n  [storage] Error: ${msg.error}`)
        } else {
          const keys = msg.keys as string[]
          console.log(`\n  Storage keys (${keys.length}):`)
          keys.forEach(k => console.log(`    ${k}`))
        }
        this.rl.prompt()
        break
      }

      default:
        // Unknown — show raw JSON quietly
        if (!['functionEnter','functionExit'].includes(msg.type)) {
          console.log('\n[event]', JSON.stringify(msg))
          this.rl.prompt()
        }
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
  break / b  <fn> <line>    Set breakpoint      break my_pack:combat/tick 5
  clear      <fn> <line>    Clear breakpoint
  clearall                  Clear all breakpoints
  continue / c              Resume execution
  step / s                  Step one command
  bt                        Print call stack
  print / p  <obj> [entry]  Read scoreboard     print mdb_test \\$x
  watch / w  <obj> <entry>  Watch for changes   watch mdb_test \\$x
  unwatch    <obj> <entry>  Remove watch
  unwatchall                Remove all watches
  storage / nbt <id> [path] Read NBT storage   storage my_pack:data foo.bar
  storage list              List all storage namespaces
  objectives / obj          List objectives
  status                    Connection status
  quit / q                  Exit
`)
        break

      case 'break': case 'b': {
        if (parts.length < 3) { console.log('Usage: break <function> <line>'); break }
        const fn = parts[1]; const lineNum = parseInt(parts[2])
        if (isNaN(lineNum)) { console.log('Line must be a number'); break }
        this.send({ type: 'setBreakpoint', function: fn, line: lineNum })
        console.log(`Breakpoint set: ${fn}:${lineNum}`)
        break
      }

      case 'clear': {
        if (parts.length < 3) { console.log('Usage: clear <fn> <line>'); break }
        const fn = parts[1]; const lineNum = parseInt(parts[2])
        this.send({ type: 'clearBreakpoint', function: fn, line: lineNum })
        console.log(`Cleared: ${fn}:${lineNum}`)
        break
      }

      case 'clearall':
        this.send({ type: 'clearAllBreakpoints' })
        console.log('All breakpoints cleared.')
        break

      case 'continue': case 'c':
        this.send({ type: 'continue' })
        this.paused = false
        break

      case 'step': case 's':
        this.send({ type: 'step' })
        this.paused = false
        break

      case 'bt': {
        if (this.callStack.length === 0) {
          console.log('Not paused / no stack info.')
        } else {
          console.log('Call stack:')
          this.callStack.forEach((f, i) => {
            const marker = i === 0 ? '#0 (current)' : `#${i}`
            console.log(`  ${marker.padEnd(14)} ${f.function}:${f.line}`)
          })
        }
        break
      }

      case 'print': case 'p': {
        if (parts.length < 2) { console.log('Usage: print <objective> [entry]'); break }
        const msg: any = { type: 'print', objective: parts[1] }
        if (parts[2]) msg.entry = parts[2]
        this.send(msg)
        break
      }

      case 'watch': case 'w': {
        if (parts.length < 3) { console.log('Usage: watch <objective> <entry>'); break }
        this.send({ type: 'watch', objective: parts[1], entry: parts[2] })
        console.log(`Watch set: ${parts[1]}[${parts[2]}]`)
        break
      }

      case 'unwatch': {
        if (parts.length < 3) { console.log('Usage: unwatch <objective> <entry>'); break }
        this.send({ type: 'unwatch', objective: parts[1], entry: parts[2] })
        console.log(`Watch removed: ${parts[1]}[${parts[2]}]`)
        break
      }

      case 'unwatchall':
        this.send({ type: 'unwatchAll' })
        console.log('All watches removed.')
        break

      case 'objectives': case 'obj':
        this.send({ type: 'listObjectives' })
        break

      case 'storage': case 'nbt': {
        // storage <id> [path]     e.g. storage my_pack:data player.health
        // storage list            list all storage keys
        if (parts[1] === 'list' || parts[1] === 'ls') {
          this.send({ type: 'listStorage' })
        } else if (parts.length < 2) {
          console.log('Usage: storage <namespace:key> [path]  |  storage list')
        } else {
          const msg: any = { type: 'storage', id: parts[1] }
          if (parts[2]) msg.path = parts.slice(2).join('.')
          this.send(msg)
        }
        break
      }

      case 'status':
        console.log(`Connected: ${this.connected}`)
        console.log(`Paused:    ${this.paused}`)
        if (this.currentLocation) {
          console.log(`At:        ${this.currentLocation.function}:${this.currentLocation.line}`)
        }
        if (this.callStack.length > 0) {
          console.log(`Stack depth: ${this.callStack.length}`)
        }
        break

      case 'quit': case 'q':
        console.log('Bye.')
        process.exit(0)
        break

      default:
        console.log(`Unknown: ${cmd}. Type "help".`)
    }
  }

  run() {
    this.rl.on('line', (line) => {
      this.handleCommand(line)
      this.rl.prompt()
    })
    this.rl.on('close', () => { console.log('\nBye.'); process.exit(0) })
    this.connect(SERVER_HOST, CLIENT_PORT)
  }
}

new MdbClient().run()
