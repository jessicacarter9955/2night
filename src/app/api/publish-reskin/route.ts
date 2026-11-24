import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const OWNER = 'jessicacarter9955'
const REPO = '2night'
const BRANCH = 'main'
const MAX_FILE_BYTES = 16 * 1024 * 1024
const CHUNK_BYTES = 700 * 1024
const MAX_CHUNKS = Math.ceil(MAX_FILE_BYTES / CHUNK_BYTES) + 1

interface GitBlob { sha: string; content?: string; encoding?: string }
type GitResponse = Record<string, unknown>

function configured(): boolean {
  return !!process.env.GITHUB_RESKIN_TOKEN &&
    !!process.env.RESKIN_PUBLISH_SECRET &&
    process.env.RESKIN_PUBLISH_SECRET.length >= 16
}

function validSecret(received:string | null):boolean {
  const expected = process.env.RESKIN_PUBLISH_SECRET || ''
  if (!configured() || !received) return false
  const a = Buffer.from(received), b = Buffer.from(expected)
  return a.length===b.length && timingSafeEqual(a,b)
}

function validateGame(game:unknown):string {
  if (game !== 'friday-night-funkin' && game !== 'chainsaw-dance') {
    throw new Error('Gioco non supportato')
  }
  return game
}

async function validAsset(game:string, rel:unknown):Promise<{
  path:string; file:string; width:number;height:number
}> {
  if (typeof rel!=='string' || !/^[a-zA-Z0-9/_ .-]+\.png$/.test(rel) ||
      rel.startsWith('/') || rel.includes('..') || rel.includes('//')) {
    throw new Error('Percorso asset non valido')
  }
  const dir = path.resolve(process.cwd(),'public','games',game)
  const file = path.resolve(dir,rel)
  if (!file.startsWith(dir+path.sep)) throw new Error('Percorso fuori dal gioco')
  const registry = JSON.parse(await fs.readFile(
    path.join(dir,'registry.json'),'utf8'))
  const allowed = game==='chainsaw-dance'
    ? registry.textures?.some((p:{file:string})=>p.file===rel)
    : registry.files?.some((p:{path:string;type:string})=>
      p.path===rel&&p.type==='png')
  if (!allowed) throw new Error('PNG non presente nel registro asset del gioco')
  const header = Buffer.alloc(24)
  const handle = await fs.open(file,'r')
  try { await handle.read(header,0,24,0) } finally { await handle.close() }
  const size = pngSize(header)
  if (!size) throw new Error('Asset originale non è un PNG')
  return {path:'public/games/'+game+'/'+rel,file,...size}
}

