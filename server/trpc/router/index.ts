import { router } from '../trpc.js'
import { githubRouter } from './github.js'
import { folderRouter } from './folder.js'
import { statsRouter } from './stats.js'

export const appRouter = router({
  github: githubRouter,
  folder: folderRouter,
  stats:  statsRouter,
})

export type AppRouter = typeof appRouter
