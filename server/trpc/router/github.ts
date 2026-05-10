import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, loggedProcedure } from '../trpc.js'
import { GitHubClient, GitHubError } from '../../lib/githubApi.js'
import { DEFAULT_EXCLUDES } from '../../lib/languageDetector.js'
import { scans, githubTokens } from '../../db/schema.js'
import { db } from '../../db/index.js'
import { eq, desc } from 'drizzle-orm'
import { runScan } from '../../lib/scanPipeline.js'

// ─── Token management ─────────────────────────────────────────────────────────
export const githubRouter = router({

  saveToken: loggedProcedure
    .input(z.object({
      label: z.string().min(1).max(64),
      token: z.string().regex(/^gh[ps]_[A-Za-z0-9]+$|^github_pat_[A-Za-z0-9_]+$/, 'Invalid GitHub token format'),
    }))
    .mutation(async ({ input }) => {
      const client = new GitHubClient(input.token)
      let username = 'unknown'
      let scopes   = ''

      try {
        const auth = await client.getAuthUser()
        username = auth.login
        scopes   = auth.scopes
      } catch (e) {
        if (e instanceof GitHubError && e.isUnauthorized) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Token is invalid or expired.' })
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: String(e) })
      }

      const rate = await client.getRateLimit()

      const [saved] = await db.insert(githubTokens).values({
        label:     input.label,
        token:     input.token,
        username,
        scopes,
        rateLimit: rate.remaining,
      }).returning()

      return { id: saved.id, username, scopes, rateLimit: rate }
    }),

  listTokens: loggedProcedure.query(async () => {
    return db.select({
      id:        githubTokens.id,
      label:     githubTokens.label,
      username:  githubTokens.username,
      scopes:    githubTokens.scopes,
      rateLimit: githubTokens.rateLimit,
      createdAt: githubTokens.createdAt,
      lastUsed:  githubTokens.lastUsed,
    }).from(githubTokens).orderBy(desc(githubTokens.createdAt))
  }),

  deleteToken: loggedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(githubTokens).where(eq(githubTokens.id, input.id))
      return { ok: true }
    }),

  getRateLimit: loggedProcedure
    .input(z.object({ tokenId: z.number() }))
    .query(async ({ input }) => {
      const [tok] = await db.select().from(githubTokens).where(eq(githubTokens.id, input.tokenId))
      if (!tok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Token not found' })
      return new GitHubClient(tok.token).getRateLimit()
    }),

  searchRepos: loggedProcedure
    .input(z.object({ tokenId: z.number(), query: z.string().min(1) }))
    .query(async ({ input }) => {
      const [tok] = await db.select().from(githubTokens).where(eq(githubTokens.id, input.tokenId))
      if (!tok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Token not found' })
      return new GitHubClient(tok.token).searchRepos(input.query)
    }),

  listMyRepos: loggedProcedure
    .input(z.object({ tokenId: z.number(), page: z.number().default(1) }))
    .query(async ({ input }) => {
      const [tok] = await db.select().from(githubTokens).where(eq(githubTokens.id, input.tokenId))
      if (!tok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Token not found' })
      return new GitHubClient(tok.token).listUserRepos(input.page, 30)
    }),

  // ── Create scan record (lightweight — just inserts a row) ─────────────────
  createScan: loggedProcedure
    .input(z.object({
      name:            z.string().min(1).max(128).default('GitHub Scan'),
      tokenId:         z.number(),
      repoRefs:        z.array(z.string()).min(1).max(50),
      excludePatterns: z.array(z.string()).default(DEFAULT_EXCLUDES),
    }))
    .mutation(async ({ input }) => {
      const [tok] = await db.select().from(githubTokens).where(eq(githubTokens.id, input.tokenId))
      if (!tok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Token not found' })

      const [scan] = await db.insert(scans).values({
        name:   input.name,
        mode:   'github',
        status: 'pending',
        meta:   JSON.stringify({
          tokenId:  input.tokenId,
          repoRefs: input.repoRefs,
        }),
      }).returning()

      return { scanId: scan.id }
    }),

  // ── Execute scan — delegates to scanPipeline ──────────────────────────────
  executeScan: loggedProcedure
    .input(z.object({
      scanId:          z.number(),
      excludePatterns: z.array(z.string()).default(DEFAULT_EXCLUDES),
    }))
    .mutation(async ({ input }) => {
      const [scan] = await db.select().from(scans).where(eq(scans.id, input.scanId))
      if (!scan) throw new TRPCError({ code: 'NOT_FOUND', message: 'Scan not found' })

      const meta = JSON.parse(scan.meta ?? '{}') as { tokenId: number; repoRefs: string[] }
      const [tok] = await db.select().from(githubTokens).where(eq(githubTokens.id, meta.tokenId))
      if (!tok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Token not found' })

      try {
        const result = await runScan({
          scanId:          input.scanId,
          token:           tok.token,
          repoRefs:        meta.repoRefs,
          excludePatterns: input.excludePatterns,
          onProgress: (update) => {
            // Log progress — swap this out for SSE/WebSocket push if you add streaming
            console.log(
              `[scan:${input.scanId}] ${update.reposDone}/${update.reposTotal} repos | ` +
              `${update.filesScanned} files | ${update.phase} | ${update.currentRepo}`
            )
          },
        })

        // Update token last-used timestamp
        await db.update(githubTokens)
          .set({ lastUsed: new Date() })
          .where(eq(githubTokens.id, tok.id))

        return { ok: true, ...result }

      } catch (err) {
        throw new TRPCError({
          code:    'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }),
})
