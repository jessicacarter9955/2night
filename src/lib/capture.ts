// Capture the current frame of the same-origin HTML5 game without stopping it.
// Every async fallback has an explicit deadline: background tabs and paused
// requestAnimationFrame callbacks must never strand the inspector spinner.
interface LiveMirror {
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  stream: MediaStream
}

export interface CaptureOptions {
  onProgress?: (description: string) => void
  signal?: AbortSignal
}

let liveMirror: LiveMirror | null = null

function bounded<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms)
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value) },
      () => { window.clearTimeout(timer); resolve(fallback) },
    )
  })
}

function isBlankImage(url: string): Promise<boolean> {
  return bounded(new Promise<boolean>((resolve) => {
    const img = new Image()
    img.onerror = () => resolve(true)
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 48
        c.height = 27
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(true)
        ctx.drawImage(img, 0, 0, c.width, c.height)
        const data = ctx.getImageData(0, 0, c.width, c.height).data
        let sum = 0
        let squares = 0
        for (let i = 0; i < data.length; i += 4) {
          for (let channel = 0; channel < 3; channel++) {
            const value = data[i + channel]
            sum += value
            squares += value * value
          }
        }
        const n = c.width * c.height * 3
        const mean = sum / n
        resolve(squares / n - mean * mean < 4)
      } catch {
        resolve(true)
      }
    }
    img.src = url
  }), 1100, true)
}

export function dropLiveMirror(): void {
  if (!liveMirror) return
  liveMirror.stream.getTracks().forEach((t) => t.stop())
  liveMirror.video.pause()
  liveMirror.video.srcObject = null
  liveMirror.video.remove()
  liveMirror = null
}

async function viaCaptureStream(
  canvas: HTMLCanvasElement,
  options: CaptureOptions,
): Promise<string | null> {
  try {
    if (typeof canvas.captureStream !== 'function') return null
    if (!liveMirror || liveMirror.canvas !== canvas ||
      liveMirror.stream.getTracks().every((t) => t.readyState === 'ended')) {
      dropLiveMirror()
      options.onProgress?.('Avvio la cattura WebGL tramite stream video…')
      const stream = canvas.captureStream(15)
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      video.style.display = 'none'
      document.body.appendChild(video)
      liveMirror = { canvas, video, stream }
      await bounded(video.play(), 1400, undefined)
      await bounded(new Promise<void>((resolve) => {
        if (video.videoWidth) return resolve()
        video.addEventListener('loadeddata', () => resolve(), { once: true })
      }), 800, undefined)
    }
    if (options.signal?.aborted) return null
    const video = liveMirror.video
    if (!video.videoWidth || !video.videoHeight) return null
    const target = document.createElement('canvas')
    target.width = video.videoWidth
    target.height = video.videoHeight
    const ctx = target.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return target.toDataURL('image/png')
  } catch (error) {
    options.onProgress?.('Cattura video non disponibile: ' +
      (error instanceof Error ? error.message : 'errore del browser'))
    return null
  }
}

export async function captureGameCanvas(
  frame: HTMLIFrameElement | null,
  options: CaptureOptions = {},
): Promise<string | null> {
  try {
    if (options.signal?.aborted) return null
    const w = frame?.contentWindow
    const doc = w?.document
    if (!w || !doc) return null
    const canvas = doc.querySelector('canvas')
    if (!canvas || !canvas.width || !canvas.height) return null

    const shoot = () => {
      try { return canvas.toDataURL('image/png') } catch { return null }
    }
    options.onProgress?.('Canvas trovato: ' + canvas.width + '×' +
      canvas.height + ' px. Leggo il frame…')

    const direct = shoot()
    if (direct && !(await isBlankImage(direct))) return direct
    if (options.signal?.aborted) return null

    options.onProgress?.('Canvas WebGL vuoto: sincronizzo il frame di disegno…')
    const synced = await bounded(new Promise<string | null>((resolve) => {
      window.requestAnimationFrame(() => {
        try {
          w.requestAnimationFrame(() => resolve(shoot()))
        } catch {
          resolve(null)
        }
      })
    }), 850, null)
    if (synced && !(await isBlankImage(synced))) return synced
    if (options.signal?.aborted) return null

    options.onProgress?.('Provo la cattura tramite stream video…')
    const streamed = await viaCaptureStream(canvas, options)
    if (streamed && !(await isBlankImage(streamed))) return streamed

    // Never return a blank canvas as if it were a valid screenshot.
    options.onProgress?.('Il canvas risulta vuoto o non leggibile.')
    return null
  } catch (error) {
    options.onProgress?.('Errore nella cattura: ' +
      (error instanceof Error ? error.message : 'sconosciuto'))
    return null
  }
}
