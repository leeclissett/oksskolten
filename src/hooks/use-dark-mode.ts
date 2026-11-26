import { useEffect, useSyncExternalStore } from 'react'

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function subscribeSystemDark(callback: () => void) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

/** Light or dark, following the device's colour scheme. */
export function useDarkMode() {
  const isDark = useSyncExternalStore(subscribeSystemDark, getSystemDark)

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    root.style.colorScheme = isDark ? 'dark' : 'light'
  }, [isDark])

  return { isDark }
}
