import http from 'node:http';
import {readFile,writeFile,mkdir,rename,stat,realpath,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import os from 'node:os';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.m4v':'video/mp4','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg'};
const extensions=/\.(jpg|jpeg|png|webp|gif|mp4|webm|m4v|mp3|m4a|wav|ogg)$/i;
export function mediaPath(src){
  if(typeof src!=='string'||!src.startsWith('media/')||src.includes('\\')||src.includes('%')||src.includes('?')||src.includes('#')||src.split('/').some(p=>!p||p==='.'||p==='..')||!extensions.test(src)) throw Error('Medien brauchen einen lokalen Pfad wie media/familie.jpg (JPG, PNG, WebP, GIF, MP4 oder WebM).');
  return src;
}
export function validate(input){
  if(!input||input.version!==1||typeof input.title!=='string'||!input.title.trim()||!Array.isArray(input.sections)||!input.sections.length||input.sections.length>1000) throw Error('Erwartet: version: 1, title und 1–1000 sections.');
  const ids=new Set();
  return {version:1,title:input.title.slice(0,200),sections:input.sections.map((s,i)=>{
    if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||typeof s.title!=='string'||typeof s.text!=='string')throw Error(`Abschnitt ${i+1}: eindeutige id, title und text sind erforderlich.`);
    ids.add(s.id);
    const images=s.images??[];
    if(!Array.isArray(images)||images.length>100)throw Error(`Abschnitt ${i+1}: images muss eine Liste mit höchstens 100 Bildern sein.`);
    images.forEach(x=>{mediaPath(x);if(!/\.(jpg|jpeg|png|webp|gif)$/i.test(x))throw Error('In images sind nur Bilder erlaubt.');});
    if(s.video){mediaPath(s.video);if(!/\.(mp4|webm|m4v)$/i.test(s.video))throw Error('video muss MP4 oder WebM sein.');}
    if(s.video&&images.length)throw Error(`Abschnitt ${i+1}: entweder Bilder oder Video verwenden.`);
    const audio=s.audio||null;if(audio){mediaPath(audio);if(!/\.(mp3|m4a|wav|ogg)$/i.test(audio))throw Error('audio muss MP3, M4A, WAV oder OGG sein.');if(s.video)throw Error(`Abschnitt ${i+1}: Audio kann mit Bildern, aber nicht gleichzeitig mit Video verwendet werden.`);}
    const mode=s.mode??'manual',duration=s.durationSeconds??8;
    if(!['manual','auto'].includes(mode)||!Number.isFinite(duration)||duration<1||duration>3600)throw Error(`Abschnitt ${i+1}: mode manual/auto und durationSeconds 1–3600 erforderlich.`);
    return {id:s.id,title:s.title,text:s.text,cue:typeof s.cue==='string'?s.cue.slice(0,4000):'',notes:typeof s.notes==='string'?s.notes:'',images,video:s.video||null,audio,mode,durationSeconds:duration,loop:s.loop===true};
  })};
}
async function atomic(file,data){const tmp=file+'.tmp';await writeFile(tmp,data);await rename(tmp,file);}
export async function createApp({dataDir=path.join(ROOT,'data'),port=3210,host='0.0.0.0',code=randomBytes(4).toString('hex')}={}){
  await mkdir(path.join(dataDir,'media'),{recursive:true});
  let deck;
  try {deck=validate(JSON.parse(await readFile(path.join(dataDir,'rede.json'),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;deck=validate(JSON.parse(await readFile(path.join(ROOT,'demo.json'),'utf8')));await atomic(path.join(dataDir,'rede.json'),JSON.stringify(deck,null,2));}
  let state={index:0,image:0,blackout:false,paused:false,startedAt:Date.now(),revision:0,epoch:randomBytes(8).toString('hex')};
  try {const saved=JSON.parse(await readFile(path.join(dataDir,'position.json'),'utf8'));if(Number.isInteger(saved.index)&&saved.index>=0&&saved.index<deck.sections.length)state.index=saved.index;}catch{}
  const seen=new Set();let queue=Promise.resolve();
  function snapshot(){const s=deck.sections[state.index];let image=state.image;if(s.mode==='auto'&&!state.paused&&s.images.length){const n=state.image+Math.floor((Date.now()-state.startedAt)/(s.durationSeconds*1000));image=s.loop?n%s.images.length:Math.min(n,s.images.length-1);}return {deck,state:{...state,image,serverNow:Date.now()},uploadLimitBytes:250*1024*1024};}
  async function safeMedia(src){const base=await realpath(dataDir),file=await realpath(path.join(dataDir,mediaPath(src)));if(!file.startsWith(base+path.sep))throw Error('Medienpfad liegt außerhalb des Projektordners.');return file;}
  async function listMedia(dir=path.join(dataDir,'media'),prefix='media'){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name),rel=prefix+'/'+entry.name;if(entry.isDirectory())out.push(...await listMedia(full,rel));else if(extensions.test(rel))out.push(rel.replaceAll('\\','/'));}return out.sort((a,b)=>a.localeCompare(b,'de',{numeric:true,sensitivity:'base'}));}
  function validCode(value){const supplied=Buffer.from(value||''),expected=Buffer.from(code);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
  async function body(req,max){let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>max)throw Error('Datei zu groß.');chunks.push(chunk);}return Buffer.concat(chunks);}
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,snapshot());
      if(req.method==='GET'&&url.pathname==='/api/addresses')return json(res,200,{urls:Object.values(os.networkInterfaces()).flat().filter(x=>x.family==='IPv4'&&!x.internal).map(x=>`http://${x.address}:${server.address().port}`)});
      if(req.method==='GET'&&url.pathname==='/api/media-list'){if(!validCode(req.headers['x-regie-code']))return json(res,401,{error:'Regie-Code falsch.'});return json(res,200,{media:await listMedia()});}
      if(req.method==='POST'&&url.pathname==='/api/login'){
        const data=JSON.parse((await body(req,1024)).toString('utf8'));
        return json(res,data.code===code?200:401,data.code===code?{ok:true}:{error:'Regie-Code falsch. Siehe Startfenster am Computer.'});
      }
      if(req.method==='POST'&&url.pathname==='/api/live-action'){
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Fremder Ursprung abgelehnt.'});
        const data=JSON.parse((await body(req,16*1024)).toString('utf8'));
        const task=async()=>{
          if(typeof data.id!=='string'||data.id.length>100)throw Error('Aktionskennung fehlt.');
          if(!['next','prev'].includes(data.action))return json(res,403,{error:'In Elmars Live-Ansicht sind nur Vor und Zurück erlaubt.'});
          if(seen.has(data.id))return json(res,200,snapshot());
          if(data.epoch!==state.epoch||data.revision!==state.revision)return json(res,409,{error:'Der Stand hat sich geändert. Bitte erneut drücken.',...snapshot()});
          const s=deck.sections[state.index],shown=snapshot().state.image;
          if(data.action==='next'&&s.mode==='manual'&&s.images.length>1&&shown<s.images.length-1){state.image=shown+1;state.startedAt=Date.now();}
          else if(data.action==='prev'&&s.mode==='manual'&&s.images.length>1&&shown>0){state.image=shown-1;state.startedAt=Date.now();}
          else {state.index=Math.max(0,Math.min(deck.sections.length-1,state.index+(data.action==='next'?1:-1)));state.image=data.action==='prev'?Math.max(0,deck.sections[state.index].images.length-1):0;state.paused=false;state.startedAt=Date.now();}
          state.revision++;
          seen.add(data.id);if(seen.size>2000)seen.delete(seen.values().next().value);
          await atomic(path.join(dataDir,'position.json'),JSON.stringify({index:state.index}));json(res,200,snapshot());
        };
        queue=queue.then(task,task);await queue;return;
      }
      if(['POST','PUT'].includes(req.method)){
        if(!validCode(req.headers['x-regie-code']))return json(res,401,{error:'Regie-Code falsch. Den Code findest du im Startfenster am Computer.'});
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Fremder Ursprung abgelehnt.'});
        if(req.method==='PUT'&&url.pathname==='/api/media'){
          const src=mediaPath(url.searchParams.get('path'));const file=path.join(dataDir,src);await mkdir(path.dirname(file),{recursive:true});
          const parent=await realpath(path.dirname(file)),base=await realpath(dataDir);if(!parent.startsWith(base+path.sep))throw Error('Ungültiger Medienordner.');
          const data=await body(req,250*1024*1024);await atomic(file,data);return json(res,200,{ok:true});
        }
        const data=JSON.parse((await body(req,4*1024*1024)).toString('utf8'));
        const task=async()=>{
          if(url.pathname==='/api/import'||url.pathname==='/api/edit'){
            const edit=url.pathname==='/api/edit';
            if(edit&&(data.revision!==state.revision||data.epoch!==state.epoch))return json(res,409,{error:'Inzwischen geändert. Entwurf sichern, dann den Abschnitt neu öffnen.',...snapshot()});
            const currentSectionId=edit?(typeof data.focusSectionId==='string'&&deck.sections.some(s=>s.id===data.focusSectionId)?data.focusSectionId:deck.sections[state.index]?.id):null;
            const next=validate(edit?data.deck:data);const missing=[];
            for(const src of new Set(next.sections.flatMap(s=>[...s.images,...(s.video?[s.video]:[]),...(s.audio?[s.audio]:[])]))){try{await safeMedia(src);}catch{missing.push(src);}}
            if(missing.length)return json(res,400,{error:'Diese Dateien fehlen noch. Zuerst Medien übertragen: '+missing.join(', ')});
            await atomic(path.join(dataDir,'rede.json'),JSON.stringify(next,null,2));deck=next;const preservedIndex=edit&&currentSectionId?deck.sections.findIndex(s=>s.id===currentSectionId):-1;state={...state,index:edit?(preservedIndex>=0?preservedIndex:Math.min(state.index,deck.sections.length-1)):0,image:0,blackout:edit?state.blackout:false,paused:false,startedAt:Date.now(),revision:state.revision+1};seen.clear();
          }else if(url.pathname==='/api/action'){
            if(typeof data.id!=='string'||data.id.length>100)throw Error('Aktionskennung fehlt.');
            if(seen.has(data.id))return json(res,200,snapshot());
            if(data.epoch!==state.epoch||data.revision!==state.revision)return json(res,409,{error:'Der Stand hat sich geändert. Bitte erneut drücken.',...snapshot()});
            const current=snapshot().state;
            if(data.action==='next'||data.action==='prev'){state.index=Math.max(0,Math.min(deck.sections.length-1,state.index+(data.action==='next'?1:-1)));state.image=0;state.paused=false;state.startedAt=Date.now();}
            else if(data.action==='image'){state.image=(current.image+1)%Math.max(1,deck.sections[state.index].images.length);state.startedAt=Date.now();}
            else if(data.action==='pause'){state.image=current.image;state.paused=!state.paused;state.startedAt=Date.now();}
            else if(data.action==='blackout')state.blackout=!state.blackout;
            else throw Error('Unbekannte Aktion.');
            state.revision++;seen.add(data.id);if(seen.size>2000)seen.delete(seen.values().next().value);
          }else return json(res,404,{error:'Nicht gefunden.'});
          await atomic(path.join(dataDir,'position.json'),JSON.stringify({index:state.index}));json(res,200,snapshot());
        };
        queue=queue.then(task,task);await queue;return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Nicht erlaubt.'});
      let file;
      if(url.pathname.startsWith('/media/'))file=await safeMedia(decodeURIComponent(url.pathname.slice(1)));
      else {const assets={'/':'index.html','/regie':'index.html','/live':'index.html','/tv':'index.html','/app.js':'app.js','/upload-utils.js':'upload-utils.js','/style.css':'style.css','/editor.css':'editor.css'};if(!assets[url.pathname])return json(res,404,{error:'Nicht gefunden.'});file=path.join(ROOT,'public',assets[url.pathname]);}
      const info=await stat(file);let start=0,end=info.size-1,status=200;
      if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m||+m[1]>=info.size||(+m[2]&&+m[2]<+m[1])){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}start=+m[1];end=m[2]?Math.min(+m[2],end):end;status=206;}
      const headers={'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self'; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'self'"};
      if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
      res.writeHead(status,headers);if(req.method==='HEAD')res.end();else createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
    }catch(e){if(!res.headersSent)json(res,e.code==='ENOENT'?404:400,{error:e.message});else res.destroy();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});return {server,code};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  createApp({port:Number(process.env.PORT||3210),code:process.env.REGIE_CODE||undefined}).then(({server,code})=>{
    console.log('\nGEBURTSTAG ELMAR · Lokale Präsentation\n');
    console.log(`Am Computer: http://localhost:${server.address().port}/regie\nRegie-Code: ${code}\n`);
    for(const n of Object.values(os.networkInterfaces()).flat().filter(n=>n.family==='IPv4'&&!n.internal))console.log(`Vorbereitung: http://${n.address}:${server.address().port}/regie\nElmar Live:   http://${n.address}:${server.address().port}/live\nTV/Raspberry: http://${n.address}:${server.address().port}/tv\n`);
    console.log('Dieses Fenster während der Feier offen lassen. Beenden: Strg+C.');
  }).catch(e=>{console.error('Start nicht möglich:',e.message);process.exitCode=1;});
}
