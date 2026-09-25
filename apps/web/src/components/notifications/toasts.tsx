"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Button, cn } from '@agent-hub/ui'
import {
  TOAST_DISMISS_EVENT,
  TOAST_EVENT,
  type ToastAction,
  type ToastNote,
  type ToastStatus,
} from '@/lib/toast-events'
const LIFETIME = 2400

const ACTION_LIFETIME = 6000
const GAP = 8

const PEEK = 10
const SHRINK = 0.03
const DEPTH = 3
const FADE = 0.15
const REACH = 10

const UNCAPPED = 10000

const SWIPE = 44
const FLICK = 380
const MORPH = { type: 'spring', duration: 0.3, bounce: 0 } as const

const EXIT = { type: 'spring', duration: 0.2, bounce: 0 } as const

export const LINE_HEIGHT = 36

const TEXT_LINE = 20

export type ToastSide = 'top' | 'bottom'
export type ToastAlign = 'left' | 'center' | 'right'
export type ToastPosition = `${ToastSide}-${ToastAlign}`
export const toastPositions = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const satisfies readonly ToastPosition[]

const ALIGN: Record<ToastAlign, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
}

export type ToastState = ToastStatus
export type { ToastAction, ToastInput, ToastNote as Note } from '@/lib/toast-events'
export type ToastClock = { waits: Map<string, number>; since: number | null }
export type StackSlot = { y: number; scale: number; opacity: number }
export type StackCard = {
  id: string
  render: (behind: boolean) => ReactNode
}

export { dismissToast } from '@/lib/toast-events'

export function upsertToast(notes: readonly ToastNote[], note: ToastNote): ToastNote[] {
  const index = notes.findIndex((item) => item.id === note.id)
  return index === -1 ? [note, ...notes] : notes.map((item, at) => (at === index ? note : item))
}

export function dismissDelay(
  state: ToastState | undefined,
  hasAction: boolean,
  lifetime?: number,
): number | null {

  if (state === 'pending') return null
  if (lifetime !== undefined) return lifetime
  return hasAction ? ACTION_LIFETIME : LIFETIME
}

export function tick(clock: ToastClock, at: number) {
  if (clock.since === null) return

  const spent = at - clock.since
  clock.since = at
  for (const [id, left] of clock.waits) clock.waits.set(id, left - spent)
}

export function pileSlot(index: number): StackSlot {
  const depth = Math.min(index, DEPTH - 1)
  return {
    y: depth * PEEK,
    scale: 1 - depth * SHRINK,
    opacity: index < DEPTH ? 1 - depth * FADE : 0,
  }
}

export function fanSlot(index: number, heights: readonly number[]): StackSlot {
  let y = 0
  for (let at = 0; at < index; at++) y += (heights[at] ?? LINE_HEIGHT) + GAP
  return { y, scale: 1, opacity: 1 }
}

const TONE_INK: Record<Exclude<ToastState, 'pending' | 'success'>, string> = {
  error: 'text-destructive',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-primary',
}

function ToastGlyph({ state }: { state: ToastState }) {
  switch (state) {
    case 'pending':
      return <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
    case 'success':
      return <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
    case 'error':
      return <OctagonXIcon className={cn('size-4', TONE_INK[state])} aria-hidden />
    case 'warning':
      return <TriangleAlertIcon className={cn('size-4', TONE_INK[state])} aria-hidden />
    case 'info':
      return <InfoIcon className={cn('size-4', TONE_INK[state])} aria-hidden />
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

const GLYPH_POP = {
  initial: { opacity: 0, scale: 0.25, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.25, filter: 'blur(4px)', transition: EXIT },
} as const

const TEXT_SLIDE = {
  initial: { opacity: 0, x: -6 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -6, transition: EXIT },
} as const

function ToastLine({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ width: 0 }}
      animate={{ width: 'auto' }}
      exit={{ width: 0 }}
      transition={MORPH}
      className="flex items-center overflow-hidden"
    >
      <motion.span {...TEXT_SLIDE} transition={MORPH} className="w-max max-w-lg shrink-0 truncate">
        {message}
      </motion.span>
    </motion.div>
  )
}

const glyphKey = (state: ToastState) =>
  state === 'pending' || state === 'success' ? 'badge' : state

