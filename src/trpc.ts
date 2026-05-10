import { createTRPCReact } from '@trpc/react-query'
import { createTRPCProxyClient, httpBatchLink, loggerLink } from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from '../server/types'

export const trpc = createTRPCReact<AppRouter>()

export function getTrpcClient() {
  return trpc.createClient({
    transformer: superjson,
    links: [
      loggerLink({
        enabled: (opts) =>
          process.env.NODE_ENV === 'development' &&
          (opts.direction === 'down' && opts.result instanceof Error),
      }),
      httpBatchLink({
        url: '/trpc',
      }),
    ],
  })
}

// Vanilla client for one-off calls outside React
export const trpcVanilla = createTRPCProxyClient<AppRouter>({
  transformer: superjson,
  links: [
    httpBatchLink({ url: '/trpc' }),
  ],
})
