export interface AtlasFrame {
  name: string
  x: number; y: number; w: number; h: number
  frameX: number; frameY: number
  logicalW: number; logicalH: number
  rectKey: string
  sharedWith: string[]
}
export interface AtlasDocument {
  pngUrl: string
  xmlUrl: string
  width: number
  height: number
  frames: AtlasFrame[]
  byName: Map<string, AtlasFrame>
  distinctRectangles: number
}
export type AtlasPatch = { name: string; image: HTMLImageElement }

function integer(element: Element, key: string, fallback = 0): number {
  const raw = element.getAttribute(key)
  if (raw === null) return fallback
  const result = Number(raw)
  return Number.isFinite(result) ? result : fallback
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Immagine non caricabile: ' + src))
    image.src = src
  })
}

export async function loadAtlas(
  pngUrl: string,
  signal?: AbortSignal,
): Promise<{ document: AtlasDocument; image: HTMLImageElement }> {
  if (!pngUrl.toLowerCase().endsWith('.png')) {
    throw new Error('L’asset selezionato non è un atlante PNG')
  }
  const xmlUrl = pngUrl.slice(0, -4) + '.xml'
  const [response, image] = await Promise.all([
    fetch(xmlUrl, { signal, cache:'force-cache' }), loadImage(pngUrl),
  ])
  if (!response.ok) {
    throw new Error('Metadata XML assenti (HTTP ' + response.status + '): ' + xmlUrl)
  }
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('Atlas XML non valido')
  const entries = Array.from(xml.querySelectorAll('SubTexture'))
  if (!entries.length) throw new Error('Nessun SubTexture nell’XML')
  const frames: AtlasFrame[] = []
  const rectMap = new Map<string, string[]>()
  for (const element of entries) {
    const name = element.getAttribute('name') || ''
    const x = integer(element,'x'), y = integer(element,'y')
    const w = integer(element,'width'), h = integer(element,'height')
    const frameX = integer(element,'frameX')
    const frameY = integer(element,'frameY')
    const logicalW = integer(element,'frameWidth',w)
    const logicalH = integer(element,'frameHeight',h)
    if (!name || w<=0 || h<=0 || x<0 || y<0 ||
        x+w>image.naturalWidth || y+h>image.naturalHeight) continue
    const rectKey = [x,y,w,h].join(':')
    const group = rectMap.get(rectKey) || []
    group.push(name)
    rectMap.set(rectKey,group)
    frames.push({
      name,x,y,w,h,frameX,frameY,logicalW,logicalH,rectKey,sharedWith:[],
    })
  }
  for (const frame of frames) {
    frame.sharedWith = (rectMap.get(frame.rectKey) || [])
      .filter((name)=>name!==frame.name)
  }
  const doc: AtlasDocument = {
    pngUrl,xmlUrl,width:image.naturalWidth,height:image.naturalHeight,
    frames,byName:new Map(frames.map((frame)=>[frame.name,frame])),
    distinctRectangles:rectMap.size,
  }
  return {document:doc,image}
}

export async function readPatch(file: File, frame: AtlasFrame): Promise<AtlasPatch> {
  if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
    throw new Error('Carica un file PNG con trasparenza')
  }
  if (file.size>8*1024*1024) throw new Error('PNG troppo grande (max 8 MB)')
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    if (image.naturalWidth!==frame.w || image.naturalHeight!==frame.h) {
      throw new Error(
        'Dimensioni errate: ' + image.naturalWidth + '×' + image.naturalHeight +
        '. Il frame selezionato richiede ' + frame.w + '×' + frame.h +
        ' px. Per modificare dimensioni/offset servirebbe rigenerare l’XML.',
      )
    }
    return {name:frame.name,image}
  } finally {
    // Image decode is complete; the browser retains the loaded pixel buffer.
    URL.revokeObjectURL(url)
  }
}

export async function composeAtlas(
  atlas: AtlasDocument,
  image: HTMLImageElement,
  patches: Map<string, AtlasPatch>,
): Promise<{blob:Blob;dataUrl:string}> {
  if (atlas.width*atlas.height>48_000_000) {
    throw new Error('Atlante troppo grande per composizione sicura nel browser')
  }
  const canvas = document.createElement('canvas')
  canvas.width = atlas.width
  canvas.height = atlas.height
  const ctx = canvas.getContext('2d', {willReadFrequently:false})
  if (!ctx) throw new Error('Canvas 2D non disponibile')
  ctx.clearRect(0,0,canvas.width,canvas.height)
  ctx.drawImage(image,0,0)
  const applied = new Map<string,string>()
  for (const patch of patches.values()) {
    const frame = atlas.byName.get(patch.name)
    if (!frame) continue
    const prior = applied.get(frame.rectKey)
    if (prior && prior!==frame.name) {
      throw new Error(
        'Conflitto: i frame ' + prior + ' e ' + frame.name +
        ' condividono lo stesso rettangolo. Occorre una sola sostituzione.',
      )
    }
    ctx.clearRect(frame.x,frame.y,frame.w,frame.h)
    ctx.drawImage(patch.image,frame.x,frame.y)
    applied.set(frame.rectKey,frame.name)
  }
  const blob = await new Promise<Blob>((resolve,reject)=>{
    canvas.toBlob((result)=>result?resolve(result):
      reject(new Error('Esportazione PNG fallita')),'image/png')
  })
  const dataUrl = await new Promise<string>((resolve,reject)=>{
    const reader = new FileReader()
    reader.onload = ()=>resolve(String(reader.result))
    reader.onerror = ()=>reject(new Error('Conversione PNG fallita'))
    reader.readAsDataURL(blob)
  })
  canvas.width = 0;canvas.height = 0
  return {blob,dataUrl}
}

export function downloadBlob(blob:Blob,name:string):void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),5000)
}
