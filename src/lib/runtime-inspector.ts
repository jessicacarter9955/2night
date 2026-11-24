import { FNFRegistry, GameRegistry, GMRegistry, isGM } from './asset-types'

export type RendererEngine = 'gamemaker' | 'openfl' | 'unknown'

export interface RuntimeElement {
  id: string
  name: string
  className?: string
  assetId?: string
  source?: string
  frame?: string
  animation?: string
  engine: RendererEngine
  sourceType: string
  x: number
  y: number
  w: number
  h: number
  worldX?: number
  worldY?: number
  scaleX: number
  scaleY: number
  angle: number
  alpha: number
  originX: number
  originY: number
  depth: number
  order: number
  instanceId?: number
}

export interface RenderState {
  engine: RendererEngine
  screen: string
  items: RuntimeElement[]
  canvasW: number
  canvasH: number
  ready: boolean
  description: string
  precision: string
}

interface GameMakerRuntime {
  _XY?: { _Q63?: { _2L?: unknown[] } }
}

type UnknownRecord = Record<string, unknown>

function n(value: unknown, defaultValue = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue
}

function rotatedBox(
  originX: number,
  originY: number,
  w: number,
  h: number,
  scaleX: number,
  scaleY: number,
  degrees: number,
): Pick<RuntimeElement, 'x' | 'y' | 'w' | 'h'> {
  const radians = -degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const points = [
    [-originX * scaleX, -originY * scaleY],
    [(w - originX) * scaleX, -originY * scaleY],
    [(w - originX) * scaleX, (h - originY) * scaleY],
    [-originX * scaleX, (h - originY) * scaleY],
  ].map(([dx, dy]) => ({
    x: dx * cosine - dy * sine,
    y: dx * sine + dy * cosine,
  }))
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    x: left,
    y: top,
    w: Math.max(...xs) - left,
    h: Math.max(...ys) - top,
  }
}

function readGameMaker(
  win: Window,
  registry: GMRegistry | null,
  width: number,
  height: number,
): RenderState {
  // Reverse-engineered against the *actual compiled game* in Chromium.
  // _XY._Q63._2L is the active room instance array.
  // _bh: sprite_index; _d33/_e33: world x/y; _C33/_D33: scale;
  // _E33: angle; _F33: alpha; _s33: visible flag.
  const runtime = win as unknown as GameMakerRuntime
  const active = runtime._XY?._Q63?._2L
  const sprites = new Map(registry?.sprites.map((s) => [s.index, s]) ?? [])
  if (!Array.isArray(active)) {
    return {
      engine: 'gamemaker', screen: 'Avvio GameMaker', items: [],
      canvasW: width, canvasH: height, ready: false,
      description: 'Attendo le istanze della room attuale…',
      precision: 'Runtime GameMaker: istanze della room',
    }
  }

  const items: RuntimeElement[] = []
  active.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return
    const o = raw as UnknownRecord
    const spriteIndex = n(o._bh, -1)
    if (spriteIndex < 0 || o._s33 === false || o._T51 === false ||
      o._q33 === false || o._F33 === 0) return
    const sprite = sprites.get(spriteIndex)
    if (!sprite) return
    const sx = n(o._C33, 1)
    const sy = n(o._D33, 1)
    const angle = n(o._E33)
    const worldX = n(o._d33)
    const worldY = n(o._e33)
    const bounds = rotatedBox(n(sprite.originX), n(sprite.originY),
      n(sprite.width), n(sprite.height), sx, sy, angle)
    const left = worldX + bounds.x
    const top = worldY + bounds.y
    if (bounds.w < 1 || bounds.h < 1 ||
      left > width || top > height ||
      left + bounds.w < 0 || top + bounds.h < 0) return
    const frame = n(o._2o, 0)
    const imageIndex = Math.max(0, Math.floor(frame))
    items.push({
      id: 'gm:' + String(o.id ?? index),
      name: sprite.name,
      assetId: 'sprite:' + sprite.name,
      className: 'GameMaker instance',
      frame: String(imageIndex),
      source: sprite.frames?.[imageIndex % Math.max(sprite.frames?.length || 1, 1)]
        ? 'Atlas page ' +
          sprite.frames[imageIndex % Math.max(sprite.frames?.length || 1, 1)].page
        : 'GameMaker atlas',
      engine: 'gamemaker',
      sourceType: 'Active room instance',
      x: left, y: top, w: bounds.w, h: bounds.h,
      worldX, worldY, scaleX: sx, scaleY: sy, angle,
      alpha: n(o._F33, 1),
      originX: n(sprite.originX),
      originY: n(sprite.originY),
      depth: n(o._u33, 0),
      order: index,
      instanceId: n(o.id),
    })
  })
  return {
    engine: 'gamemaker',
    screen: 'Room attiva · ' + active.length + ' istanze',
    items,
    canvasW: width,
    canvasH: height,
    ready: true,
    description: items.length + ' sprite associati a istanze reali della room',
    precision: 'Posizioni e dimensioni dalle istanze GameMaker (non pixel matching)',
  }
}

