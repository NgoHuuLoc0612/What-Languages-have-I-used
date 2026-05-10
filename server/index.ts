import Fastify from 'fastify'
import cors from '@fastify/cors'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './trpc/router/index.js'
import { createContext } from './trpc/trpc.js'
import { initDb } from './db/index.js'

// pino-pretty is optional - use it if available, fallback to stdout JSON
let loggerConfig: boolean | object = true
try {
  await import('pino-pretty')
  loggerConfig = {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l' },
    },
  }
} catch {
  // pino-pretty not installed, use default pino logger
}

const server = Fastify({
  logger: loggerConfig,
  maxParamLength: 5000,
  bodyLimit: 200 * 1024 * 1024, // 200MB - allow large file lists
})

// ── CORS ──────────────────────────────────────────────────────────────────────
await server.register(cors, {
  origin: ['http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
})

// ── tRPC ──────────────────────────────────────────────────────────────────────
await server.register(fastifyTRPCPlugin, {
  prefix:     '/trpc',
  trpcOptions: {
    router:         appRouter,
    createContext,
    onError: ({ path, error }: { path?: string; error: Error }) => {
      console.error(`[trpc] Error on ${path}:`, error.message)
    },
  },
})

// ── Health check ──────────────────────────────────────────────────────────────
server.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }))

// ── Startup ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3001', 10)
const HOST = process.env.HOST ?? '0.0.0.0'

initDb()

try {
  await server.listen({ port: PORT, host: HOST })
  console.log(`\n  🌐 API server  → http://localhost:${PORT}`)
  console.log(`  🔗 tRPC       → http://localhost:${PORT}/trpc`)
  console.log(`  ✅ Ready!\n`)
} catch (err) {
  server.log.error(err)
  process.exit(1)
}
