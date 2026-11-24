'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download,
  Eye, EyeOff, Film, Loader2, Pause, Play, RotateCcw, Save, SkipBack,
  SkipForward, Upload, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { publishReskin } from '@/lib/github-publish'
import { animationAdapter, assetUrl, AnimationClip, AnimationSnapshot } from '@/lib/animation-adapters'
import {
  AtlasDocument, AtlasFrame, AtlasPatch, composeAtlas, downloadBlob,
  loadAtlas, readPatch,
} from '@/lib/atlas-editor'
import type { GameRegistry, GMRegistry } from '@/lib/asset-types'
import type { RuntimeElement } from '@/lib/runtime-inspector'

interface Props {
  gameId: string
  element: RuntimeElement
  registry: GameRegistry | null
  frame: HTMLIFrameElement | null
  onClose: () => void
}

type Working = { blob: Blob; dataUrl: string }
type AtlasLoaded = { doc: AtlasDocument; image: HTMLImageElement }

function FramePreview({ image, frame, replace, active }: {
  image: HTMLImageElement | null; frame?: AtlasFrame
  replace?: HTMLImageElement; active?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const size = 76
    canvas.width = size * devicePixelRatio
    canvas.height = size * devicePixelRatio
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)
    ctx.clearRect(0,0,size,size)
    if (!frame || (!image && !replace)) return
    const scale = Math.min((size-8)/frame.w,(size-8)/frame.h)
    const w = frame.w*scale
    const h = frame.h*scale
    const dx = (size-w)/2
    const dy = (size-h)/2
    ctx.imageSmoothingEnabled = false
    if (replace) ctx.drawImage(replace,dx,dy,w,h)
    else if (image) ctx.drawImage(
      image,frame.x,frame.y,frame.w,frame.h,dx,dy,w,h,
    )
  }, [image,frame,replace])
  return <canvas ref={ref} aria-hidden="true" className={
    'h-[76px] w-[76px] rounded-md ' +
    (active ? 'bg-sky-900/30' : 'bg-zinc-900')
  } />
}

async function loadGameMakerAtlas(
  gameId: string,
  source: string,
  registry: GameRegistry | null,
): Promise<AtlasLoaded> {
  if (!registry || !registry.engine.startsWith('gamemaker')) {
    throw new Error('Registry GameMaker non disponibile')
  }
  const gm = registry as GMRegistry
  const url = assetUrl(gameId,source)
  if (!url) throw new Error('Percorso atlante non valido')
  const spritePages = new Map<number,string>()
  for (const item of gm.textures) spritePages.set(item.index,item.file)
  const rows: AtlasFrame[] = []
  const rectMap = new Map<string,string[]>()
  for (const sprite of gm.sprites) {
    for (let i=0;i<sprite.frames.length;i++) {
      const f = sprite.frames[i]
      if (spritePages.get(f.page) !== source) continue
      const name = sprite.name + '[' + i + ']'
      const rectKey = [f.x,f.y,f.w,f.h].join(':')
      const refs = rectMap.get(rectKey) || []
      refs.push(name)
      rectMap.set(rectKey,refs)
      rows.push({
        name,x:f.x,y:f.y,w:f.w,h:f.h,
        frameX:f.trimX||0,frameY:f.trimY||0,
        logicalW:f.spriteW||sprite.width||f.w,
        logicalH:f.spriteH||sprite.height||f.h,
        rectKey,sharedWith:[],
      })
    }
  }
  for(const row of rows) {
    row.sharedWith = (rectMap.get(row.rectKey)||[])
      .filter((item)=>item!==row.name)
  }
  const image = await new Promise<HTMLImageElement>((resolve,reject)=>{
    const img = new Image()
    img.onload=()=>resolve(img)
    img.onerror=()=>reject(new Error('Texture GameMaker non caricata'))
    img.src=url
  })
  return {
    image,
    doc:{
      pngUrl:url,xmlUrl:'',
      width:image.naturalWidth,height:image.naturalHeight,
      frames:rows,byName:new Map(rows.map((item)=>[item.name,item])),
      distinctRectangles:rectMap.size,
    },
  }
}

function formatBytes(bytes:number):string {
  return bytes > 1024*1024
    ? (bytes/(1024*1024)).toFixed(2)+' MB'
    : (bytes/1024).toFixed(0)+' KB'
}