function matchFnfAsset(source: string, files: FNFRegistry['files']): string | undefined {
  const clean = source.toLowerCase().replace(/\\/g, '/').split('?')[0]
  if (!clean) return undefined
  let selected: string | undefined
  let longest = 0
  for (const file of files) {
    if (file.type !== 'png') continue
    const path = file.path.toLowerCase()
    if (clean.includes(path) && path.length > longest) {
      selected = 'file:' + file.path
      longest = path.length
    }
  }
  if (selected) return selected
  const basename = clean.split('/').pop()
  if (!basename) return undefined
  const nameMatches = files.filter((file) =>
    file.type === 'png' && file.path.toLowerCase().endsWith('/' + basename))
  return nameMatches.length === 1 ? 'file:' + nameMatches[0].path : undefined
}

function readOpenFL(
  win: Window,
  registry: FNFRegistry | null,
  width: number,
  height: number,
): RenderState {
  type HaxeBridge = {
    read: () => {
      items?: Array<Partial<RuntimeElement>>
      screen?: string
      activeDrawCalls?: number
      errors?: number
      canvasW?: number
      canvasH?: number
    }
  }
  const bridge = (win as unknown as { __2nightDrawInspector?: HaxeBridge })
    .__2nightDrawInspector
  if (!bridge || typeof bridge.read !== 'function') {
    return {
      engine: 'openfl', screen: 'OpenFL · avvio', items: [],
      canvasW: width, canvasH: height, ready: false,
      description: 'Il bridge di rendering non è ancora pronto. Ricarica la pagina se persiste.',
      precision: 'Attendo HaxeFlixel.drawSimple / drawComplex',
    }
  }
  let snapshot: ReturnType<HaxeBridge['read']>
  try { snapshot = bridge.read() } catch (error) {
    return {
      engine: 'openfl', screen: 'Errore runtime', items: [],
      canvasW: width, canvasH: height, ready: false,
      description: error instanceof Error ? error.message : 'Bridge non disponibile',
      precision: 'HaxeFlixel draw calls',
    }
  }
  const items: RuntimeElement[] = []
  for (const raw of snapshot.items ?? []) {
    const w = n(raw.w), h = n(raw.h)
    if (w < 1 || h < 1) continue
    const x = n(raw.x), y = n(raw.y)
    if (x > width || y > height || x + w < 0 || y + h < 0) continue
    const source = String(raw.source ?? '')
    const frameName = String(raw.frame ?? '')
    const assetId = registry ? matchFnfAsset(source, registry.files) : undefined
    const title = frameName || (assetId ? assetId.split('/').pop() : '') ||
      String(raw.className ?? 'FlxSprite')
    items.push({
      id: String(raw.id ?? 'flx:' + items.length),
      name: title,
      className: String(raw.className ?? 'FlxSprite'),
      assetId,
      source,
      frame: frameName,
      animation: String(raw.animation ?? ''),
      engine: 'openfl',
      sourceType: 'Actual HaxeFlixel draw call',
      x, y, w, h,
      worldX: n(raw.worldX, x), worldY: n(raw.worldY, y),
      scaleX: n(raw.scaleX, 1), scaleY: n(raw.scaleY, 1),
      angle: n(raw.angle), alpha: n(raw.alpha, 1),
      originX: n(raw.originX), originY: n(raw.originY),
      depth: 0, order: n(raw.order, items.length),
    })
  }
  return {
    engine: 'openfl',
    screen: String(snapshot.screen || 'OpenFL'),
    items,
    canvasW: width,
    canvasH: height,
    ready: true,
    description: String(items.length) + ' sprite con chiamata draw verificata',
    precision: 'Geometria letta dal renderer HaxeFlixel',
  }
}

export function readRenderedScene(
  frame: HTMLIFrameElement | null,
  gameId: string,
  registry: GameRegistry | null,
): RenderState {
  const unknown: RenderState = {
    engine: 'unknown', screen: 'Caricamento', items: [],
    canvasW: 0, canvasH: 0, ready: false,
    description: 'Attendo il canvas del gioco…',
    precision: 'Runtime inspector',
  }
  if (!frame) return unknown
  try {
    const win = frame.contentWindow
    const canvas = frame.contentDocument?.querySelector('canvas')
    if (!win || !canvas || !canvas.width || !canvas.height) return unknown
    if (gameId === 'chainsaw-dance') {
      return readGameMaker(win, registry && isGM(registry) ? registry : null,
        canvas.width, canvas.height)
    }
    return readOpenFL(win, registry && !isGM(registry) ? registry : null,
      canvas.width, canvas.height)
  } catch (error) {
    return {
      ...unknown,
      description: 'Impossibile leggere il renderer: ' +
        (error instanceof Error ? error.message : String(error)),
    }
  }
}
