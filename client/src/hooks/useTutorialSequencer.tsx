// The single coordinator shared by every TutorialLesson on the how-to-use
// page — docs/specs/12-how-to-use.md §4: "only one animation ever plays at a
// time, and it is the one the reader is looking at."
//
// One IntersectionObserver (not one per lesson) watches every lesson's
// stage, so all their visibility ratios are known at once. Whenever the
// single play slot is free, it goes to the most-visible lesson that hasn't
// had its go yet — that one rule, enforced in one place (electLeader),
// is what holds the invariant: two lessons can't both be "the" leader, and
// nothing plays until it's chosen.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface TutorialSequencer {
  /** Registers a lesson's stage node for visibility tracking. Returns the
   *  cleanup that unregisters it (call on unmount). */
  register: (id: string, node: HTMLElement) => () => void
  /** Frees the play slot — call once a lesson's sequence reaches its last frame. */
  notifyDone: (id: string) => void
  /** Replay: takes the slot right away. Whatever held it yields. */
  claim: (id: string) => void
  /** The id currently allowed to play, or null if the slot is free. */
  activeId: string | null
}

const TutorialSequencerContext = createContext<TutorialSequencer | null>(null)

/** Null when a lesson is rendered on its own, outside a provider — it then
 *  just plays as soon as it's in view, since there's nothing to coordinate
 *  with (see TutorialLesson's own IntersectionObserver fallback). */
export const useTutorialSequencer = () => useContext(TutorialSequencerContext)

export const TutorialSequencerProvider = ({ children }: { children: ReactNode }) => {
  const ratios = useRef(new Map<string, number>())
  const played = useRef(new Set<string>())
  const idByNode = useRef(new Map<Element, string>())
  const observerRef = useRef<IntersectionObserver | null>(null)
  // Mirrors `activeId` synchronously. electLeader and the observer callback
  // below need the *current* value without themselves changing identity
  // (the observer is only ever created once — see register) — reading
  // React state directly there would either recreate the observer on every
  // hand-off or close over a permanently stale activeId.
  const activeIdRef = useRef<string | null>(null)
  const [activeId, setActiveIdState] = useState<string | null>(null)

  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveIdState(id)
  }, [])

  // The whole invariant lives here: hand the slot to the most-visible,
  // not-yet-played lesson — but only when the slot is actually free.
  //
  // This deliberately does the picking as a plain synchronous function,
  // not inside a `setActiveId(current => ...)` updater: React (Strict Mode,
  // in dev) calls updater functions twice to check they're pure, and
  // `played.current.add(...)` is a mutation — called twice, it was marking
  // a *second* lesson "played" purely from being considered, before it had
  // ever actually run. That silently locked every lesson but the first out
  // of auto-play for good.
  const electLeader = useCallback(() => {
    if (activeIdRef.current) return
    let leader: string | null = null
    let bestRatio = 0
    for (const [id, ratio] of ratios.current) {
      if (played.current.has(id) || ratio <= bestRatio) continue
      bestRatio = ratio
      leader = id
    }
    if (leader) {
      played.current.add(leader)
      setActiveId(leader)
    }
  }, [setActiveId])

  const register = useCallback(
    (id: string, node: HTMLElement) => {
      idByNode.current.set(node, id)

      if (typeof IntersectionObserver === 'undefined') {
        // No observer in this environment (older browser, or this
        // project's tests) — treat the lesson as fully visible and let the
        // usual election serialise the lessons in mount order, instead of
        // every lesson playing itself immediately.
        ratios.current.set(id, 1)
        electLeader()
        return () => {
          idByNode.current.delete(node)
          ratios.current.delete(id)
          if (activeIdRef.current === id) setActiveId(null)
        }
      }

      if (!observerRef.current) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            for (const observerEntry of entries) {
              const entryId = idByNode.current.get(observerEntry.target)
              if (entryId) ratios.current.set(entryId, observerEntry.intersectionRatio)
            }
            electLeader()
          },
          { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
        )
      }
      observerRef.current.observe(node)

      return () => {
        idByNode.current.delete(node)
        ratios.current.delete(id)
        observerRef.current?.unobserve(node)
        if (activeIdRef.current === id) setActiveId(null)
      }
    },
    [electLeader, setActiveId],
  )

  const notifyDone = useCallback(
    (id: string) => {
      if (activeIdRef.current === id) setActiveId(null)
    },
    [setActiveId],
  )

  const claim = useCallback(
    (id: string) => {
      played.current.add(id)
      setActiveId(id)
    },
    [setActiveId],
  )

  // Whenever the slot frees up (a lesson finished or unmounted), try to
  // hand it straight to the next candidate.
  useEffect(() => {
    if (!activeId) electLeader()
  }, [activeId, electLeader])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return (
    <TutorialSequencerContext.Provider value={{ register, notifyDone, claim, activeId }}>
      {children}
    </TutorialSequencerContext.Provider>
  )
}
