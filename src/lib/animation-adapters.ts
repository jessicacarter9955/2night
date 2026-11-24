import type { GameRegistry, GMRegistry, GMSprite } from '@/lib/asset-types'
import type { RuntimeElement } from '@/lib/runtime-inspector'

export interface TimelineFrame {
  position: number
  index: number
  name: string
}
export interface AnimationClip {
  name: string
  frameRate: number
  looped: boolean
  current: boolean
  frames: TimelineFrame[]
}
export interface AnimationSnapshot {
  id: string
  gameId: string
  engine: string
  className: string
  atlas: string
  graphicWidth: number
  graphicHeight: number
  frame: string
  activeClip: string
  currentPosition: number
  paused: boolean
  sceneFrozen: boolean
  clips: AnimationClip[]
  supported: boolean
  explanation?: string
}
export type AnimationControl =
  | 'freeze' | 'unfreeze' | 'seek' | 'playClip' | 'pauseClip'
export interface AdapterResponse {
  ok: boolean
  error?: string
  unchanged?: boolean
  method?: string
  data?: AnimationSnapshot
}

interface AnimationBridge {
  inspect: (id: string) => AnimationSnapshot | null
  control: (id: string, action: AnimationControl, opts?: {
    name?: string; position?: number
  }) => AdapterResponse
  applyAtlas: (id: string, dataUrl: string) => Promise<AdapterResponse>
  restoreAtlas: (id: string) => AdapterResponse
  release: () => void
}

type GameFrame = HTMLIFrameElement | null

function getBridge(frame: GameFrame): AnimationBridge | null {
  try {
    const w = frame?.contentWindow as Window & {
      __2nightAnimation?: AnimationBridge
    } | null
    return w?.__2nightAnimation || null
  } catch {
    return null
  }
}

function gameMakerSnapshot(
  gameId: string,
  element: RuntimeElement,
  registry: GameRegistry | null,
): AnimationSnapshot | null {
  if (!registry || !registry.engine.startsWith('gamemaker')) return null
  const gm = registry as GMRegistry
  const sprite: GMSprite | undefined = gm.sprites.find(
    (item) => 'sprite:' + item.name === element.assetId,
  )
  if (!sprite) return null
  const firstPage = sprite.frames[0]?.page
  const atlas = gm.textures.find((page) => page.index === firstPage)
  const frames: TimelineFrame[] = sprite.frames.map((item, i) => ({
    position: i, index: i, name: sprite.name + '[' + i + ']',
  }))
  return {
    id: element.id, gameId, engine: 'gamemaker', className: element.className || '',
    atlas: atlas?.file || '', graphicWidth: atlas?.width || 0,
    graphicHeight: atlas?.height || 0,
    frame: element.frame || '0', activeClip: sprite.name,
    currentPosition: Math.max(0, Math.min(frames.length - 1,
      Number(element.frame) || 0)),
    paused: false, sceneFrozen: false,
    clips: [{ name: sprite.name, frameRate: sprite.speedFps || 0,
      looped: true, current: true, frames }],
    supported: false,
    explanation: 'Anteprima dei frame GameMaker disponibile. Controllo diretto ' +
      'delle animazioni della room non ancora implementato per questo motore.',
  }
}

// Engine-specific adapters implement the same generic capabilities.
// New games may add an adapter without changing the timeline UI.
export interface GameAnimationAdapter {
  inspect: (frame: GameFrame, element: RuntimeElement,
    registry: GameRegistry | null) => AnimationSnapshot | null
  control: (frame: GameFrame, element: RuntimeElement, action: AnimationControl,
    options?: {name?:string;position?:number}) => AdapterResponse
  applyAtlas: (frame: GameFrame, element: RuntimeElement,
    dataUrl: string) => Promise<AdapterResponse>
  restore: (frame: GameFrame, element: RuntimeElement) => AdapterResponse
  release: (frame: GameFrame) => void
}

const notSupported: AdapterResponse = {
  ok:false, error:'Il motore di questo gioco non supporta ancora l’operazione.',
}

const fnfAdapter: GameAnimationAdapter = {
  inspect(frame, element) {
    const result = getBridge(frame)?.inspect(element.id)
    return result ? {...result, supported:true} : null
  },
  control(frame, element, action, options) {
    return getBridge(frame)?.control(element.id, action, options) || notSupported
  },
  async applyAtlas(frame, element, dataUrl) {
    return await getBridge(frame)?.applyAtlas(element.id, dataUrl) || notSupported
  },
  restore(frame, element) {
    return getBridge(frame)?.restoreAtlas(element.id) || notSupported
  },
  release(frame) { getBridge(frame)?.release() },
}

const gmAdapter: GameAnimationAdapter = {
  inspect(_frame, element, registry) {
    return gameMakerSnapshot('chainsaw-dance', element, registry)
  },
  control() { return notSupported },
  async applyAtlas() { return notSupported },
  restore() { return notSupported },
  release() {},
}

export const gameAnimationAdapters: Record<string, GameAnimationAdapter> = {
  'friday-night-funkin': fnfAdapter,
  'chainsaw-dance': gmAdapter,
}

export function animationAdapter(gameId: string): GameAnimationAdapter {
  return gameAnimationAdapters[gameId] || gmAdapter
}

export function assetUrl(gameId: string, rel: string): string | null {
  // Reject arbitrary schemes, traversal and paths outside the game.
  // HaxeFlixel prefixes asset keys with library names, e.g.
  // "shared:assets/shared/images/BOYFRIEND.png" or "week1:assets/...".
  const value = rel.replace(/^(?:shared|week[0-9]+|preload):/i, '')
    .replace(/\\/g, '/').replace(/^\/+/, '')
  if (!value || value.includes('..') || /^(data|blob|https?):/i.test(value)) {
    return null
  }
  const root = 'games/' + gameId + '/'
  const path = value.startsWith(root) ? value : root + value
  return '/' + path
}
