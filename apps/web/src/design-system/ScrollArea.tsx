import { useEffect, useState, type ComponentProps } from 'react'
import { cn } from './cn'

/**
 * A scrolling box that fades at the edge that has more to show, so a bar is not needed to tell.
 * The fade follows the scroll position; it is only paint, so clicks, focus and screen readers are unaffected.
 */
export function ScrollArea({ axis = 'y', as = 'div', className, ...props }: ComponentProps<'div'> & { axis?: 'x' | 'y'; as?: 'div' | 'ul' | 'fieldset' }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!el) return
    const FADE = 20
    const update = () => {
      const pos = axis === 'y' ? el.scrollTop : el.scrollLeft
      const size = axis === 'y' ? el.clientHeight : el.clientWidth
      const total = axis === 'y' ? el.scrollHeight : el.scrollWidth
      const before = pos > 1
      const after = pos + size < total - 1
      el.style.setProperty('--fade-a', before ? `${FADE}px` : '0px')
      el.style.setProperty('--fade-b', after ? `${FADE}px` : '0px')
      if (before || after) el.setAttribute('data-fading', '')
      else el.removeAttribute('data-fading')
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
      mo.disconnect()
    }
  }, [axis, el])
  const common = { 'data-fade': axis, className: cn(axis === 'y' ? 'overflow-y-auto' : 'overflow-x-auto', className), ...props }
  if (as === 'ul') return <ul ref={setEl} {...(common as ComponentProps<'ul'>)} />
  if (as === 'fieldset') return <fieldset ref={setEl} {...(common as ComponentProps<'fieldset'>)} />
  return <div ref={setEl} {...common} />
}
