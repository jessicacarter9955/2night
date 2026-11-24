'use client'

import { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import {
  Check, ChevronDown, CircleDot, Crosshair, Eye, EyeOff, Info,
  MousePointer2, Play, RefreshCw, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GameRegistry } from '@/lib/asset-types'
import { readRenderedScene, RenderState, RuntimeElement } from '@/lib/runtime-inspector'

interface Props {
  frameRef: RefObject<HTMLIFrameElement | null>
  gameId: string
  registry: GameRegistry | null
  selectedAssetId: string | null
  onSelectElement: (item: RuntimeElement) => void
  onOpenAnimation: (item: RuntimeElement) => void
  onClose: () => void
}

interface CanvasFit {
  x: number
  y: number
  w: number
  h: number
  canvasW: number
  canvasH: number
}

function inside(item: RuntimeElement, x: number, y: number): boolean {
  return x >= item.x && y >= item.y &&
    x <= item.x + item.w && y <= item.y + item.h
}

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function hitTest(items: RuntimeElement[], x: number, y: number): RuntimeElement[] {
  return items.filter((item) => inside(item, x, y))
    .sort((a, b) => {
      if (a.engine === 'gamemaker' && b.engine === 'gamemaker') {
        // GameMaker: lower depth draws over higher depth.
        if (a.depth !== b.depth) return a.depth - b.depth
      }
      return b.order - a.order
    })
}

export function NativeInspectorOverlay({
  frameRef, gameId, registry, selectedAssetId, onSelectElement, onClose,
}: Props) {
  const [scene, setScene] = useState<RenderState>({
    ready: false, engine: 'unknown', items: [],
    canvasW: 0, canvasH: 0, screen: 'Caricamento',
    description: 'Attendo il runtime del gioco', precision: 'Runtime inspector',
  })
  const [fit, setFit] = useState<CanvasFit | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [hoverCycle, setHoverCycle] = useState(0)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const hostRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<RuntimeElement[]>([])
  const pointRef = useRef<{ x: number; y: number } | null>(null)
  const pickRef = useRef<RuntimeElement | null>(null)
  const lastFrame = useRef(0)

  const calculateFit = useCallback((state?: RenderState) => {
    const iframe = frameRef.current
    const host = hostRef.current
    if (!iframe || !host) return
    try {
      const canvas = iframe.contentDocument?.querySelector('canvas')
      if (!canvas) { setFit(null); return }
      const iframeRect = iframe.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const hostRect = host.getBoundingClientRect()
      if (!canvasRect.width || !canvasRect.height) return
      setFit({
        x: iframeRect.left + canvasRect.left - hostRect.left,
        y: iframeRect.top + canvasRect.top - hostRect.top,
        w: canvasRect.width, h: canvasRect.height,
        canvasW: state?.canvasW || canvas.width,
        canvasH: state?.canvasH || canvas.height,
      })
    } catch {
      setFit(null)
    }
  }, [frameRef])

  useEffect(() => {
    let active = true
    let request = 0
    let last = 0
    const update = (t: number) => {
      if (!active) return
      if (t - last >= 90) {
        last = t
        try {
          const next = readRenderedScene(frameRef.current, gameId, registry)
          itemsRef.current = next.items
          setScene(next)
          calculateFit(next)
        } catch (error) {
          console.error('[2Night native inspector]', error)
        }
      }
      request = window.requestAnimationFrame(update)
    }
    request = window.requestAnimationFrame(update)
    return () => { active = false; window.cancelAnimationFrame(request) }
  }, [calculateFit, frameRef, gameId, registry])

  const selected = scene.items.find((item) => item.id === hoveredId) ||
    scene.items.find((item) => item.id === pinnedId) ||
    scene.items.find((item) => item.assetId && item.assetId === selectedAssetId) ||
    null

  const selectAt = (x: number, y: number, cycle = 0): RuntimeElement | null => {
    const hits = hitTest(itemsRef.current, x, y)
    return hits[cycle % Math.max(1, hits.length)] ?? null
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!fit || playing) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const p = {
      x: (event.clientX - bounds.left) * fit.canvasW / fit.w,
      y: (event.clientY - bounds.top) * fit.canvasH / fit.h,
    }
    pointRef.current = p
    setCursor(p)
    const picked = selectAt(p.x, p.y, hoverCycle)
    pickRef.current = picked
    setHoveredId(picked?.id ?? null)
  }

  // The pointer may stand still while a game object moves underneath it:
  // recompute the hovered instance from the latest renderer frame.
  useEffect(() => {
    if (!pointRef.current || playing) return
    const item = selectAt(pointRef.current.x, pointRef.current.y, hoverCycle)
    pickRef.current = item
    setHoveredId(item?.id ?? null)
  }, [scene, playing, hoverCycle])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !playing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, playing])

  const box = (item: RuntimeElement) => {
    if (!fit) return {}
    return {
      left: item.x / fit.canvasW * fit.w,
      top: item.y / fit.canvasH * fit.h,
      width: item.w / fit.canvasW * fit.w,
      height: item.h / fit.canvasH * fit.h,
    }
  }

  const overlapping = cursor ? hitTest(scene.items, cursor.x, cursor.y) : []
  const currentIndex = Math.min(hoverCycle, Math.max(0, overlapping.length - 1))
  const canvasActive = scene.ready && fit !== null

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-testid="native-runtime-inspector">
      <div className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex flex-wrap items-center gap-2 border-b border-sky-500/30 bg-zinc-950/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
        <CircleDot className="h-4 w-4 text-emerald-400" />
        <strong className="text-sky-100">Inspector nativo · LIVE</strong>
        <span className="hidden truncate font-mono text-[11px] text-zinc-400 md:inline">
          {scene.engine === 'openfl' ? 'HaxeFlixel · draw calls' :
            scene.engine === 'gamemaker' ? 'GameMaker · istanze runtime' : 'Caricamento'}
          {' · '}{scene.items.length} elementi
        </span>
        <span className="hidden truncate text-[11px] text-zinc-500 lg:inline"
          title={scene.screen}>· {scene.screen}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => {
            setPlaying((v) => {
              if (!v) frameRef.current?.contentWindow?.focus()
              return !v
            })
          }} className="h-8 gap-1.5 border-zinc-700 bg-zinc-800 text-xs">
            {playing ? <Crosshair className="h-3.5 w-3.5" /> :
              <Play className="h-3.5 w-3.5" />}
            {playing ? 'Ispeziona (hover)' : 'Gioca'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}
            className="h-8 gap-1 border-zinc-700 bg-zinc-800 text-xs">
            {showAll ? <EyeOff className="h-3.5 w-3.5" /> :
              <Eye className="h-3.5 w-3.5" />}
            {showAll ? 'Nascondi box' : 'Mostra box'}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Chiudi inspector"
            title="Chiudi inspector" onClick={onClose}
            className="h-8 w-8 text-zinc-300">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {fit && (
        <div className={'absolute z-10 ' +
          (playing ? 'pointer-events-none' : 'pointer-events-auto cursor-crosshair')}
          style={{ left: fit.x, top: fit.y, width: fit.w, height: fit.h }}
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            pointRef.current = null
            pickRef.current = null
            setHoveredId(null)
            setCursor(null)
            setHoverCycle(0)
          }}
          onWheel={(event) => {
            if (event.altKey && pointRef.current) {
              event.preventDefault()
              setHoverCycle((v) => Math.max(0, v + (event.deltaY > 0 ? 1 : -1)))
            }
          }}
          onClick={() => {
            if (!pickRef.current || playing) return
            setPinnedId(pickRef.current.id)
            onSelectElement(pickRef.current)
          }}>
          {showAll && scene.items.slice(-350).map((item) => (
            <div key={'all-' + item.id}
              className="pointer-events-none absolute border border-sky-300/25"
              style={box(item)} />
          ))}
          {selected && (
            <div className="pointer-events-none absolute z-10 border-2 border-sky-300 bg-sky-400/25 shadow-[0_0_0_1px_#082f49,0_0_22px_#0284c722]"
              style={box(selected)}>
              <span className="absolute bottom-full left-[-2px] mb-1 max-w-[300px] truncate rounded bg-sky-600 px-2 py-1 font-mono text-[11px] font-semibold text-white">
                {selected.name} · {numberLabel(selected.w)}×{numberLabel(selected.h)}
              </span>
            </div>
          )}
          {pinnedId && selected?.id !== pinnedId && scene.items.find((item) => item.id === pinnedId) && (
            <div className="pointer-events-none absolute z-10 border border-rose-400 bg-rose-500/10"
              style={box(scene.items.find((item) => item.id === pinnedId)!)} />
          )}
        </div>
      )}

      {!canvasActive && (
        <div className="pointer-events-none absolute left-1/2 top-[20%] max-w-md -translate-x-1/2 rounded-lg border border-sky-700/50 bg-zinc-950/90 p-4 text-center text-xs text-zinc-200">
          <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-sky-400" />
          {scene.description}
          <p className="mt-2 text-[10px] text-zinc-500">Non è richiesta alcuna analisi OpenCV.</p>
        </div>
      )}

      {!playing && panelOpen && (
        <div className="pointer-events-auto absolute right-3 top-[61px] z-30 max-h-[calc(100%-130px)] w-[min(310px,calc(100%-24px))] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/95 p-3 text-xs text-zinc-100 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold tracking-widest text-sky-400">
              {selected ? 'HOVER · RENDER BOX' : 'INSPECTOR · RENDER TREE'}
            </span>
            <button onClick={() => setPanelOpen(false)} aria-label="Comprimi inspector">
              <ChevronDown className="h-4 w-4 text-zinc-400" />
            </button>
          </div>
          {selected ? (
            <>
              <p className="break-all font-semibold text-zinc-100">{selected.name}</p>
              <p className="mt-1 text-[10px] text-emerald-300">{selected.sourceType}</p>
              <button onClick={() => onOpenAnimation(selected)}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-sky-600 bg-sky-900/60 px-3 py-2 text-[11px] font-semibold text-sky-100 hover:bg-sky-800"
                title="Apri i frame animati reali di questo elemento">
                <Film className="h-4 w-4"/> Animation Workbench · Timeline
              </button>
              <div className="my-3 rounded-lg border border-dashed border-sky-600 bg-sky-950/15 p-3">
                <div className="rounded border border-sky-400/70 bg-sky-500/10 px-2 py-4 text-center font-mono">
                  <span className="block text-[10px] text-sky-300">DRAW BOX</span>
                  <span className="text-lg font-bold text-sky-100">
                    {numberLabel(selected.w)} × {numberLabel(selected.h)}
                  </span>
                  <span className="block text-[10px] text-sky-200">canvas px</span>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px]">
                {[
                  ['x', numberLabel(selected.x)], ['y', numberLabel(selected.y)],
                  ['width', numberLabel(selected.w)], ['height', numberLabel(selected.h)],
                  ['scaleX', numberLabel(selected.scaleX)], ['scaleY', numberLabel(selected.scaleY)],
                  ['angle', numberLabel(selected.angle) + '°'],
                  ['alpha', numberLabel(selected.alpha)],
                  ['originX', numberLabel(selected.originX)],
                  ['originY', numberLabel(selected.originY)],
                ].map(([name, val]) => (
                  <div key={name} className="flex justify-between gap-1 border-b border-zinc-800 py-1">
                    <dt className="text-zinc-500">{name}</dt>
                    <dd className="text-zinc-200">{val}</dd>
                  </div>
                ))}
              </dl>
              {selected.assetId && (
                <p className="mt-3 break-all rounded bg-zinc-800 px-2 py-1.5 font-mono text-[10px] text-sky-300">
                  {selected.assetId}
                </p>
              )}
              {selected.source && (
                <p className="mt-2 break-all font-mono text-[10px] text-zinc-500"
                  title={selected.source}>Texture: {selected.source}</p>
              )}
              {selected.animation && (
                <p className="mt-1 break-all font-mono text-[10px] text-zinc-500">
                  Animazione: {selected.animation}
                </p>
              )}
              {selected.instanceId !== undefined && (
                <p className="mt-1 font-mono text-[10px] text-zinc-500">
                  Instance ID: {selected.instanceId}
                </p>
              )}
              <p className="mt-3 border-t border-zinc-800 pt-2 text-[10px] text-zinc-500">
                La box indica la geometria del rendering, non margini/padding CSS.
                Clicca per fissare la selezione e aprire l’asset da modificare.
              </p>
            </>
          ) : (
            <>
              <p className="text-zinc-200">{scene.description}</p>
              <p className="mt-2 text-[11px] text-zinc-400">
                Sposta il mouse su qualsiasi sprite visibile: il rettangolo e
                le proprietà compaiono subito, senza click né server.
              </p>
              <p className="mt-2 text-[10px] text-zinc-500">
                {scene.precision}
              </p>
            </>
          )}
          {overlapping.length > 1 && (
            <p className="mt-2 border-t border-zinc-800 pt-2 font-mono text-[10px] text-amber-200">
              {overlapping.length} elementi sovrapposti · ALT + rotella
              per cambiare ({currentIndex + 1}/{overlapping.length})
            </p>
          )}
          {cursor && (
            <p className="mt-2 border-t border-zinc-800 pt-2 font-mono text-[10px] text-zinc-500">
              Puntatore: {Math.round(cursor.x)}, {Math.round(cursor.y)} ·
              canvas {scene.canvasW}×{scene.canvasH}
            </p>
          )}
        </div>
      )}
      {!playing && !panelOpen && (
        <button className="pointer-events-auto absolute right-3 top-[61px] z-30 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-sky-300"
          onClick={() => setPanelOpen(true)}>
          <Info className="mr-1 inline h-3.5 w-3.5" /> Box model
        </button>
      )}

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 flex flex-wrap items-center gap-2 border-t border-zinc-800 bg-zinc-950/85 px-3 py-1.5 font-mono text-[10px] text-zinc-400">
        <Check className="h-3.5 w-3.5 text-emerald-400" />
        {scene.ready ? 'LIVE · nessuno screenshot / nessun matcher' :
          'Aspetto il motore di gioco'}
        <span className="text-zinc-600">·</span>
        {scene.items.length} elementi correnti
        <span className="ml-auto text-zinc-500">
          {playing ? 'Input al gioco · Ispeziona (hover) per selezionare' :
            'Passa il mouse · click opzionale per fissare · ALT+rotella per sovrapposti'}
        </span>
      </div>
    </div>
  )
}
