import { create } from 'zustand'
import { persist, devtools } from 'zustand/middleware'

export type AppMode = 'github' | 'folder'
export type AppView = 'home' | 'github' | 'folder' | 'dashboard' | 'history' | 'compare'

export interface ScanSummary {
  id:         number
  name:       string
  mode:       AppMode
  status:     string
  totalFiles: number
  totalBytes: number
  createdAt:  Date
}

export interface ActiveScan {
  scanId:    number
  name:      string
  mode:      AppMode
  status:    'pending' | 'running' | 'done' | 'error'
  progress:  number  // 0-100
  message:   string
}

interface AppState {
  // Navigation
  view:          AppView
  setView:       (v: AppView) => void

  // Active mode
  mode:          AppMode
  setMode:       (m: AppMode) => void

  // Sidebar
  sidebarOpen:   boolean
  setSidebar:    (v: boolean) => void

  // Selected scan for dashboard
  activeScanId:  number | null
  setActiveScan: (id: number | null) => void

  // Active scan execution status
  activeScan:    ActiveScan | null
  setActiveScan2: (s: ActiveScan | null) => void
  updateScanProgress: (progress: number, message: string) => void

  // Compare mode
  compareScanIds: [number | null, number | null]
  setCompareScan: (slot: 0 | 1, id: number | null) => void

  // Token management
  activeTokenId: number | null
  setActiveToken: (id: number | null) => void

  // Dashboard filters
  dashboardLangType: 'all' | 'programming' | 'markup' | 'data' | 'prose'
  setDashboardLangType: (t: AppState['dashboardLangType']) => void

  // Folder mode state
  folderFiles: Array<{ path: string; name: string; size: number; extension: string }>
  setFolderFiles: (files: AppState['folderFiles']) => void
  clearFolderFiles: () => void
  includePatterns: string[]
  excludePatterns: string[]
  setIncludePatterns: (p: string[]) => void
  setExcludePatterns: (p: string[]) => void

  // GitHub mode state
  repoInputs:    string[]
  setRepoInputs: (repos: string[]) => void
  addRepoInput:  (repo: string) => void
  removeRepoInput: (i: number) => void

  // Toast notifications
  toasts:       Toast[]
  addToast:     (t: Omit<Toast, 'id'>) => void
  removeToast:  (id: string) => void

  // Theme
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

export interface Toast {
  id:      string
  type:    'success' | 'error' | 'info' | 'warning'
  title:   string
  message?: string
  duration?: number
}

let toastId = 0

export const useStore = create<AppState>()(
  devtools(
    persist(
      (set, get) => ({
        // Navigation
        view:    'home',
        setView: (v) => set({ view: v }),

        // Mode
        mode:    'github',
        setMode: (m) => set({ mode: m }),

        // Sidebar
        sidebarOpen:  true,
        setSidebar:   (v) => set({ sidebarOpen: v }),

        // Selected scan
        activeScanId:  null,
        setActiveScan: (id) => set({ activeScanId: id, view: id ? 'dashboard' : get().view }),

        // Active execution
        activeScan:    null,
        setActiveScan2: (s) => set({ activeScan: s }),
        updateScanProgress: (progress, message) =>
          set(s => ({
            activeScan: s.activeScan ? { ...s.activeScan, progress, message } : null,
          })),

        // Compare
        compareScanIds:  [null, null],
        setCompareScan:  (slot, id) =>
          set(s => {
            const ids = [...s.compareScanIds] as [number | null, number | null]
            ids[slot] = id
            return { compareScanIds: ids }
          }),

        // Token
        activeTokenId:  null,
        setActiveToken: (id) => set({ activeTokenId: id }),

        // Filters
        dashboardLangType: 'all',
        setDashboardLangType: (t) => set({ dashboardLangType: t }),

        // Folder files
        folderFiles:    [],
        setFolderFiles: (files) => set({ folderFiles: files }),
        clearFolderFiles: () => set({ folderFiles: [] }),
        includePatterns: ['**/*'],
        excludePatterns: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
        ],
        setIncludePatterns: (p) => set({ includePatterns: p }),
        setExcludePatterns: (p) => set({ excludePatterns: p }),

        // GitHub
        repoInputs:     [''],
        setRepoInputs:  (repos) => set({ repoInputs: repos }),
        addRepoInput:   (repo) => set(s => ({ repoInputs: [...s.repoInputs, repo] })),
        removeRepoInput: (i) => set(s => ({
          repoInputs: s.repoInputs.filter((_, idx) => idx !== i),
        })),

        // Toasts
        toasts:      [],
        addToast:    (t) => {
          const id = String(++toastId)
          set(s => ({ toasts: [...s.toasts, { ...t, id }] }))
          const dur = t.duration ?? 4000
          if (dur > 0) setTimeout(() => get().removeToast(id), dur)
        },
        removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

        // Theme
        theme:       'dark',
        toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      }),
      {
        name: 'what-languages-have-i-used-state',
        partialize: (state) => ({
          theme:          state.theme,
          activeTokenId:  state.activeTokenId,
          sidebarOpen:    state.sidebarOpen,
          includePatterns: state.includePatterns,
          excludePatterns: state.excludePatterns,
        }),
      }
    ),
    { name: 'WhatLanguagesHaveIUsed' }
  )
)