export function AnimationWorkbench({
  gameId,element,registry,frame,onClose,
}:Props) {
  const adapter = useMemo(()=>animationAdapter(gameId),[gameId])
  const [snapshot,setSnapshot] = useState<AnimationSnapshot | null>(null)
  const [clipName,setClipName] = useState<string>('')
  const [position,setPosition] = useState(0)
  const [timelineExpanded,setTimelineExpanded] = useState(true)
  const [atlas,setAtlas] = useState<AtlasLoaded | null>(null)
  const [atlasError,setAtlasError] = useState<string | null>(null)
  const [status,setStatus] = useState<string | null>(null)
  const [error,setError] = useState<string | null>(null)
  const [busy,setBusy] = useState(false)
  const [patches,setPatches] = useState<Map<string,AtlasPatch>>(new Map())
  const [working,setWorking] = useState<Working | null>(null)
  const [isPreview,setIsPreview] = useState(false)
  const [publishing,setPublishing] = useState(false)
  const [canPublish,setCanPublish] = useState(false)
  const [publishSecret,setPublishSecret] = useState('')
  const [publishStatus,setPublishStatus] = useState('')
  const [showOriginal,setShowOriginal] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const wholeRef = useRef<HTMLInputElement>(null)
  const currentClipRef = useRef<string>('')
  const changedFrameRef = useRef(false)
  const snapshotRef = useRef<AnimationSnapshot | null>(null)

  useEffect(()=>{
    setSnapshot(null)
    setClipName('')
    setPosition(0)
    setPatches(new Map())
    setWorking(null)
    setStatus(null)
    setError(null)
    setIsPreview(false)
    setAtlas(null)
    setAtlasError(null)
    currentClipRef.current=''
    changedFrameRef.current=false
    const update=()=>{
      const next=adapter.inspect(frame,element,registry)
      if(!next) return
      snapshotRef.current=next
      setSnapshot(next)
      if(!currentClipRef.current && next.clips.length) {
        currentClipRef.current=next.activeClip || next.clips[0].name
        setClipName(currentClipRef.current)
      }
      if(!changedFrameRef.current && next.activeClip===currentClipRef.current) {
        setPosition(next.currentPosition)
      }
    }
    update()
    const timer=window.setInterval(update,350)
    return ()=>{
      window.clearInterval(timer)
      adapter.release(frame)
      // Unsaved live previews should not leak into later workbench sessions.
      adapter.restore(frame,element)
    }
  },[adapter,element.id,frame,gameId,registry]) // intentional reset on selected sprite

  useEffect(()=>{
    const source=snapshot?.atlas
    const url=source ? assetUrl(gameId,source) : null
    if(!url) return
    let ignore=false
    const abort = new AbortController()
    setAtlas(null);setAtlasError(null)
    const get=async()=>{
      try {
        const result=gameId==='chainsaw-dance'
          ? await loadGameMakerAtlas(gameId,source,registry)
          : await loadAtlas(url,abort.signal).then((value)=>({
            doc:value.document,image:value.image,
          }))
        if(!ignore) setAtlas(result)
      } catch(e) {
        if(!ignore) setAtlasError(
          e instanceof Error ? e.message : 'Atlante non leggibile')
      }
    }
    void get()
    return ()=>{ignore=true;abort.abort()}
  },[snapshot?.atlas,gameId,registry])

  useEffect(()=>{
    fetch('/api/publish-reskin',{cache:'no-store'})
      .then(r=>r.json()).then((data:{configured?:boolean})=>
        setCanPublish(!!data.configured))
      .catch(()=>setCanPublish(false))
  },[])

  const clips=snapshot?.clips || []
  const clip=clips.find((c)=>c.name===clipName)||clips[0]
  const frameInfo=clip?.frames[position]
  const atlasFrame=atlas?.doc.byName.get(frameInfo?.name||'')
  const framesCount=clip?.frames.length||0
  const patchForFrame=frameInfo && patches.get(frameInfo.name)
  const rectConflicts=atlasFrame?.sharedWith||[]
  const isFNF=gameId==='friday-night-funkin'
  const atlasAvailable=!!atlas?.doc && !!atlas.image
  const hasUnsaved=!!working

  const control=useCallback((action:'freeze'|'unfreeze'|'seek'|'playClip',options?:{
    name?:string;position?:number
  })=>{
    const result=adapter.control(frame,element,action,options)
    if(!result.ok) setError(result.error||'Comando non riuscito')
    else {
      setError(null)
      setStatus(action==='seek'
        ? 'Frame '+String((options?.position??0)+1)+' selezionato nel motore.'
        : action==='freeze'?'Scena e audio congelati.'
        : action==='unfreeze'?'Gameplay ripreso.':'Riproduzione animazione avviata.')
    }
  },[adapter,frame,element])

  const seek=(index:number)=>{
    if(!clip||!framesCount) return
    const next=Math.max(0,Math.min(framesCount-1,index))
    changedFrameRef.current=true
    setPosition(next)
    if(snapshot?.supported) control('seek',{name:clip.name,position:next})
  }
  const chooseClip=(name:string)=>{
    currentClipRef.current=name
    changedFrameRef.current=true
    setClipName(name)
    setPosition(0)
    if(snapshot?.supported) control('seek',{name,position:0})
  }

  const installWorking=async (blob:Blob,dataUrl:string)=>{
    setWorking({blob,dataUrl})
    setBusy(false)
    setStatus('Reskin preparato. Il PNG originale non è stato modificato.')
    if(snapshot?.supported) {
      const result=await adapter.applyAtlas(frame,element,dataUrl)
      if(result.ok) {
        setIsPreview(true)
        setStatus('Anteprima applicata nel renderer HaxeFlixel ('+
          (result.method||'bitmap')+'). Verifica la scena reale.')
      } else {
        setIsPreview(false)
        setError('Anteprima renderer: '+(result.error||'non disponibile')+
          '. Puoi comunque esportare il PNG.')
      }
    }
  }

  const uploadFrame=async (file:File | undefined)=>{
    if(!file||!atlasFrame||!atlas) return
    setBusy(true);setError(null)
    try{
      const patch=await readPatch(file,atlasFrame)
      const next=new Map(patches)
      // A changed rectangle affects every logical frame sharing the pixels.
      for(const f of atlas.doc.frames) {
        if(f.rectKey===atlasFrame.rectKey) next.delete(f.name)
      }
      next.set(patch.name,patch)
      const result=await composeAtlas(atlas.doc,atlas.image,next)
      setPatches(next)
      await installWorking(result.blob,result.dataUrl)
    }catch(e){
      setError(e instanceof Error?e.message:'Impossibile applicare il frame')
    }finally{setBusy(false)}
  }

  const uploadWhole=async(file:File | undefined)=>{
    if(!file||!atlas) return
    setBusy(true);setError(null)
    try{
      if(file.size>16*1024*1024) throw new Error('PNG oltre il limite di 16 MB')
      const url=URL.createObjectURL(file)
      try{
        const image=new Image()
        await new Promise<void>((resolve,reject)=>{
          image.onload=()=>resolve()
          image.onerror=()=>reject(new Error('PNG non leggibile'))
          image.src=url
        })
        if(image.naturalWidth!==atlas.doc.width||
           image.naturalHeight!==atlas.doc.height) {
          throw new Error('L’atlante deve rimanere '+atlas.doc.width+'×'+
            atlas.doc.height+' px, ma il PNG caricato misura '+
            image.naturalWidth+'×'+image.naturalHeight+' px.')
        }
      }finally{URL.revokeObjectURL(url)}
      const dataUrl=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader()
        reader.onload=()=>resolve(String(reader.result))
        reader.onerror=()=>reject(new Error('Conversione fallita'))
        reader.readAsDataURL(file)
      })
      setPatches(new Map())
      await installWorking(file,dataUrl)
    }catch(e){
      setError(e instanceof Error?e.message:'Impossibile importare')
    }finally{setBusy(false)}
  }

  const resetWorking=()=>{
    const result=adapter.restore(frame,element)
    if(!result.ok && snapshot?.supported) {
      setError(result.error||'Ripristino fallito')
      return
    }
    setPatches(new Map())
    setWorking(null)
    setIsPreview(false)
    setStatus('Originale ripristinato nel motore.')
    setError(null)
  }
  const togglePreview=async()=>{
    if(!working)return
    setBusy(true)
    if(isPreview) {
      const r=adapter.restore(frame,element)
      if(r.ok) {setIsPreview(false);setError(null)}
      else setError(r.error||'Ripristino non riuscito')
    }else{
      const r=await adapter.applyAtlas(frame,element,working.dataUrl)
      if(r.ok){setIsPreview(true);setError(null)}
      else setError(r.error||'Anteprima non riuscita')
    }
    setBusy(false)
  }
  const publish=async()=>{
    if(!working||!atlas)return
    setPublishing(true);setError(null)
    try{
      const assetPath=atlas.doc.pngUrl.replace(
        new RegExp('^/games/'+gameId+'/'),'')
      const result=await publishReskin({
        game:gameId,path:assetPath,blob:working.blob,
        secret:publishSecret,
        note:'2Night Animation Workbench · '+(clip?.name||'atlante'),
        onProgress:(progress)=>setPublishStatus(progress.message),
      })
      setStatus('Pubblicato su GitHub! Commit '+result.commit.slice(0,12)+
        '. Il deploy Vercel applicherà il nuovo PNG.')
      setPublishSecret('')
    }catch(e){
      setError(e instanceof Error?e.message:'Pubblicazione fallita')
    }finally{setPublishing(false)}
  }

  const frameIndex=frameInfo?.index ?? 0
  const patchCount=patches.size
  const title=element.name || snapshot?.className || 'Sprite'
  return (
    <section role="dialog" aria-label="Animation Workbench"
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-[65] flex max-h-[79dvh] flex-col overflow-hidden rounded-t-2xl border-t border-sky-500/50 bg-zinc-950 text-zinc-100 shadow-[0_-16px_70px_#000c] md:max-h-[51dvh]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/95 px-3 py-2 md:px-5">
        <Film className="h-4 w-4 shrink-0 text-sky-400"/>
        <strong className="max-w-[150px] truncate text-xs md:max-w-[250px] md:text-sm">
          Animation Workbench
        </strong>
        <span className="hidden truncate font-mono text-[11px] text-zinc-400 sm:inline">
          {title} · {snapshot?.className||element.className}
        </span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="outline" onClick={()=>
            setTimelineExpanded(v=>!v)}
            className="h-8 border-zinc-700 bg-zinc-800 text-xs">
            {timelineExpanded?<ChevronDown className="h-4 w-4"/>:
              <ChevronUp className="h-4 w-4"/>}
            <span className="hidden sm:inline">Timeline</span>
          </Button>
          <Button size="icon" variant="ghost" aria-label="Chiudi timeline"
            className="h-8 w-8" onClick={onClose}><X className="h-4 w-4"/></Button>
        </div>
      </header>
      {!snapshot ? (
        <div className="flex items-center gap-2 p-4 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin"/> Attendo il runtime del personaggio…
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:p-4">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="min-w-[160px] flex-1 text-[11px] text-zinc-400">
                  Animazione
                  <select aria-label="Animazione" value={clip?.name||''}
                    onChange={e=>chooseClip(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-100">
                    {clips.map(item=><option key={item.name} value={item.name}>
                      {item.name} · {item.frames.length} frame
                    </option>)}
                  </select>
                </label>
                <div className="flex gap-2 pt-4 text-[11px] text-zinc-400">
                  <span>{clip?.frameRate||'—'} FPS</span>
                  <span>{clip?.looped?'Loop':'No loop'}</span>
                  <span>{framesCount} frame</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={!snapshot.supported}
                  onClick={()=>control(snapshot.sceneFrozen?'unfreeze':'freeze')}
                  className="h-8 gap-1 border-zinc-700 bg-zinc-800 text-xs">
                  {snapshot.sceneFrozen?<Play className="h-3.5 w-3.5"/>:
                    <Pause className="h-3.5 w-3.5"/>}
                  {snapshot.sceneFrozen?'Riprendi scena':'Congela scena'}
                </Button>
                <Button size="sm" variant="outline"
                  disabled={!snapshot.supported||!clip}
                  onClick={()=>{if(clip){changedFrameRef.current=false
                    control('playClip',{name:clip.name})}}}
                  className="h-8 gap-1 border-zinc-700 bg-zinc-800 text-xs">
                  <Play className="h-3.5 w-3.5"/> Riproduci
                </Button>
                <Button size="icon" variant="outline"
                  aria-label="Frame precedente"
                  disabled={!clip?.frames.length}
                  onClick={()=>seek(position-1)}
                  className="h-8 w-8 border-zinc-700 bg-zinc-800">
                  <SkipBack className="h-3.5 w-3.5"/>
                </Button>
                <Button size="icon" variant="outline"
                  aria-label="Frame successivo"
                  disabled={!clip?.frames.length}
                  onClick={()=>seek(position+1)}
                  className="h-8 w-8 border-zinc-700 bg-zinc-800">
                  <SkipForward className="h-3.5 w-3.5"/>
                </Button>
                <span className="font-mono text-xs text-sky-300">
                  {framesCount?position+1:0}/{framesCount}
                </span>
              </div>

              {timelineExpanded && (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                    <span>Frame effettivi della sequenza</span>
                    {snapshot.sceneFrozen&&<span className="text-amber-200">Scena congelata</span>}
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-2"
                    role="group" aria-label="Frame timeline">
                    {clip?.frames.map(item=>{
                      const rect=atlas?.doc.byName.get(item.name)
                      return (
                        <button key={item.position} title={item.name||'Frame '+item.index}
                          aria-label={'Frame '+(item.position+1)+' '+item.name}
                          aria-pressed={position===item.position}
                          onClick={()=>seek(item.position)}
                          className={'flex shrink-0 flex-col items-center gap-1 rounded-lg border p-1 transition-colors '+
                            (position===item.position?
                              'border-sky-400 bg-sky-500/15':'border-zinc-700 bg-zinc-950 hover:border-sky-700')}>
                          <FramePreview frame={rect} image={atlas?.image||null}
                            replace={patches.get(item.name)?.image}
                            active={position===item.position}/>
                          <span className="max-w-[80px] truncate font-mono text-[10px] text-zinc-400">
                            {item.position+1} · #{item.index}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="grid gap-1 text-[11px] text-zinc-400 sm:grid-cols-2">
                <div className="min-w-0 truncate">Frame motore: <span className="text-sky-300">
                  {frameInfo?.name||snapshot.frame||'—'}</span></div>
                <div>Rettangolo: <span className="text-zinc-200">
                  {atlasFrame?atlasFrame.w+'×'+atlasFrame.h+' px':'Non disponibile'}</span></div>
                <div>Offset trim: <span className="text-zinc-200">
                  {atlasFrame?atlasFrame.frameX+', '+atlasFrame.frameY:'—'}</span></div>
                <div>Dimensione logica: <span className="text-zinc-200">
                  {atlasFrame?atlasFrame.logicalW+'×'+atlasFrame.logicalH:'—'}</span></div>
              </div>
            </div>

            <aside className="min-w-0 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
              <strong className="text-xs text-zinc-200">Reskin 1:1 · Atlante originale</strong>
              <div className="break-all font-mono text-[10px] text-zinc-500">
                {snapshot.atlas||'Nessuna texture PNG'}
              </div>
              {atlas?(
                <div className="text-[11px] text-zinc-400">
                  {atlas.doc.width}×{atlas.doc.height} · {atlas.doc.frames.length}
                  {' '}frame logici · {atlas.doc.distinctRectangles} rettangoli
                </div>
              ):(
                <div className="text-[11px] text-amber-200">
                  {atlasError||'Lettura delle informazioni dell’atlante…'}
                </div>
              )}
              {atlasFrame&&rectConflicts.length>0&&(
                <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-2 text-[11px] text-amber-200">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5"/>
                  Questo rettangolo è condiviso con altri {rectConflicts.length}
                  {' '}frame logici. Un pixel sostituito cambia tutte queste pose.
                  <div className="mt-1 max-h-10 overflow-y-auto font-mono text-[10px] opacity-80">
                    {rectConflicts.slice(0,12).join(', ')}
                  </div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/png"
                className="hidden" aria-label="Carica PNG per il frame selezionato"
                onChange={e=>{void uploadFrame(e.target.files?.[0]);e.target.value=''}}/>
              <input ref={wholeRef} type="file" accept="image/png"
                className="hidden" aria-label="Carica texture completa"
                onChange={e=>{void uploadWhole(e.target.files?.[0]);e.target.value=''}}/>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" disabled={!atlasFrame||busy}
                  onClick={()=>fileRef.current?.click()}
                  className="h-9 gap-1 border-zinc-700 bg-zinc-800 px-2 text-[11px]">
                  <Upload className="h-3.5 w-3.5"/> Questo frame
                </Button>
                <Button size="sm" variant="outline" disabled={!atlasAvailable||busy}
                  onClick={()=>wholeRef.current?.click()}
                  className="h-9 gap-1 border-zinc-700 bg-zinc-800 px-2 text-[11px]">
                  <Upload className="h-3.5 w-3.5"/> Intero atlante
                </Button>
              </div>
              <div className="text-[10px] leading-relaxed text-zinc-500">
                Manteniamo la stessa geometria e lo stesso XML. Per cambiare
                dimensioni, punti d’origine o layout occorre una modalità
                avanzata con rigenerazione del mapping.
              </div>
              {working&&(
                <div className="space-y-2 border-t border-zinc-800 pt-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5"/>
                    {formatBytes(working.blob.size)} · {patchCount||'atlante intero'}{' '}
                    modifica{patchCount===1?'':'he'}
                  </div>
                  {canPublish&&(
                    <label className="block text-[10px] text-zinc-400">
                      Codice di pubblicazione GitHub (server-side)
                      <input type="password" value={publishSecret}
                        autoComplete="off"
                        onChange={(e)=>setPublishSecret(e.target.value)}
                        placeholder="Codice di pubblicazione"
                        aria-label="Codice di pubblicazione"
                        className="mt-1 h-9 w-full rounded border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100"/>
                    </label>
                  )}
                  {publishing&&<p role="status" className="text-[10px] text-sky-300">
                    <Loader2 className="mr-1 inline h-3 w-3 animate-spin"/>
                    {publishStatus}
                  </p>}
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" disabled={!snapshot.supported||busy}
                      onClick={()=>void togglePreview()}
                      className="h-9 gap-1 border-zinc-700 bg-zinc-800 text-[11px]">
                      {isPreview?<EyeOff className="h-3.5 w-3.5"/>:
                        <Eye className="h-3.5 w-3.5"/>}
                      {isPreview?'Originale':'Anteprima'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={resetWorking}
                      className="h-9 gap-1 border-zinc-700 bg-zinc-800 text-[11px]">
                      <RotateCcw className="h-3.5 w-3.5"/> Ripristina
                    </Button>
                    <Button size="sm" variant="outline"
                      onClick={()=>downloadBlob(working.blob,
                        snapshot.atlas.split('/').pop()||'reskin.png')}
                      className="h-9 gap-1 border-zinc-700 bg-zinc-800 text-[11px]">
                      <Download className="h-3.5 w-3.5"/> Esporta PNG
                    </Button>
                    <Button size="sm" disabled={!canPublish||publishing||busy||!publishSecret}
                      onClick={()=>void publish()}
                      title={canPublish?'Pubblica tramite API GitHub protetta':
                        'GitHub non configurato: aggiungi GITHUB_RESKIN_TOKEN su Vercel'}
                      className="h-9 gap-1 bg-emerald-700 text-[11px] text-white hover:bg-emerald-600">
                      <Save className="h-3.5 w-3.5"/> Pubblica GitHub
                    </Button>
                  </div>
                  {!canPublish&&(
                    <p className="text-[10px] text-amber-300">
                      Pubblicazione GitHub non ancora configurata sul server.
                      Esporta il PNG, oppure configura il token server-side.
                    </p>
                  )}
                </div>
              )}
              {status&&<p role="status" className="rounded bg-sky-950/30 p-2 text-[10px] text-sky-200">
                {status}</p>}
              {error&&<p role="alert" className="rounded border border-red-800 bg-red-950/30 p-2 text-[11px] text-red-300">
                {error}</p>}
              {(!snapshot.supported||!isFNF)&&(
                <p className="rounded border border-amber-900/60 bg-zinc-950 p-2 text-[10px] text-amber-200">
                  {snapshot.explanation||'Questo gioco dispone della timeline dei frame, ma non ancora di tutte le funzioni runtime.'}
                </p>
              )}
            </aside>
          </div>
        </div>
      )}
    </section>
  )
}
