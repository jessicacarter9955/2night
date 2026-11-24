'use client'

import { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2, ChevronDown, Clock3, Compass, Gamepad2,
  Loader2, MousePointer2, RotateCcw, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GameMeta, GameScreen } from '@/lib/asset-types'

type NavResponse = {
  ok: boolean
  error?: string
  state?: string
  alreadyThere?: boolean
  loading?: boolean
}
type NavigatorWindow = Window & {
  __2nightNavigate?: (request: { id: string; difficulty: number }) => NavResponse
  __2nightGetScene?: () => { state: string; ready: boolean }
  _XY?: { _Q63?: { _2L?: unknown[] } }
}
type Status = { kind: 'working' | 'ok' | 'error'; message: string }

interface Props {
  game: GameMeta | null
  screens: GameScreen[]
  frameRef: RefObject<HTMLIFrameElement | null>
  onRestart: () => void
  onInspect: () => void
}

const SONGS = [
  { week: 'Tutorial', songs: [{ id: 'tutorial', name: 'Tutorial' }] },
  { week: 'Week 1 · Daddy Dearest', songs: [
    { id: 'bopeebo', name: 'Bopeebo' },
    { id: 'fresh', name: 'Fresh' },
    { id: 'dadbattle', name: 'Dadbattle' },
  ] },
  { week: 'Week 2 · Spooky Kids', songs: [
    { id: 'spookeez', name: 'Spookeez' },
    { id: 'south', name: 'South' },
    { id: 'monster', name: 'Monster' },
  ] },
  { week: 'Week 3 · Pico', songs: [
    { id: 'pico', name: 'Pico' },
    { id: 'philly', name: 'Philly' },
    { id: 'blammed', name: 'Blammed' },
  ] },
  { week: 'Week 4 · Mommy Mearest', songs: [
    { id: 'satin-panties', name: 'Satin Panties' },
    { id: 'high', name: 'High' },
    { id: 'milf', name: 'MILF' },
  ] },
  { week: 'Week 5 · Christmas', songs: [
    { id: 'cocoa', name: 'Cocoa' },
    { id: 'eggnog', name: 'Eggnog' },
    { id: 'winter-horrorland', name: 'Winter Horrorland' },
  ] },
  { week: 'Week 6 · Senpai', songs: [
    { id: 'senpai', name: 'Senpai' },
    { id: 'roses', name: 'Roses' },
    { id: 'thorns', name: 'Thorns' },
  ] },
]

const FNF_SCREENS = [
  { id: 'title', label: 'Titolo', state: 'TitleState' },
  { id: 'menu', label: 'Menu principale', state: 'MainMenuState' },
  { id: 'freeplay', label: 'Freeplay · lista brani', state: 'FreeplayState' },
  { id: 'story', label: 'Story Mode · settimane', state: 'StoryMenuState' },
]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function keyCode(key: string): number {
  const codes: Record<string, number> = {
    Enter: 13, Escape: 27, ArrowUp: 38,
    ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  }
  return codes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
}

async function gameMakerKey(win: NavigatorWindow, key: string) {
  const code = keyCode(key)
  if (!code) throw new Error('Tasto non supportato: ' + key)

  function send(type: 'keydown' | 'keyup') {
    const event = new KeyboardEvent(type, {
      key, code: key, bubbles: true, cancelable: true,
    })
    Object.defineProperty(event, 'keyCode', { get: () => code })
    Object.defineProperty(event, 'which', { get: () => code })
    // GameMaker's compiled input listener is assigned to window.onkeydown.
    // Calling it directly also works when the iframe is temporarily unfocused.
    const fn = type === 'keydown' ? win.onkeydown : win.onkeyup
    if (typeof fn === 'function') fn.call(win, event)
    else win.dispatchEvent(event)
  }
  send('keydown')
  await delay(175) // It must span a GameMaker update frame.
  send('keyup')
}

