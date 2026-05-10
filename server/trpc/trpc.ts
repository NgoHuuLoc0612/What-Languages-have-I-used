import { initTRPC, TRPCError } from '@trpc/server'
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { db } from '../db/index.js'
import superjson from 'superjson'

// ─── Context ──────────────────────────────────────────────────────────────────
export async function createContext({ req, res }: CreateFastifyContextOptions) {
  return { req, res, db }
}

export type Context = Awaited<ReturnType<typeof createContext>>

// ─── tRPC init ────────────────────────────────────────────────────────────────
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof Error && 'flatten' in error.cause
            ? (error.cause as any).flatten()
            : null,
      },
    }
  },
})

export const router    = t.router
export const procedure = t.procedure
export const middleware = t.middleware

// ─── Logging middleware ───────────────────────────────────────────────────────
const loggerMiddleware = middleware(async ({ path, type, next }) => {
  const start  = Date.now()
  const result = await next()
  const ms     = Date.now() - start
  const status = result.ok ? 'OK' : 'ERR'
  console.log(`[trpc] ${type} ${path} — ${status} ${ms}ms`)
  return result
})

export const loggedProcedure = procedure.use(loggerMiddleware)