function ToastPill({
  state,
  message,
  action,
  onAction,
  onDismiss,
  behind,
}: {
  state?: ToastState
  message: string
  action?: ToastAction
  onAction: () => void
  onDismiss: () => void
  behind: boolean
}) {
  const pill = useRef<HTMLDivElement>(null)
  return (
    <motion.div
      ref={pill}
      style={{ borderRadius: 9999 }}

      drag={behind ? false : true}
      dragSnapToOrigin
      dragElastic={0.6}
      dragMomentum={false}
      dragTransition={{ bounceStiffness: 520, bounceDamping: 42 }}
      onDragEnd={(_, info) => {

        const far = Math.hypot(info.offset.x, info.offset.y) > SWIPE
        const fast = Math.hypot(info.velocity.x, info.velocity.y) > FLICK
        if (!far && !fast) return

        const element = pill.current
        if (!element) return onDismiss()
        const animation = element.animate(
          [
            { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
            { opacity: 0, filter: 'blur(8px)', transform: 'scale(0.92)' },
          ],
          { duration: 180, easing: 'ease-out', fill: 'forwards' },
        )
        animation.onfinish = onDismiss
      }}
      className={cn(
        'toast-pill relative flex max-w-lg overflow-hidden bg-popover/80 text-sm text-foreground backdrop-blur-md',
        behind ? 'pointer-events-none' : 'pointer-events-auto cursor-grab active:cursor-grabbing',

        action ? 'py-1.5 pr-1.5' : 'py-2 pr-4',

        state ? 'pl-3' : 'pl-4',
      )}
    >
      <motion.div
        animate={{ opacity: behind ? 0 : 1 }}
        transition={MORPH}
        className="flex items-center"
      >
        <div className="flex items-center gap-2">

          <AnimatePresence initial={false} mode="popLayout">
            {state ? (
              <motion.span
                key={glyphKey(state)}
                {...GLYPH_POP}
                transition={MORPH}
                className="flex size-4 shrink-0 items-center justify-center"
              >
                <ToastGlyph state={state} />
              </motion.span>
            ) : null}
          </AnimatePresence>

          <div className="flex items-center">
            <AnimatePresence initial={false}>
              <ToastLine key={message} message={message} />
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {action ? (
            <motion.div
              key="action"
              initial={{ width: 0 }}
              animate={{ width: 'auto', height: 'auto' }}

              exit={{ width: 0, height: TEXT_LINE }}
              transition={MORPH}
              className="flex items-center overflow-hidden"
            >
              <div className="w-max pl-7">
                <Button type="button" size="sm" onClick={onAction} className="h-7 rounded-full">
                  {action.label}
                </Button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

function sameBoxes(
  first: Record<string, { width: number; height: number }>,
  second: Record<string, { width: number; height: number }>,
) {
  const ids = Object.keys(second)
  return (
    ids.length === Object.keys(first).length &&
    ids.every(
      (id) => first[id]?.width === second[id]?.width && first[id]?.height === second[id]?.height,
    )
  )
}

function ToastStack({
  cards,
  onOpen,
  position,
}: {
  cards: StackCard[]
  onOpen: (open: boolean) => void
  position: ToastPosition
}) {
  const [pointing, setPointing] = useState(false)
  const [focused, setFocused] = useState(false)
  const [holding, setHolding] = useState(false)
  const [boxes, setBoxes] = useState<Record<string, { width: number; height: number }>>({})
  const measured = useRef(new Map<string, HTMLElement>())
  const root = useRef<HTMLDivElement>(null)

  const open = pointing || focused || holding
  const piled = cards.length > 1 && !open

  useEffect(() => onOpen(open), [onOpen, open])

  useEffect(() => {
    if (!holding) return
    const release = () => setHolding(false)

    const check = (event: PointerEvent) => {
      if (event.buttons === 0) release()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('pointermove', check)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('pointermove', check)
    }
  }, [holding])

  const at = useRef<{ x: number; y: number } | null>(null)
  const overCards = useCallback(
    () =>
      at.current !== null &&
      [...measured.current.values()].some((element) => {
        const box = element.getBoundingClientRect()
        return (
          at.current!.x >= box.left - REACH &&
          at.current!.x <= box.right + REACH &&
          at.current!.y >= box.top - REACH &&
          at.current!.y <= box.bottom + REACH
        )
      }),
    [],
  )

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      at.current = { x: event.clientX, y: event.clientY }
      setPointing(overCards())
    }

    const onLeave = () => {
      at.current = null
      setPointing(false)
    }

    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [overCards])

  useEffect(() => {
    if (!pointing) return
    let frame = requestAnimationFrame(function check() {
      if (!overCards()) {
        setPointing(false)
        return
      }
      frame = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(frame)
  }, [pointing, overCards])

  useEffect(() => {
    if (!focused) return
    let frame = requestAnimationFrame(function check() {
      if (!root.current?.contains(document.activeElement)) {
        setFocused(false)
        return
      }
      frame = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(frame)
  }, [focused])

  useLayoutEffect(() => {
    const next: Record<string, { width: number; height: number }> = {}
    for (const card of cards) {
      const element = measured.current.get(card.id)
      if (!element) continue

      const capped = element.style.maxWidth
      element.style.maxWidth = ''
      next[card.id] = { width: element.offsetWidth, height: element.offsetHeight }
      element.style.maxWidth = capped
    }
    setBoxes((current) => (sameBoxes(current, next) ? current : next))
  }, [cards])

  const heights = cards.map((card) => boxes[card.id]?.height ?? LINE_HEIGHT)

  const deckWidth = cards[0] ? boxes[cards[0].id]?.width : undefined
  const [side, align] = position.split('-') as [ToastSide, ToastAlign]

  const fall = side === 'top' ? 1 : -1

  return (
    <motion.div
      ref={root}
      aria-live="polite"

      onPointerDown={() => setHolding(true)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[100001]',
        side === 'top' ? 'top-4' : 'bottom-4',
      )}
    >
      <AnimatePresence initial={false}>
        {cards.map((card, index) => {
          const slot = piled ? pileSlot(index) : fanSlot(index, heights)

          const y = slot.y * fall
          const from = (slot.y - 8) * fall
          return (
            <motion.div
              key={card.id}
              style={{

                transformOrigin: `${side} ${align}`,
                zIndex: cards.length - index,
              }}
              initial={{ opacity: 0, y: from, scale: slot.scale * 0.98 }}
              animate={{ opacity: slot.opacity, y, scale: slot.scale }}
              exit={{ opacity: 0, y: from, scale: slot.scale * 0.96, transition: EXIT }}
              transition={MORPH}
              className={cn(
                'absolute inset-x-0 flex px-4',
                side === 'top' ? 'top-0' : 'bottom-0',
                ALIGN[align],
              )}
              aria-hidden={slot.opacity === 0 || undefined}
            >
              <motion.div
                ref={(element) => {
                  if (element) measured.current.set(card.id, element)
                  else measured.current.delete(card.id)
                }}
                className="relative"

                initial={false}
                animate={{
                  maxWidth: (piled && index > 0 ? deckWidth : boxes[card.id]?.width) ?? UNCAPPED,
                }}
                transition={MORPH}
              >
                {card.render(piled && index > 0)}
              </motion.div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </motion.div>
  )
}

export function Toasts({ position = 'top-center' }: { position?: ToastPosition }) {
  const [notes, setNotes] = useState<ToastNote[]>([])
  const [reading, setReading] = useState(false)
  const clock = useRef<ToastClock>({ waits: new Map(), since: null })

  const issued = useRef<string | null>(null)

  useEffect(() => {
    clock.current.since = performance.now()

    const onToast = (event: Event) => {
      const note = (event as CustomEvent<ToastNote>).detail
      issued.current = note.id
      setNotes((current) => upsertToast(current, note))
      tick(clock.current, performance.now())
      const delay = dismissDelay(note.state, note.action !== undefined, note.lifetime)
      if (delay === null) clock.current.waits.delete(note.id)
      else clock.current.waits.set(note.id, delay)
    }
    const onDismiss = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      clock.current.waits.delete(id)
      setNotes((current) => current.filter((note) => note.id !== id))
    }

    window.addEventListener(TOAST_EVENT, onToast)
    window.addEventListener(TOAST_DISMISS_EVENT, onDismiss)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      window.removeEventListener(TOAST_DISMISS_EVENT, onDismiss)
    }
  }, [])

  useEffect(() => {
    tick(clock.current, performance.now())
    clock.current.since = reading ? null : performance.now()
  }, [reading])

  useEffect(() => {
    if (reading) return

    tick(clock.current, performance.now())
    const waits = [...clock.current.waits.values()]
    if (waits.length === 0) return

    const timer = window.setTimeout(
      () => {
        tick(clock.current, performance.now())
        const expired = new Set<string>()
        for (const [id, left] of clock.current.waits) {
          if (left <= 0) expired.add(id)
        }
        for (const id of expired) clock.current.waits.delete(id)
        setNotes((current) => current.filter((note) => !expired.has(note.id)))
      },
      Math.max(0, Math.min(...waits)),
    )
    return () => window.clearTimeout(timer)
  }, [notes, reading])

  return (
    <MotionConfig reducedMotion="user">
      <ToastStack
        position={position}
        onOpen={setReading}
        cards={notes.map((note) => {
          const drop = () => {
            clock.current.waits.delete(note.id)
            setNotes((current) => current.filter((item) => item.id !== note.id))
          }

          const act = () => {
            issued.current = null
            note.action?.run()
            if (issued.current !== note.id) drop()
          }
          return {
            id: note.id,
            render: (behind) => (
              <ToastPill
                state={note.state}
                message={note.message}
                action={note.action}
                onAction={act}
                onDismiss={drop}
                behind={behind}
              />
            ),
          }
        })}
      />
    </MotionConfig>
  )
}
