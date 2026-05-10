// This file exports only types — safe for frontend to import
// Do NOT add any runtime imports here (no better-sqlite3, etc.)
import type { appRouter } from './trpc/router/index.js'

export type AppRouter = typeof appRouter
