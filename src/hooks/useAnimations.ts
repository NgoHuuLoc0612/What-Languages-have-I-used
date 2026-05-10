import { useEffect, useRef } from 'react'
import gsap from 'gsap'

// Stagger fade-in for list items
export function useStaggerIn(deps: unknown[] = [], options?: gsap.TweenVars) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const children = Array.from(ref.current.children)
    if (children.length === 0) return

    gsap.fromTo(
      children,
      { opacity: 0, y: 20, scale: 0.97 },
      {
        opacity:  1,
        y:        0,
        scale:    1,
        duration: 0.45,
        stagger:  0.06,
        ease:     'power3.out',
        clearProps: 'transform',
        ...options,
      }
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref as React.RefObject<HTMLElement>
}

// Slide-in from side
export function useSlideIn(direction: 'left' | 'right' | 'up' | 'down' = 'up', deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const xFrom = direction === 'left' ? -40 : direction === 'right' ? 40 : 0
    const yFrom = direction === 'up'   ? 30  : direction === 'down'  ? -30 : 0

    gsap.fromTo(
      ref.current,
      { opacity: 0, x: xFrom, y: yFrom },
      { opacity: 1, x: 0, y: 0, duration: 0.5, ease: 'power3.out', clearProps: 'transform' }
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}

// Counter animation (numbers count up)
export function useCountUp(value: number, duration = 1.2, deps: unknown[] = []) {
  const ref     = useRef<HTMLElement>(null)
  const counter = useRef({ val: 0 })

  useEffect(() => {
    if (!ref.current || value === 0) return
    const el = ref.current

    gsap.to(counter.current, {
      val:      value,
      duration,
      ease:     'power2.out',
      onUpdate: () => {
        el.textContent = Math.round(counter.current.val).toLocaleString()
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ...deps])

  return ref
}

// Pulse highlight (for new items)
export function usePulse(active: boolean) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!ref.current || !active) return
    const tl = gsap.timeline()
    tl.to(ref.current, { scale: 1.02, duration: 0.15, ease: 'power2.out' })
      .to(ref.current, { scale: 1,    duration: 0.2,  ease: 'bounce.out' })
  }, [active])

  return ref
}

// Progress bar animation
export function useProgressBar(value: number) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!ref.current) return
    gsap.to(ref.current, {
      width:    `${value}%`,
      duration: 0.8,
      ease:     'power2.out',
    })
  }, [value])

  return ref
}

// Typewriter effect
export function useTypewriter(text: string, speed = 30) {
  const ref   = useRef<HTMLElement>(null)
  const chars = useRef(0)

  useEffect(() => {
    if (!ref.current) return
    chars.current = 0
    const el = ref.current
    el.textContent = ''

    const interval = setInterval(() => {
      chars.current++
      el.textContent = text.slice(0, chars.current)
      if (chars.current >= text.length) clearInterval(interval)
    }, speed)

    return () => clearInterval(interval)
  }, [text, speed])

  return ref
}

// Floating entrance for cards
export function useCardEntrance(index = 0) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 30, rotateX: -8 },
      {
        opacity:  1,
        y:        0,
        rotateX:  0,
        duration: 0.5,
        delay:    index * 0.08,
        ease:     'back.out(1.4)',
        clearProps: 'transform',
      }
    )
  }, [index])

  return ref
}

// Shake animation (for errors)
export function useShake() {
  const ref = useRef<HTMLElement>(null)

  const shake = () => {
    if (!ref.current) return
    gsap.fromTo(
      ref.current,
      { x: 0 },
      {
        x:        [-8, 8, -6, 6, -4, 4, 0],
        duration: 0.5,
        ease:     'none',
        clearProps: 'transform',
      }
    )
  }

  return { ref, shake }
}
