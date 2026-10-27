import { createContext, useCallback, useEffect, useState } from 'react'

/** How much of the left menu shows: full, an icon rail, or nothing. */
export type SidebarState = 'expanded' | 'collapsed' | 'hidden'

export const SIDEBAR_KEY = 'tableui.sidebar'
const STATES: SidebarState[] = ['expanded', 'collapsed', 'hidden']

/** Ctrl+B steps through the states: full, rail, hidden, and back to full. */
export const nextSidebar = (s: SidebarState): SidebarState => STATES[(STATES.indexOf(s) + 1) % STATES.length]!

/** What the person chose last time, or null when nothing is saved or storage is blocked. */
export function savedSidebar(): SidebarState | null {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY)
    return STATES.includes(v as SidebarState) ? (v as SidebarState) : null
  } catch {
    return null
  }
}

/** Medium screens (768 to 1023px) start with the rail unless the person chose otherwise. */
export const startingSidebar = (width: number, saved: SidebarState | null): SidebarState =>
  saved ?? (width >= 768 && width < 1024 ? 'collapsed' : 'expanded')

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** True from 768px up, where the sidebar sits beside the page instead of opening over it. */
export function useDesktop(): boolean {
  const q = '(min-width: 768px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/** The sidebar state, remembered in the browser, plus a full-screen mode that hides the frame without changing the saved choice. */
export function useSidebar() {
  const [state, setState] = useState<SidebarState>(() => startingSidebar(window.innerWidth, savedSidebar()))
  const [fullScreen, setFullScreen] = useState(false)
  const choose = useCallback((s: SidebarState) => {
    setState(s)
    try {
      localStorage.setItem(SIDEBAR_KEY, s)
    } catch {
      /* private mode: the choice just lasts for this visit */
    }
  }, [])
  const step = useCallback(() => choose(nextSidebar(state)), [choose, state])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b' && !typing(e.target)) {
        e.preventDefault()
        step()
      } else if (e.key === 'Escape' && fullScreen) {
        setFullScreen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, fullScreen])
  return { state, choose, step, fullScreen, setFullScreen }
}

/** Lets a page ask the shell for full screen (a table that wants the whole width). Null outside the shell. */
export const FullScreenContext = createContext<{ fullScreen: boolean; setFullScreen: (on: boolean) => void } | null>(null)