export function ScreenSwitcher({
  game, screens, frameRef, onRestart, onInspect,
}: Props) {
  const [open, setOpen] = useState(false)
  const [screen, setScreen] = useState('menu')
  const [song, setSong] = useState('bopeebo')
  const [difficulty, setDifficulty] = useState(1)
  const [status, setStatus] = useState<Status | null>(null)
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)
  const [inspectAfter, setInspectAfter] = useState(true)
  const operation = useRef(0)
  const currentRef = useRef('')
  const isFNF = game?.id === 'friday-night-funkin'
  const gameId = game?.id

  useEffect(() => {
    operation.current += 1
    setBusy(false)
    setStatus(null)
    setCurrent('')
    setScreen('menu')
    setOpen(false)
  }, [gameId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      try {
        const w = frameRef.current?.contentWindow as NavigatorWindow | undefined
        const state = w?.__2nightGetScene?.()
        const name = state?.state ||
          (w?._XY?._Q63?._2L ? 'GameMaker · in esecuzione' : '')
        if (name && name !== currentRef.current) {
          currentRef.current = name
          setCurrent(name)
        }
      } catch { /* iframe navigation or boot */ }
    }, 500)
    return () => window.clearInterval(timer)
  }, [frameRef, gameId])

  const cancel = useCallback(() => {
    operation.current += 1
    setBusy(false)
    setStatus({ kind: 'error', message:
      'Navigazione interrotta. Se il caricamento era già partito, il gioco può continuare.' })
  }, [])

  const navigate = useCallback(async (id: string) => {
    if (!game || busy) return
    const run = ++operation.current
    const stillCurrent = () => operation.current === run
    const progress = (message: string) => {
      if (stillCurrent()) setStatus({ kind: 'working', message })
    }
    const finish = (message: string) => {
      if (!stillCurrent()) return
      setStatus({ kind: 'ok', message })
      setBusy(false)
      if (inspectAfter) onInspect()
    }
    setBusy(true)
    progress('Preparo ' + id.replace('song:', '') + '…')
    try {
      if (game.id === 'friday-night-funkin') {
        let win: NavigatorWindow | null = null
        const start = Date.now()
        while (Date.now() - start < 30000 && stillCurrent()) {
          try {
            const candidate = frameRef.current?.contentWindow as NavigatorWindow | null
            if (candidate?.__2nightNavigate && candidate.__2nightGetScene?.().ready) {
              win = candidate
              break
            }
          } catch { /* Game still loading */ }
          progress('Attendo l’avvio del motore HaxeFlixel…')
          await delay(350)
        }
        if (!win) throw new Error('Motore non pronto entro 30 secondi.')
        if (!stillCurrent()) return

        const result = win.__2nightNavigate?.({ id, difficulty })
        if (!result?.ok) throw new Error(result?.error || 'Navigazione rifiutata dal gioco.')
        const expected = result.state
        if (!expected) throw new Error('Il motore non ha comunicato lo stato di destinazione.')
        const started = Date.now()
        while (stillCurrent() && Date.now() - started < 50000) {
          const state = win.__2nightGetScene?.().state || ''
          if (state === expected) {
            finish('Schermata pronta: ' +
              (id.startsWith('song:') ? id.slice(5) + ' · ' + state : state))
            return
          }
          progress(state === 'LoadingState'
            ? 'Carico chart, audio e texture della partita… ' +
              Math.floor((Date.now() - started) / 1000) + 's'
            : 'Cambio stato: ' + (state || 'attesa') +
              ' → ' + expected + '…')
          await delay(450)
        }
        if (stillCurrent()) throw new Error(
          'Il motore non ha raggiunto ' + expected +
          ' entro 50 secondi. Stato attuale: ' +
          (win.__2nightGetScene?.().state || 'sconosciuto'))
      } else {
        // GameMaker 2 uses obfuscated room controllers in this build.
        // For now use the real game's keyboard-navigation path, rather
        // than corrupting room state. Verify changed instances afterwards.
        const target = screens.find((item) => item.id === id)
        if (!target || target.manualOnly) {
          throw new Error('Schermata disponibile solo con navigazione manuale.')
        }
        progress('Riavvio Chainsaw Dance dal titolo…')
        onRestart()
        if (id === 'title') {
          finish('Gioco riavviato. Attendi il titolo iniziale.')
          return
        }
        await delay(450)
        progress('Avvio il motore GameMaker…')
        await delay(Math.max(game.bootDelayMs, 6500))
        if (!stillCurrent()) return
        const win = frameRef.current?.contentWindow as NavigatorWindow | null
        if (!win || !win.onkeydown) {
          throw new Error('Bridge GameMaker non disponibile. Prosegui manualmente.')
        }
        const before = (win._XY?._Q63?._2L || []).map(
          (o) => (o as { id?: number })?.id).join(',')
        for (let i = 0; i < target.steps.length && stillCurrent(); i++) {
          const step = target.steps[i]
          progress('Passo ' + (i + 1) + '/' + target.steps.length +
            ' · ' + step.k + '…')
          await gameMakerKey(win, step.k)
          await delay(Math.max(900, step.delay))
        }
        if (!stillCurrent()) return
        const after = (win._XY?._Q63?._2L || []).map(
          (o) => (o as { id?: number })?.id).join(',')
        if (before === after) {
          throw new Error('Non riesco a confermare il cambio schermata in GameMaker. ' +
            'Il gioco potrebbe ignorare i tasti sintetici: usa i controlli manuali.')
        }
        finish('Percorso guidato eseguito. Verifica la schermata nel gioco.')
      }
    } catch (error) {
      if (!stillCurrent()) return
      setBusy(false)
      setStatus({ kind: 'error',
        message: error instanceof Error ? error.message : 'Errore sconosciuto' })
    }
  }, [game, busy, frameRef, inspectAfter, onInspect, onRestart, screens, difficulty])

  if (!game) return null
  const supported = isFNF ? FNF_SCREENS.map((item) => ({
    id: item.id, name: item.label,
  })) : screens.filter((item) => !item.manualOnly).map(
    (item) => ({ id: item.id, name: item.name }))
  const target = screen === 'song' ? 'song:' + song : screen

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-label="Apri selettore schermate"
        className="h-9 gap-1.5 border-sky-700/60 bg-sky-950/35 text-xs text-sky-200 hover:bg-sky-900/50">
        <Compass className="h-4 w-4" /> Schermate
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <div className="absolute right-0 top-11 z-[70] w-[min(370px,calc(100vw-24px))] max-h-[min(80vh,680px)] overflow-y-auto rounded-xl border border-sky-600/40 bg-zinc-950 p-3 text-zinc-200 shadow-2xl shadow-black/70">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-sky-200">Vai alla schermata</h3>
              <p className="text-[11px] text-zinc-400">
                {isFNF ? 'Accesso diretto agli stati del gioco' :
                  'Navigazione guidata GameMaker · sperimentale'}
              </p>
            </div>
            <button aria-label="Chiudi selettore" onClick={() => setOpen(false)}
              className="rounded p-1 hover:bg-zinc-800"><X className="h-4 w-4"/></button>
          </div>

          <div className="mb-3 rounded-lg bg-zinc-900/80 px-2.5 py-2 text-[11px]">
            <span className="font-semibold text-zinc-400">Stato corrente:</span>{' '}
            <span className="font-mono text-emerald-300">{current || 'Avvio…'}</span>
          </div>

          <div className="space-y-1">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Schermate
            </div>
            {supported.map((item) => (
              <button key={item.id} disabled={busy}
                onClick={() => setScreen(item.id)}
                className={'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ' +
                  (screen === item.id ? 'border-sky-500 bg-sky-500/15 text-sky-100' :
                    'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600')}>
                <span className={'h-2 w-2 rounded-full ' +
                  (screen === item.id ? 'bg-sky-400' : 'bg-zinc-600')} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>

          {isFNF && (
            <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
              <button disabled={busy} onClick={() => setScreen('song')}
                className={'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs ' +
                  (screen === 'song' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200' :
                    'border-zinc-800 bg-zinc-900 text-zinc-300')}>
                <Gamepad2 className="h-4 w-4" /> Partita già avviata · scegli brano
              </button>
              {screen === 'song' && (
                <div className="grid grid-cols-1 gap-2 rounded-lg bg-zinc-900/70 p-2">
                  <label className="text-[11px] text-zinc-400">
                    Brano
                    <select value={song} disabled={busy} onChange={(e) => setSong(e.target.value)}
                      className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-100">
                      {SONGS.map((week) => (
                        <optgroup key={week.week} label={week.week}>
                          {week.songs.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-zinc-400">
                    Difficoltà
                    <select value={difficulty} disabled={busy}
                      onChange={(e) => setDifficulty(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-100">
                      <option value={0}>Easy</option>
                      <option value={1}>Normal</option>
                      <option value={2}>Hard</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          )}

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" checked={inspectAfter}
              onChange={(event) => setInspectAfter(event.target.checked)}
              className="accent-sky-500" />
            Apri inspector LIVE dopo il caricamento
          </label>

          <div className="mt-3 flex gap-2">
            {busy ? (
              <Button variant="outline" onClick={cancel} className="h-9 flex-1">
                <X className="mr-1.5 h-4 w-4" /> Interrompi attesa
              </Button>
            ) : (
              <Button onClick={() => void navigate(target)}
                className="h-9 flex-1 bg-sky-600 text-white hover:bg-sky-500">
                <MousePointer2 className="mr-1.5 h-4 w-4" />
                {screen === 'song' ? 'Avvia partita' : 'Vai alla schermata'}
              </Button>
            )}
          </div>

          {status && (
            <div role="status" aria-live="polite"
              className={'mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-[11px] ' +
                (status.kind === 'error' ? 'border-red-700 bg-red-950/40 text-red-200' :
                  status.kind === 'ok' ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' :
                  'border-sky-800 bg-sky-950/30 text-sky-200')}>
              {status.kind === 'working'
                ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                : status.kind === 'ok'
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{status.message}</span>
            </div>
          )}

          {!isFNF && (
            <p className="mt-3 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-amber-200/90">
              GameMaker non espone un bridge nativo di navigazione.
              La procedura riavvia il gioco e prova i comandi di menu;
              se il runtime li ignora, ti avviserà senza fingere che la schermata sia pronta.
            </p>
          )}
          {isFNF && (
            <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
              Per un brano il motore deve caricare chart, musica e texture.
              Puoi continuare a usare l’inspector durante il caricamento.
              Pausa e Game Over rimangono schermate contestuali.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
