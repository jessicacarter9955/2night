export interface PublishProgress {
  stage:'upload'|'commit'
  completed:number
  total:number
  message:string
}
export interface PublishResult {ok:true;commit:string;path:string;repository:string}

const CHUNK_SIZE=700*1024

async function chunkBase64(blob:Blob):Promise<string> {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onload=()=>{
      const src=String(reader.result||'')
      const index=src.indexOf(',')
      resolve(index<0?'':src.slice(index+1))
    }
    reader.onerror=()=>reject(new Error('Lettura chunk fallita'))
    reader.readAsDataURL(blob)
  })
}

async function post(body:unknown,secret:string):Promise<Record<string,unknown>> {
  const response=await fetch('/api/publish-reskin',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'x-2night-publish-secret':secret,
    },
    body:JSON.stringify(body),
  })
  let result:Record<string,unknown>
  try{result=await response.json()}catch{
    throw new Error('Il server GitHub non ha restituito JSON ('+
      response.status+')')
  }
  if(!response.ok)throw new Error(String(result.error||
    'GitHub HTTP '+response.status))
  return result
}

export async function publishReskin(args:{
  game:string;path:string;blob:Blob;secret:string;note:string
  onProgress:(progress:PublishProgress)=>void
}):Promise<PublishResult>{
  const {game,path,blob,secret,note,onProgress}=args
  if(blob.size>16*1024*1024)throw new Error('PNG oltre il limite di 16 MB')
  if(!secret.trim())throw new Error('Inserisci il codice di pubblicazione')
  const count=Math.ceil(blob.size/CHUNK_SIZE)
  if(count===0)throw new Error('PNG vuoto')
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',await blob.arrayBuffer(),
  ))).map(b=>b.toString(16).padStart(2,'0')).join('')
  const shas:string[]=[]
  for(let i=0;i<count;i++){
    onProgress({
      stage:'upload',completed:i,total:count,
      message:'Caricamento su GitHub · parte '+(i+1)+'/'+count,
    })
    const slice=blob.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE)
    const encoded=await chunkBase64(slice)
    const answer=await post({action:'chunk',game,path,data:encoded},secret)
    if(typeof answer.sha!=='string'||
       !/^[0-9a-f]{40}$/.test(answer.sha)){
      throw new Error('GitHub ha restituito uno SHA non valido')
    }
    shas.push(answer.sha)
  }
  onProgress({
    stage:'commit',completed:count,total:count,
    message:'Verifico checksum e geometria; creo il commit GitHub…',
  })
  const answer=await post({
    action:'finalize',game,path,shas,sha256,note,
  },secret)
  if(answer.ok!==true||typeof answer.commit!=='string'){
    throw new Error('Commit GitHub non confermato')
  }
  onProgress({
    stage:'commit',completed:count,total:count,
    message:'Commit GitHub completato: '+answer.commit.slice(0,12),
  })
  return answer as unknown as PublishResult
}
