'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Camera, Crosshair, Loader2, MousePointerClick, Play, RefreshCw, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface InspectMatch {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  score: number
  meta?: { scale?: number; occluded?: boolean }
}

export interface InspectStats {
  snapshot?: { w: number; h: number }
  templates?: number
  matches?: number
  elapsedMs?: number
  partial?: boolean
  templateLimit?: number
}

export type InspectMode = 'live' | 'snapshot'

interface Props {
  gameId: string
  frame: HTMLIFrameElement | null
  mode: InspectMode
  playing: boolean
  snapshot: string | null
  matches: InspectMatch[]
  stats: InspectStats | null
  busy: boolean
  busyLabel: string
  elapsed: number
  logs: string[]
  error: string | null
  selectedId: string | null
  onRefresh: () => void
  onCancel: () => void
  onToggleMode: () => void
  onTogglePlaying: () => void
  onSelectMatch: (m: InspectMatch) => void
  onPickPoint: (point: { x: number; y: number }) => void
  onClose: () => void
}

interface Fit {
  w: number
  h: number
  ox: number
  oy: number
  naturalW: number
  naturalH: number
}

export function InspectOverlay({
  frame, mode, playing, snapshot, matches, stats, busy, busyLabel,
  elapsed, logs, error, selectedId, onRefresh, onCancel, onToggleMode,
  onTogglePlaying, onSelectMatch, onPickPoint, onClose,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<Fit | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [picked, setPicked] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const compute = () => {
      const bounds = el.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      if (mode === 'live') {
        try {
          const canvas = frame?.contentDocument?.querySelector('canvas')
          if (!canvas) { setFit(null); return }
          const r = canvas.getBoundingClientRect()
          if (!r.width || !r.height) { setFit(null); return }
          const w = stats?.snapshot?.w || canvas.width
          const h = stats?.snapshot?.h || canvas.height
          // Canvas coordinates are relative to the iframe viewport, not the parent.
          const iframeRect = frame?.getBoundingClientRect()
          setFit({ w: r.width, h: r.height,
            ox: (iframeRect?.left ?? 0) + r.left - bounds.left,
            oy: (iframeRect?.top ?? 0) + r.top - bounds.top,
            naturalW: w, naturalH: h })
        } catch {
          setFit(null)
        }
        return
      }
      const natural = stats?.snapshot || imageSize
      if (!natural?.w || !natural.h) { setFit(null); return }
      const scale = Math.min(bounds.width / natural.w, bounds.height / natural.h)
      const w = natural.w * scale, h = natural.h * scale
      setFit({ w, h, ox: (bounds.width-w)/2, oy: (bounds.height-h)/2,
        naturalW: natural.w, naturalH: natural.h })
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    // GameMaker/OpenFL can resize their canvas without resizing the stage.
    const timer = window.setInterval(compute, 700)
    return () => { observer.disconnect(); clearInterval(timer) }
  }, [mode, frame, stats?.snapshot?.w, stats?.snapshot?.h, imageSize])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(mode === 'live' && playing)) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, mode, playing])

  const active = hoveredIndex !== null ? matches[hoveredIndex] :
    matches.find((m) => m.id === selectedId)
  const display = mode === 'snapshot' ? 'Schermata fissa' : 'LIVE · gioco in esecuzione'
  const relativeX = (x: number) => fit ? Math.round(x * fit.w / fit.naturalW) : 0
  const relativeY = (y: number) => fit ? Math.round(y * fit.h / fit.naturalH) : 0

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!fit) return
    const bounds = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(fit.naturalW - 1,
      Math.round((e.clientX - bounds.left) * fit.naturalW / fit.w)))
    const y = Math.max(0, Math.min(fit.naturalH - 1,
      Math.round((e.clientY - bounds.top) * fit.naturalH / fit.h)))
    setCursor({ x, y })
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col" data-testid="inspect-overlay">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-b border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-lg">
        <MousePointerClick className="h-4 w-4 text-sky-400" />
        <span className="text-xs font-bold text-zinc-100">{display}</span>
        <span className="hidden font-mono text-[11px] text-zinc-400 lg:inline">
          {busy ? busyLabel : (stats ? 
            String(matches.length) + ' match · ' + String(stats.templates ?? 0) + ' template' :
            'Seleziona un asset per identificarlo')}
        </span>
        {busy && <span className="font-mono text-[11px] text-sky-300">{elapsed}s</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={onToggleMode}
            className="h-8 gap-1 border-zinc-700 bg-zinc-800 text-xs text-zinc-200">
            {mode === 'live' ? <Camera className="h-3.5 w-3.5" /> :
              <Play className="h-3.5 w-3.5" />}
            {mode === 'live' ? 'Congela frame' : 'Torna live'}
          </Button>
          {mode === 'live' && (
            <Button size="sm" variant="outline" onClick={onTogglePlaying}
              className="h-8 gap-1 border-zinc-700 bg-zinc-800 text-xs text-zinc-200">
              {playing ? <Crosshair className="h-3.5 w-3.5" /> :
                <Play className="h-3.5 w-3.5" />}
              {playing ? 'Seleziona' : 'Gioca'}
            </Button>
          )}
          {busy ? (
            <Button size="sm" variant="outline" onClick={onCancel}
              className="h-8 gap-1 border-amber-700 bg-zinc-900 text-xs text-amber-200">
              <Square className="h-3 w-3" /> Interrompi
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onRefresh}
              className="h-8 gap-1 border-zinc-700 bg-zinc-800 text-xs text-zinc-200">
              <RefreshCw className="h-3.5 w-3.5" /> Analizza adesso
            </Button>
          )}
          <Button size="icon" variant="ghost" aria-label="Chiudi inspector"
            onClick={onClose} className="h-8 w-8 text-zinc-300"><X className="h-4 w-4" /></Button>
        </div>
      </div>

      <div ref={wrapRef}
        className={'relative min-h-0 flex-1 overflow-hidden ' +
          (mode === 'snapshot' ? 'bg-zinc-950' : 'bg-transparent')}>
        {mode === 'snapshot' && snapshot && (
          <img src={snapshot} alt="Screenshot del gioco" draggable={false}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={(e) => setImageSize({
              w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight,
            })} />
        )}
        {fit && (
          <div className={'absolute ' + (mode === 'live' && playing ?
            'pointer-events-none' : 'pointer-events-auto cursor-crosshair')}
            style={{ left: fit.ox, top: fit.oy, width: fit.w, height: fit.h }}
            onMouseMove={handleMove} onMouseLeave={() => setCursor(null)}
            onClick={(e) => {
              if (mode === 'live' && playing) return
              const b = e.currentTarget.getBoundingClientRect()
              const p = {
                x: Math.max(0, Math.min(fit.naturalW-1, Math.round(
                  (e.clientX-b.left)*fit.naturalW/fit.w))),
                y: Math.max(0, Math.min(fit.naturalH-1, Math.round(
                  (e.clientY-b.top)*fit.naturalH/fit.h))),
              }
              setPicked(p)
              const hit = [...matches].reverse().find((m) =>
                p.x >= m.x && p.y >= m.y && p.x < m.x+m.w && p.y < m.y+m.h)
              if (hit) onSelectMatch(hit)
              else onPickPoint(p)
            }}>
            {matches.map((m, i) => {
              const hot = hoveredIndex === i
              const selected = m.id === selectedId
              return (
                <div key={m.id + ':' + m.x + ':' + m.y + ':' + i}
                  role="button" tabIndex={0}
                  aria-label={'Seleziona ' + m.name}
                  className={'absolute ' + (playing && mode === 'live' ?
                    'pointer-events-none' : 'cursor-crosshair')}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={(e) => { e.stopPropagation(); onSelectMatch(m) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelectMatch(m)
                  }}
                  style={{
                    left: relativeX(m.x), top: relativeY(m.y),
                    width: Math.max(2, relativeX(m.w)), height: Math.max(2, relativeY(m.h)),
                    background: hot ? 'rgba(80,180,255,.3)' :
                      selected ? 'rgba(255,80,80,.18)' : 'transparent',
                    outline: '1px ' + (hot || selected ? 'solid' : 'dashed') + ' ' +
                      (hot ? '#7dd3fc' : selected ? '#fb7185' : '#9ca3af99'),
                  }} />
              )
            })}
            {picked && !active && (
              <div className="pointer-events-none absolute rounded-full border-2 border-sky-300 bg-sky-400/40"
                style={{ left: relativeX(picked.x)-6, top: relativeY(picked.y)-6,
                  width: 12, height: 12 }} />
            )}
            {active && (
              <div className="pointer-events-none absolute z-10 max-w-[260px] rounded border border-sky-500 bg-zinc-900/95 px-2 py-1 font-mono text-[11px] text-sky-100"
                style={{ left: Math.max(0, Math.min(fit.w-180, relativeX(active.x))),
                  top: Math.max(0, relativeY(active.y)-43) }}>
                {active.name} · {active.w}×{active.h} · {(active.score*100).toFixed(1)}%
              </div>
            )}
            {cursor && !active && (
              <span className="pointer-events-none absolute rounded bg-zinc-900/85 px-1.5 py-1 font-mono text-[10px] text-sky-200"
                style={{ left: Math.min(fit.w-90, relativeX(cursor.x)+11),
                  top: Math.max(0, relativeY(cursor.y)-23) }}>
                {cursor.x}, {cursor.y}
              </span>
            )}
          </div>
        )}

        {mode === 'live' && playing && (
          <p className="pointer-events-none absolute bottom-2 right-2 rounded bg-zinc-900/80 px-3 py-2 text-xs text-sky-200">
            Modalità Gioca: usa il gioco normalmente. Premi «Seleziona» per ispezionare.
          </p>
        )}
        {mode === 'live' && !playing && (
          <p className="pointer-events-none absolute right-2 top-2 rounded bg-zinc-900/80 px-3 py-2 text-[11px] text-zinc-200">
            Passa il mouse sul canvas · clicca per identificare · «Gioca» per interagire
          </p>
        )}

        <div className="pointer-events-auto absolute bottom-2 left-2 z-30 max-h-[42%] w-[min(470px,calc(100%-16px))] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900/95 p-2 shadow-xl">
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-zinc-200">
              {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin text-sky-400" /> :
                <Camera className="mr-1 inline h-3.5 w-3.5 text-sky-400" />}
              {busy ? busyLabel + ' · ' + elapsed + 's' :
                error ? 'Errore · dettagli e log' : 'Diagnostica · log ispezione'}
            </summary>
            <div className="mt-2 max-h-32 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] leading-5 text-zinc-300"
              role="log" aria-live="polite">
              {(logs.length ? logs : ['Nessuna analisi avviata']).map((line, i) =>
                <div key={i}>{line}</div>)}
            </div>
            <Button size="sm" variant="ghost" onClick={() => {
              void navigator.clipboard?.writeText(logs.join('\n'))
            }} className="mt-1 h-7 text-[10px] text-zinc-300">Copia log</Button>
          </details>
          {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
          {!error && stats?.partial && !busy && (
            <p className="mt-1 text-[10px] text-amber-200">
              Ricerca parziale ({stats.templates ?? 0} template): per trovare altri
              elementi seleziona uno sprite nella barra laterale.
            </p>
          )}
          {mode === 'live' && !busy && (
            <p className="mt-1 text-[10px] text-zinc-400">
              Aggiornamento controllato ogni 12 s; le evidenziazioni non seguono
              ogni fotogramma. L’analisi cerca gli sprite nella schermata corrente.
            </p>
          )}
        </div>
      </div>
      {matches.length > 0 && !busy && (
        <div className="pointer-events-auto flex max-h-24 shrink-0 gap-1 overflow-x-auto border-t border-zinc-700 bg-zinc-900/95 px-2 py-2">
          {matches.slice(0, 35).map((m, i) => (
            <button key={m.id+':'+m.x+':'+i}
              className="shrink-0 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 hover:border-sky-500"
              onClick={() => onSelectMatch(m)}>{m.name} · {Math.round(m.score*100)}%</button>
          ))}
        </div>
      )}
    </div>
  )
}
