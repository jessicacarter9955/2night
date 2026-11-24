'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download, Gamepad2, Loader2, Maximize2, MousePointer2,
  PanelLeftClose, PanelLeftOpen, Repeat,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssetSidebar } from '@/components/asset-sidebar'
import { AssetInspector } from '@/components/asset-inspector'
import { NativeInspectorOverlay } from '@/components/native-inspector-overlay'
import { ScreenSwitcher } from '@/components/screen-switcher'
import { AnimationWorkbench } from '@/components/animation-workbench'
import { RuntimeElement } from '@/lib/runtime-inspector'
import {
  GameRegistry, GameScreen, GamesIndex, RegistryAsset,
  ReskinState, downloadJson,
} from '@/lib/asset-types'
import { normalizeRegistry } from '@/lib/registry'

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
  const [inspectOpen, setInspectOpen] = useState(false)
  const [animationElement, setAnimationElement] = useState<RuntimeElement | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const activeGame = games.find((g) => g.id === activeId) ?? null

  useEffect(() => {
    fetch('/games/index.json')
      .then((response) => {
        if (!response.ok) throw new Error('Impossibile leggere il registro giochi')
        return response.json()
      })
      .then((index: GamesIndex) => {
        setGames(index.games)
        setActiveId(index.games[0]?.id ?? null)
      })
      .catch((error) => console.error('[2Night] Games index', error))
  }, [])

  useEffect(() => {
    const game = games.find((entry) => entry.id === activeId)
    if (!game) return
    let cancelled = false
    setInspectOpen(false)
    setAnimationElement(null)
    setLoaded(false)
    setRegistry(null)
    setScreens([])
    setReskin({})
    setSelected(null)
    const readJson = async <T,>(url: string, fallback: T): Promise<T> => {
      try {
        const response = await fetch(url)
        return response.ok ? (await response.json()) as T : fallback
      } catch {
        return fallback
      }
    }
    void (async () => {
      const [reg, scr, res] = await Promise.all([
        readJson<GameRegistry | null>(game.registry, null),
        readJson<{ screens: GameScreen[] }>(game.screens, { screens: [] }),
        readJson<{ state: ReskinState }>(
          '/api/reskin?game=' + encodeURIComponent(game.id),
          { state: {} },
        ),
      ])
      if (cancelled) return
      setRegistry(reg)
      setScreens(scr.screens ?? [])
      setReskin(res.state ?? {})
    })()
    return () => { cancelled = true }
  }, [games, activeId])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    const timer = window.setInterval(() => {
      try {
        const doc = iframeRef.current?.contentDocument
        if (doc && doc.location.href.includes('/games/') &&
          doc.readyState === 'complete') {
          if (!cancelled) setLoaded(true)
          window.clearInterval(timer)
        }
      } catch { /* iframe navigating */ }
    }, 250)
    const timeout = window.setTimeout(() => {
      if (!cancelled) setLoaded(true)
    }, 12000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.clearTimeout(timeout)
    }
  }, [activeId, reloadToken])

  const normalized = useMemo(
    () => registry ? normalizeRegistry(registry) : null,
    [registry],
  )
  const assetById = useMemo(() => {
    const assets = new Map<string, RegistryAsset>()
    for (const section of normalized?.sections ?? []) {
      for (const item of section.items) assets.set(item.id, item)
    }
    return assets
  }, [normalized])

  const resetGame = useCallback(() => {
    setInspectOpen(false)
    setAnimationElement(null)
    setLoaded(false)
    setSelected(null)
    setReloadToken((value) => value + 1)
  }, [])

  const switchGame = useCallback(() => {
    if (!games.length) return
    const current = games.findIndex((entry) => entry.id === activeId)
    setActiveId(games[(current + 1) % games.length].id)
  }, [activeId, games])

  const selectAsset = useCallback((asset: RegistryAsset) => {
    setSelected(asset)
    setShowInspector(true)
  }, [])

  const selectRuntimeElement = useCallback((item: RuntimeElement) => {
    if (!item.assetId) return
    const asset = assetById.get(item.assetId)
    if (asset) {
      setSelected(asset)
      setShowInspector(true)
    }
  }, [assetById])

  const refreshReskin = useCallback(() => {
    if (!activeGame) return
    fetch('/api/reskin?game=' + encodeURIComponent(activeGame.id))
      .then((response) => response.json())
      .then((data: { state: ReskinState }) => setReskin(data.state ?? {}))
      .catch((error) => console.warn('[2Night] Reskin state', error))
  }, [activeGame])

  const exportRegistry = useCallback(() => {
    if (!activeGame || !registry) return
    downloadJson(activeGame.id + '-registro.json', {
      game: activeGame.id, registry, screens, reskin,
    })
  }, [activeGame, registry, reskin, screens])

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="relative z-40 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" title="Pannello asset"
            aria-label="Mostra/nascondi il pannello asset"
            onClick={() => setShowSidebar((value) => !value)}
            className="h-9 w-9 border-zinc-700 bg-zinc-800/60 text-zinc-300">
            {showSidebar ? <PanelLeftClose className="h-5 w-5" /> :
              <PanelLeftOpen className="h-5 w-5" />}
          </Button>
          <Gamepad2 className="h-6 w-6 text-red-500" />
          <span className="text-lg font-bold tracking-tight">
            2Night <span className="text-zinc-400">Inspector</span>
          </span>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
          {games.map((game) => (
            <button key={game.id} role="tab" aria-selected={game.id === activeId}
              onClick={() => setActiveId(game.id)}
              className={'min-h-[44px] rounded-lg border px-3 py-2 text-sm font-semibold ' +
                (game.id === activeId
                  ? 'border-red-500 bg-red-500/15 text-red-400'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500')}>
              {game.name}
            </button>
          ))}
          <Button onClick={switchGame} size="lg" disabled={!games.length}
            className="gap-2 rounded-lg bg-red-600 px-5 font-bold text-white hover:bg-red-500">
            <Repeat className="h-5 w-5" /> Cambia gioco
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <ScreenSwitcher
            game={activeGame}
            screens={screens}
            frameRef={iframeRef}
            onRestart={resetGame}
            onInspect={() => setInspectOpen(true)}
          />
          {registry && (
            <Button variant="outline" size="sm" onClick={exportRegistry}
              className="h-9 gap-1.5 border-zinc-700 bg-zinc-800/60 text-xs text-zinc-300">
              <Download className="h-3.5 w-3.5" /> Export JSON
            </Button>
          )}
          <Button variant="outline" size="icon" title="Fullscreen"
            aria-label="Schermo intero"
            className="h-9 w-9 border-zinc-700 bg-zinc-800/60 text-zinc-300"
            onClick={() => {
              const stage = stageRef.current
              if (!stage) return
              if (document.fullscreenElement) void document.exitFullscreen()
              else void stage.requestFullscreen()
            }}>
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {normalized && showSidebar && (
          <>
            <div className="fixed inset-0 z-30 bg-black/60 lg:hidden"
              aria-hidden="true" onClick={() => setShowSidebar(false)} />
            <div className="fixed inset-y-0 left-0 z-40 w-[300px] lg:static lg:z-auto lg:w-[300px] lg:shrink-0">
              <AssetSidebar gameId={activeGame?.id ?? ''}
                gameName={activeGame?.name ?? ''} normalized={normalized}
                selected={selected} onSelect={selectAsset}
                onClose={() => setShowSidebar(false)} />
            </div>
          </>
        )}

        <main ref={stageRef} className="relative min-w-0 flex-1 bg-black">
          {activeGame && (
            <iframe key={activeId + '-' + reloadToken} ref={iframeRef}
              src={activeGame.src} title={activeGame.name}
              className="absolute inset-0 h-full w-full border-0"
              allow="fullscreen; autoplay; gamepad" />
          )}
          {!inspectOpen && activeGame && (
            <button onClick={() => setInspectOpen(true)}
              title="Ispeziona al passaggio del mouse gli sprite del gioco corrente"
              className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-sky-400 bg-zinc-900/90 px-3 py-2 text-xs font-bold text-sky-200 shadow-lg hover:bg-sky-950">
              <MousePointer2 className="h-4 w-4" /> Ispeziona LIVE
            </button>
          )}
          {inspectOpen && activeGame && (
            <NativeInspectorOverlay
              key={activeId + '-' + reloadToken}
              frameRef={iframeRef} gameId={activeGame.id}
              registry={registry}
              selectedAssetId={selected?.id ?? null}
              onSelectElement={selectRuntimeElement}
              onOpenAnimation={(item) => setAnimationElement(item)}
              onClose={() => {setInspectOpen(false);setAnimationElement(null)}}
            />
          )}
          {animationElement && activeGame && (
            <AnimationWorkbench
              key={activeGame.id+':'+animationElement.id}
              gameId={activeGame.id}
              element={animationElement}
              registry={registry}
              frameRef={iframeRef}
              onClose={() => setAnimationElement(null)}
            />
          )}
          {!loaded && !inspectOpen && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90"
              aria-hidden="true">
              <Loader2 className="h-10 w-10 animate-spin text-red-500" />
              <p className="max-w-xs text-center text-sm text-zinc-300">
                Caricamento {activeGame?.name ?? 'gioco'}…
              </p>
            </div>
          )}
        </main>

        {selected && registry && showInspector && (
          <>
            <div className="fixed inset-0 z-30 bg-black/60 xl:hidden"
              aria-hidden="true" onClick={() => setShowInspector(false)} />
            <div className="fixed inset-y-0 right-0 z-40 w-[340px] xl:static xl:z-auto xl:w-[340px] xl:shrink-0">
              <AssetInspector asset={selected} registry={registry}
                reskin={reskin}
                onInspectAsset={() => setInspectOpen(true)}
                onReloadGame={resetGame} onReskinChanged={refreshReskin}
                onClose={() => {
                  setShowInspector(false)
                  setSelected(null)
                }} />
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-4 py-1.5 text-xs text-zinc-500">
        <span className="truncate">
          {activeGame?.name} <span className="text-zinc-700">·</span>{' '}
          {activeGame?.controls}
        </span>
        <span className="hidden shrink-0 text-emerald-400 sm:inline">
          Inspector nativo · hover · niente OpenCV
        </span>
      </div>
    </div>
  )
}