function pngSize(data:Buffer):{width:number;height:number}|null {
  if (data.length<24 || !data.subarray(0,8).equals(Buffer.from([
    0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return null
  const width=data.readUInt32BE(16),height=data.readUInt32BE(20)
  return width>0&&height>0?{width,height}:null
}

async function api<T extends GitResponse = GitResponse>(
  endpoint:string,method='GET',body?:GitResponse,
):Promise<T> {
  const response=await fetch(
    'https://api.github.com/repos/'+OWNER+'/'+REPO+endpoint,{
      method,
      headers:{
        'Accept':'application/vnd.github+json',
        'Authorization':'Bearer '+process.env.GITHUB_RESKIN_TOKEN,
        'X-GitHub-Api-Version':'2022-11-28',
        ...(body?{'Content-Type':'application/json'}:{}),
      },
      body:body?JSON.stringify(body):undefined,
      cache:'no-store',
    })
  const content=await response.json().catch(()=>({}))
  if(!response.ok){
    throw new Error('GitHub HTTP '+response.status+': '+
      String(content.message||'richiesta non riuscita').slice(0,150))
  }
  return content as T
}

export async function GET(){
  return NextResponse.json({
    configured:configured(),
    repository:OWNER+'/'+REPO,
    chunkBytes:CHUNK_BYTES,
    maxFileBytes:MAX_FILE_BYTES,
  },{headers:{'Cache-Control':'no-store'}})
}

export async function POST(req:Request){
  try {
    if(!configured())return NextResponse.json({
      error:'Pubblicazione disabilitata: configura GITHUB_RESKIN_TOKEN e '+
        'RESKIN_PUBLISH_SECRET (almeno 16 caratteri) nelle variabili Vercel.',
    },{status:503})
    const origin=req.headers.get('origin')
    if(origin&&new URL(origin).host!==new URL(req.url).host){
      return NextResponse.json({error:'Origine non autorizzata'},{status:403})
    }
    if(!validSecret(req.headers.get('x-2night-publish-secret'))){
      return NextResponse.json({error:'Codice di pubblicazione errato'},{status:403})
    }
    const size=Number(req.headers.get('content-length')||0)
    if(size>1.4*1024*1024){
      return NextResponse.json({error:'Richiesta troppo grande'},{status:413})
    }
    const body=await req.json() as Record<string,unknown>
    const game=validateGame(body.game)
    const asset=await validAsset(game,body.path)

    if(body.action==='chunk'){
      const base64=String(body.data||'')
      if(base64.length<8 || base64.length>Math.ceil(CHUNK_BYTES*4/3)+16 ||
         !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)){
        throw new Error('Chunk base64 non valido')
      }
      const bytes=Buffer.from(base64,'base64')
      if(bytes.length<1||bytes.length>CHUNK_BYTES){
        throw new Error('Dimensione chunk non valida')
      }
      // GitHub keeps unreferenced blob objects temporarily until finalize.
      // All chunks are uploaded WITHOUT any commit/deploy.
      const created=await api<{sha:string}>('/git/blobs','POST',{
        content:bytes.toString('base64'),encoding:'base64',
      })
      return NextResponse.json({ok:true,sha:created.sha,size:bytes.length})
    }

    if(body.action==='finalize'){
      const shas=body.shas
      const digest=String(body.sha256||'')
      const note=String(body.note||'').slice(0,140)
      if(!Array.isArray(shas)||shas.length<1||shas.length>MAX_CHUNKS ||
         !shas.every((sha)=>typeof sha==='string'&&/^[a-f0-9]{40}$/.test(sha)) ||
         !/^[a-f0-9]{64}$/.test(digest)){
        throw new Error('Lista chunk o checksum non valida')
      }
      let total=0
      const parts:Buffer[]=[]
      for(const sha of shas as string[]){
        const blob=await api<GitBlob>('/git/blobs/'+sha)
        if(blob.encoding!=='base64'||typeof blob.content!=='string') {
          throw new Error('Blob GitHub non decodificabile')
        }
        const part=Buffer.from(blob.content.replace(/\s/g,''),'base64')
        if(part.length===0||part.length>CHUNK_BYTES){
          throw new Error('Chunk GitHub di dimensioni non valide')
        }
        total+=part.length
        if(total>MAX_FILE_BYTES)throw new Error('Reskin oltre il limite di 16 MB')
        parts.push(part)
      }
      const combined=Buffer.concat(parts,total)
      if(createHash('sha256').update(combined).digest('hex')!==digest){
        throw new Error('Checksum SHA-256 diverso: upload incompleto')
      }
      const dimensions=pngSize(combined)
      if(!dimensions || dimensions.width!==asset.width ||
         dimensions.height!==asset.height){
        throw new Error('Dimensioni PNG incompatibili: richieste '+
          asset.width+'×'+asset.height)
      }
      // Native Git blob of the whole PNG is created server-to-GitHub:
      // the browser never has to send a >4.5 MB HTTP request to Vercel.
      const complete=await api<{sha:string}>('/git/blobs','POST',{
        content:combined.toString('base64'),encoding:'base64',
      })
      const ref=await api<{object:{sha:string}}>('/git/ref/heads/'+BRANCH)
      const previous=await api<{tree:{sha:string}}>(
        '/git/commits/'+ref.object.sha)
      const tree=await api<{sha:string}>('/git/trees','POST',{
        base_tree:previous.tree.sha,
        tree:[{
          path:asset.path,mode:'100644',type:'blob',sha:complete.sha,
        }],
      })
      const commit=await api<{sha:string}>('/git/commits','POST',{
        message:'reskin('+game+'): update '+path.basename(asset.path)+
          (note?' · '+note:''),
        tree:tree.sha,parents:[ref.object.sha],
      })
      await api('/git/refs/heads/'+BRANCH,'PATCH',{
        sha:commit.sha,force:false,
      })
      return NextResponse.json({
        ok:true,commit:commit.sha,
        path:asset.path,repository:OWNER+'/'+REPO,
      })
    }

    throw new Error('Azione sconosciuta')
  }catch(error){
    const message=error instanceof Error?error.message:'Pubblicazione fallita'
    return NextResponse.json({error:message},{status:400})
  }
}
