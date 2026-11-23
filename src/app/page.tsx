'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  Gamepad2,
  Loader2,
  Maximize2,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssetSidebar } from '@/components/asset-sidebar'
import { AssetInspector } from '@/components/asset-inspector'
import {
  InspectOverlay,
  InspectMatch,
  InspectStats,
  InspectMode,
} from '@/components/inspect-overlay'
import {
  GameRegistry,
  GameScreen,
  GamesIndex,
  RegistryAsset,
  ReskinState,
  downloadJson,
} from '@/lib/asset-types'
import { normalizeRegistry } from '@/lib/registry'
import { captureGameCanvas, dropLiveMirror } from '@/lib/capture'

export default function Home() {
  const [games, setGames] = useState<GamesIndex['games']>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [registry, setRegistry] = useState<GameRegistry | null>(null)
  const [screens, setScreens] = useState<GameScreen[]>([])
  const [reskin, setReskin] = useState<ReskinState>({})
  const [selected, setSelected] = useState<RegistryAsset | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showInspector, setShowInspector] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  // stato della modalità ispezione (schermata fissa stile DevTools)
  const [inspectOpen, setInspectOpen] = useState(false)
  const [inspectSnapshot, setInspectSnapshot] = useState<string | null>(null)
  const [inspectMatches, setInspectMatches] = useState<InspectMatch[]>([])
  const [inspectStats, setInspectStats] = useState<InspectStats | null>(null)
  const [inspectBusy, setInspectBusy] = useState(false)
  const [inspectBusyLabel, setInspectBusyLabel] = useState('Catturo la schermata…')
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [inspectMode, setInspectMode] = useState<InspectMode>('live')
  const [inspectPlaying, setInspectPlaying] = useState(false)
  const [inspectLogs, setInspectLogs] = useState<string[]>([])
  const [inspectElapsed, setInspectElapsed] = useState(0)
  const inspectController = useRef<AbortController | null>(null)
  const inspectRunId = useRef(0)
  const inspectBusyRef = useRef(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Indice giochi generico: nuovi giochi appaiono aggiungendo una cartella
  useEffect(() => {
    fetch('/games/index.json')
      .then((r) => r.json())
      .then((idx: GamesIndex) => {
        setGames(idx.games)
        setActiveId(idx.games[0]?.id ?? null)
      })
      .catch(() => setGames([]))
  }, [])

  // Registro reale + schermate + stato reskin del gioco attivo
  useEffect(() => {
    const game = games.find((g) => g.id === activeId)
    if (!game) return
    setRegistry(null)
    setScreens([])
    setReskin({})
    setSelected(null)
    inspectRunId.current++
    inspectController.current?.abort()
    inspectBusyRef.current = false
    dropLiveMirror()
    setInspectBusy(false)
    setInspectMode('live')
    setInspectPlaying(false)
    setInspectLogs([])
    setInspectOpen(false)
    setInspectSnapshot(null)
    setInspectMatches([])
    setInspectStats(null)
    setInspectError(null)
    const safeJson = async <T,>(url: string, fallback: T): Promise<T> => {
      try {
        const r = await fetch(url)
        if (!r.ok) return fallback
        return (await r.json()) as T
      } catch {
        return fallback
      }
    }
    void (async () => {
      const [reg, scr, res] = await Promise.all([
        safeJson<GameRegistry | null>(game.registry, null),
        safeJson<{ screens: GameScreen[] }>(game.screens, { screens: [] }),
        safeJson<{ state: ReskinState }>('/api/reskin?game=' + game.id, { state: {} }),
      ])
      setRegistry(reg)
      setScreens(scr.screens ?? [])
      setReskin(res.state ?? {})
    })()
  }, [games, activeId])

  const normalized = useMemo(
    () => (registry ? normalizeRegistry(registry) : null),
    [registry],
  )

  // mappa id → asset per collegare i match dell'ispezione alla sidebar
  const assetById = useMemo(() => {
    const m = new Map<string, RegistryAsset>()
    for (const s of normalized?.sections ?? []) {
      for (const a of s.items) m.set(a.id, a)
    }
    return m
  }, [normalized])

  // readyState polling: l'evento load può scattare prima dell'idratazione.
  // Il documento conta solo se è quello del gioco (non about:blank né il
  // documento precedente): così lo switch non resta "caricamento" eterno.
  useEffect(() => {
    let cancelled = false
    const timer = window.setInterval(() => {
      const frame = iframeRef.current
      try {
        const doc = frame?.contentDocument
        if (
          doc &&
          doc.location.href.includes('/games/') &&
          doc.readyState === 'complete'
        ) {
          setLoaded(true)
          window.clearInterval(timer)
        }
      } catch {
        /* navigazione in corso */
      }
    }, 250)
    const fallback = window.setTimeout(() => {
      if (!cancelled) setLoaded(true)
    }, 12000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.clearTimeout(fallback)
    }
  }, [activeId, reloadToken])

  const activeGame = games.find((g) => g.id === activeId) ?? null

  const resetTransient = useCallback(() => {
    inspectRunId.current++
    inspectController.current?.abort()
    inspectBusyRef.current = false
    dropLiveMirror()
    setInspectOpen(false)
    setInspectBusy(false)
    setSelected(null)
    setLoaded(false)
    setReloadToken((t) => t + 1)
  }, [])

  const switchGame = useCallback(() => {
    if (!games.length) return
    resetTransient()
    setActiveId((id) => {
      const i = games.findIndex((g) => g.id === id)
      return games[(i + 1) % games.length].id
    })
  }, [games, resetTransient])

  const selectGame = useCallback(
    (id: string) => {
      if (id === activeId) return
      resetTransient()
      setActiveId(id)
    },
    [activeId, resetTransient],
  )

  const goFullscreen = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen()
  }, [])

  const refreshReskin = useCallback(() => {
    if (!activeGame) return
    fetch('/api/reskin?game=' + activeGame.id)
      .then((r) => r.json())
      .then((d: { state: ReskinState }) => setReskin(d.state ?? {}))
      .catch(() => undefined)
  }, [activeGame])

  const cancelInspect = useCallback(() => {
    inspectRunId.current++
    inspectController.current?.abort()
    inspectController.current = null
    inspectBusyRef.current = false
    setInspectBusy(false)
    setInspectLogs((logs) => [...logs.slice(-15), '[browser] Analisi interrotta'])
    setInspectBusyLabel('Analisi interrotta')
  }, [])

  // A request is bounded on both sides. A terminated Vercel function returns
  // a diagnostic error instead of leaving the user on "Catturo..." forever.
  const runInspect = useCallback(
    async (opts?: { mode?: InspectMode; only?: string[] }) => {
      if (!activeGame) return
      const mode = opts?.mode ?? inspectMode
      const only = opts?.only ??
        ((selected?.kind === 'sprite' || selected?.kind === 'image')
          ? [selected.id] : [])
      inspectController.current?.abort()
      const controller = new AbortController()
      inspectController.current = controller
      const run = ++inspectRunId.current
      inspectBusyRef.current = true
      setInspectOpen(true)
      setInspectBusy(true)
      setInspectError(null)
      setInspectElapsed(0)
      setInspectMatches([])
      setInspectStats(null)
      setInspectLogs([])
      const started = Date.now()
      const log = (message: string) => {
        if (run !== inspectRunId.current) return
        console.info('[2Night Inspect]', message)
        setInspectBusyLabel(message)
        setInspectLogs((entries) => [...entries.slice(-17),
          '[' + Math.floor((Date.now()-started)/1000) + 's] ' + message])
      }
      const tick = window.setInterval(() => {
        if (run === inspectRunId.current) {
          setInspectElapsed(Math.floor((Date.now()-started)/1000))
        }
      }, 1000)
      const deadline = window.setTimeout(() => controller.abort(), 25000)
      try {
        log('Cerco il canvas del gioco in questa schermata…')
        const shot = await captureGameCanvas(iframeRef.current, {
          signal: controller.signal, onProgress: log,
        })
        if (controller.signal.aborted) throw new Error('Timeout di cattura')
        if (!shot) throw new Error(
          'Impossibile catturare il canvas. Il gioco potrebbe non aver ancora ' +
          'disegnato il primo frame oppure il browser blocca WebGL/captureStream. ' +
          'Prova dopo il caricamento o cambia schermata.',
        )
        if (mode === 'snapshot') setInspectSnapshot(shot)
        log('Frame acquisito (' + Math.round(shot.length/1024) +
          ' KB). Invio ' + (only.length ? only.length + ' asset selezionati' :
            'ricerca rapida limitata') + ' al matcher OpenCV…')
        const response = await fetch('/api/inspect_cv', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ game: activeGame.id, image: shot, only }),
        })
        const body = await response.text()
        let data: { matches?: InspectMatch[]; stats?: InspectStats; error?: string }
        try { data = JSON.parse(body) } catch {
          throw new Error('Il server non ha restituito JSON (HTTP ' +
            response.status + '). Potrebbe aver esaurito la memoria.')
        }
        if (!response.ok) throw new Error(data.error ||
          'Errore server HTTP ' + response.status)
        if (run !== inspectRunId.current) return
        const matches = data.matches ?? []
        setInspectMatches(matches)
        setInspectStats(data.stats ?? null)
        const ms = data.stats?.elapsedMs ?? 0
        log('Analisi completata: ' + matches.length + ' match · ' +
          (data.stats?.templates ?? 0) + ' template · ' + ms + ' ms server')
        if (matches.length === 0) {
          log('Nessun match. Prova a selezionare un altro sprite dalla sidebar; ' +
            'la scansione rapida non include tutte le risorse.')
        }
      } catch (error) {
        if (run !== inspectRunId.current) return
        const message = controller.signal.aborted
          ? 'Analisi scaduta dopo 25 secondi o annullata. La funzione Vercel ' +
            'potrebbe essere lenta o aver superato la memoria. Riprova ' +
            'selezionando un singolo sprite.'
          : (error instanceof Error ? error.message : 'Errore sconosciuto')
        log('ERRORE: ' + message)
        setInspectError(message)
      } finally {
        window.clearTimeout(deadline)
        window.clearInterval(tick)
        if (run === inspectRunId.current) {
          inspectBusyRef.current = false
          inspectController.current = null
          setInspectBusy(false)
        }
      }
    },
    [activeGame, inspectMode, selected],
  )

  const onSelectAsset = useCallback((a: RegistryAsset) => {
    setSelected(a)
    setShowInspector(true)
    if (inspectOpen && inspectMode === 'live' &&
      (a.kind === 'sprite' || a.kind === 'image')) {
      void runInspect({ mode: 'live', only: [a.id] })
    }
  }, [inspectOpen, inspectMode, runInspect])

  const closeInspect = useCallback(() => {
    cancelInspect()
    setInspectOpen(false)
    dropLiveMirror()
  }, [cancelInspect])

  const toggleInspectMode = useCallback(() => {
    const next = inspectMode === 'live' ? 'snapshot' : 'live'
    setInspectMode(next)
    setInspectPlaying(false)
    void runInspect({ mode: next })
  }, [inspectMode, runInspect])

  useEffect(() => {
    if (!inspectOpen || inspectMode !== 'live' || inspectError) return
    const timer = window.setInterval(() => {
      if (!inspectBusyRef.current && document.visibilityState === 'visible') {
        void runInspect({ mode: 'live' })
      }
    }, 12000)
    return () => window.clearInterval(timer)
  }, [inspectOpen, inspectMode, inspectError, runInspect])

  const onSelectMatch = useCallback(
    (m: InspectMatch) => {
      const a = assetById.get(m.id)
      if (a) {
        setSelected(a)
        setShowInspector(true)
      }
    },
    [assetById],
  )

  const reloadGame = useCallback(() => {
    resetTransient()
  }, [resetTransient])

  const exportFiltered = useCallback(() => {
    if (!normalized || !activeGame) return
    downloadJson(`${activeGame.id}-registro.json`, {
      game: activeGame.id,
      registry,
      screens,
      reskin,
    })
  }, [normalized, activeGame, registry, screens, reskin])

  const loadingVisible = !loaded
  const inspectTargetId = selected?.id ?? null

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowSidebar((v) => !v)}
            aria-label="Mostra/nascondi pannello asset"
            title="Pannello asset"
            className="h-9 w-9 border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 hover:text-white"
          >
            {showSidebar ? (
              <PanelLeftClose className="h-5 w-5" />
            ) : (
              <PanelLeftOpen className="h-5 w-5" />
            )}
          </Button>
          <Gamepad2 className="h-6 w-6 text-red-500" aria-hidden="true" />
          <span className="text-lg font-bold tracking-tight">
            2Night <span className="text-zinc-400">Inspector</span>
          </span>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
          {games.map((g) => (
            <button
              key={g.id}
              role="tab"
              aria-selected={g.id === activeId}
              onClick={() => selectGame(g.id)}
              className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                g.id === activeId
                  ? 'border-red-500 bg-red-500/15 text-red-400'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {g.name}
            </button>
          ))}
          <Button
            onClick={switchGame}
            size="lg"
            disabled={!games.length}
            className="gap-2 rounded-lg bg-red-600 px-5 font-bold text-white shadow-lg shadow-red-600/25 hover:bg-red-500"
            aria-label="Passa all'altro gioco"
          >
            <Repeat className="h-5 w-5" aria-hidden="true" />
            Cambia gioco
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {registry && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportFiltered}
              className="h-9 gap-1.5 border-zinc-700 bg-zinc-800/60 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              <Download className="h-3.5 w-3.5" /> Export JSON
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={goFullscreen}
            aria-label="Schermo intero"
            title="Schermo intero"
            className="h-9 w-9 border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700 hover:text-white"
          >
            <Maximize2 className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {normalized && showSidebar && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/60 lg:hidden"
              onClick={() => setShowSidebar(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 left-0 z-40 w-[300px] lg:static lg:z-auto lg:w-[300px] lg:shrink-0">
              <AssetSidebar
                gameId={activeGame?.id ?? ''}
                gameName={activeGame?.name ?? ''}
                normalized={normalized}
                selected={selected}
                onSelect={onSelectAsset}
                onClose={() => setShowSidebar(false)}
              />
            </div>
          </>
        )}

        <main ref={stageRef} className="relative min-w-0 flex-1 bg-black">
          {activeGame && (
            <iframe
              key={`${activeId}-${reloadToken}`}
              ref={iframeRef}
              src={activeGame.src}
              title={activeGame.name}
              className="absolute inset-0 h-full w-full border-0"
              allow="fullscreen; autoplay; gamepad"
            />
          )}

          {/* pulsante cursore: entra in modalità ispezione, come in DevTools */}
          {!inspectOpen && (
            <button
              onClick={() => { setInspectMode('live'); setInspectPlaying(false); void runInspect({ mode: 'live' }) }}
              disabled={inspectBusy}
              title="Ispeziona gli elementi della schermata attuale (snapshot + confronto pixel)"
              aria-label="Ispeziona elementi"
              className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-900/85 px-3 py-2 text-xs font-bold text-zinc-200 shadow-lg transition-colors hover:border-sky-400/60 hover:text-sky-300"
            >
              <MousePointerClick className="h-4 w-4" aria-hidden="true" />
              Ispeziona
            </button>
          )}

          {inspectOpen && (
            <InspectOverlay
              gameId={activeGame?.id ?? ''}
              frame={iframeRef.current}
              mode={inspectMode}
              playing={inspectPlaying}
              snapshot={inspectSnapshot}
              matches={inspectMatches}
              stats={inspectStats}
              busy={inspectBusy}
              busyLabel={inspectBusyLabel}
              elapsed={inspectElapsed}
              logs={inspectLogs}
              error={inspectError}
              selectedId={selected?.id ?? null}
              onRefresh={() => void runInspect({ mode: inspectMode })}
              onCancel={cancelInspect}
              onToggleMode={toggleInspectMode}
              onTogglePlaying={() => setInspectPlaying((p) => !p)}
              onSelectMatch={onSelectMatch}
              onPickPoint={({ x, y }) => {
                setInspectLogs((lines) => [...lines.slice(-17),
                  'Punto sul canvas: ' + x + ', ' + y +
                  '. Seleziona una texture/sprite nella sidebar per cercarlo.'])
              }}
              onClose={closeInspect}
            />
          )}

          {loadingVisible && !inspectOpen && (
            <div
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90"
              aria-hidden="true"
            >
              <Loader2 className="h-10 w-10 animate-spin text-red-500" />
              <p className="max-w-xs text-center text-sm text-zinc-300">
                Caricamento {activeGame?.name ?? 'gioco'}…
              </p>
            </div>
          )}
        </main>

        {selected && registry && showInspector && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/60 xl:hidden"
              onClick={() => setShowInspector(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 right-0 z-40 w-[340px] xl:static xl:z-auto xl:w-[340px] xl:shrink-0">
              <AssetInspector
                asset={selected}
                registry={registry}
                reskin={reskin}
                onInspectAsset={() =>
                  void runInspect({ mode: inspectMode, only: [selected.id] })
                }
                onReloadGame={reloadGame}
                onReskinChanged={refreshReskin}
                onClose={() => {
                  setShowInspector(false)
                  setSelected(null)
                }}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-4 py-1.5 text-xs text-zinc-500">
        <span className="truncate">
          {activeGame?.name} <span className="text-zinc-700">·</span>{' '}
          {activeGame?.controls}
        </span>
        {normalized && (
          <span className="hidden shrink-0 sm:inline">
            {normalized.totalItems} elementi registro · file originali
          </span>
        )}
      </div>
    </div>
  )
}
