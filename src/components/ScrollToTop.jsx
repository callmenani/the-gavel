import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

export default function ScrollToTop() {
  const { pathname } = useLocation()
  const previousPathname = useRef(null)

  useEffect(() => {
    const isPlayHubPath = (path) =>
      path === '/' ||
      path === '/play' ||
      path === '/play/join' ||
      path === '/play/history'

    if (!isPlayHubPath(previousPathname.current) || !isPlayHubPath(pathname)) {
      window.scrollTo(0, 0)
    }

    previousPathname.current = pathname
  }, [pathname])

  return null
}
