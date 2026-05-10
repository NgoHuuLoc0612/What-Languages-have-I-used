import React, { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { trpc, getTrpcClient } from './trpc'
import { useStore } from './store/useStore'
import Sidebar         from './components/Layout/Sidebar'
import Home            from './components/Dashboard/Home'
import Dashboard       from './components/Dashboard/Dashboard'
import ScanHistory     from './components/Dashboard/ScanHistory'
import CompareScans    from './components/Dashboard/CompareScans'
import GitHubMode      from './components/GitHubMode/GitHubMode'
import FolderMode      from './components/FolderMode/FolderMode'
import ToastContainer  from './components/common/Toast'
import './styles/main.scss'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:              1,
      staleTime:          30_000,
      refetchOnWindowFocus: false,
    },
  },
})

const trpcClient = getTrpcClient()

function AppContent() {
  const { view, theme } = useStore()

  // Apply theme class to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const renderView = () => {
    switch (view) {
      case 'home':      return <Home />
      case 'github':    return <GitHubMode />
      case 'folder':    return <FolderMode />
      case 'dashboard': return <Dashboard />
      case 'history':   return <ScanHistory />
      case 'compare':   return <CompareScans />
      default:          return <Home />
    }
  }

  return (
    <div className="app">
      <Sidebar />
      <main className="main-content">
        <div className="main-content__inner">
          {renderView()}
        </div>
      </main>
      <ToastContainer />
    </div>
  )
}

export default function App() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </trpc.Provider>
  )
}
