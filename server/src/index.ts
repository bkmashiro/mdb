import { DebugServer } from './DebugServer'

const PLUGIN_PORT = parseInt(process.env.PLUGIN_PORT ?? '2525')
const CLIENT_PORT = parseInt(process.env.CLIENT_PORT ?? '2526')

const server = new DebugServer(PLUGIN_PORT, CLIENT_PORT)
server.start()

console.log(`[mdb-server] Plugin endpoint: ws://localhost:${PLUGIN_PORT}/plugin`)
console.log(`[mdb-server] Client endpoint: ws://localhost:${CLIENT_PORT}/client`)

process.on('SIGINT', () => {
  console.log('\n[mdb-server] Shutting down...')
  server.stop()
  process.exit(0)
})
