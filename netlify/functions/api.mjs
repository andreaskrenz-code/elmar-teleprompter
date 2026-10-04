import {getStore} from '@netlify/blobs';
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {validate,mediaPath} from '../../server.mjs';
import demo from '../../demo.json' with {type:'json'};

const mime={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',webm:'video/webm',m4v:'video/mp4',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg'};
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
function snapshot(record){const {deck}=record;const state={...record.state,serverNow:Date.now()};const s=deck.sections[state.index];if(s.mode==='auto'&&!state.paused&&s.images.length){const n=state.image+Math.floor((Date.now()-state.startedAt)/(s.durationSeconds*1000));state.image=s.loop?n%s.images.length:Math.min(n,s.images.length-1);}return {deck,state,uploadLimitBytes:4*1024*1024};}
export function makeHandler(storeFactory=getStore,env=process.env){return async(req)=>{
 try{
  const secret=env.REGIE_CODE;
  if(!secret||secret.length<12)return json({error:'Netlify noch einrichten: REGIE_CODE mit mindestens 12 Zeichen als Umgebungsvariable hinterlegen.'},503);
  const url=new URL(req.url);const route=url.pathname.replace(/^\/\.netlify\/functions\/api/,'');
  const signed=()=>createHmac('sha256',secret).update('regie-session').digest('hex');
  const cookie=req.headers.get('cookie')||'';const auth=cookie.match(/(?:^|;\s*)elmar_session=regie\.([a-f0-9]+)/);
  const role=auth&&equal(auth[1],signed())?'regie':null;
  if(req.method==='POST'&&req.headers.get('origin')&&new URL(req.headers.get('origin')).origin!==url.origin)return json({error:'Fremder Ursprung.'},403);
  if(route==='/api/login'&&req.method==='POST'){
   const value=(await req.json()).code;if(!equal(value,secret))return json({error:'Regie-Code nicht erkannt.'},401);
   return json({ok:true},200,{'Set-Cookie':`elmar_session=regie.${signed()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`});
  }
  const store=storeFactory({name:'elmar-presentation',consistency:'strong'});
  if(route.startsWith('/media/')&&req.method==='GET'){
   const src=mediaPath(decodeURIComponent(route.slice(1)));const blob=await store.get(src,{type:'arrayBuffer'});if(!blob)return json({error:'Medium fehlt.'},404);
   let start=0,end=blob.byteLength-1,status=200;const headers={'Content-Type':mime[src.split('.').pop().toLowerCase()]||'application/octet-stream','Cache-Control':'private, max-age=0','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
   if(req.headers.has('range')){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range'));if(!m||+m[1]>=blob.byteLength||(+m[2]&&+m[2]<+m[1]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${blob.byteLength}`}});start=+m[1];end=m[2]?Math.min(+m[2],end):end;status=206;headers['Content-Range']=`bytes ${start}-${end}/${blob.byteLength}`;}
   headers['Content-Length']=String(end-start+1);return new Response(blob.slice(start,end+1),{status,headers});
  }
  if(route==='/api/addresses')return json({urls:[url.origin]});
  if(route==='/api/media-list'&&req.method==='GET'){if(role!=='regie'||!equal(req.headers.get('x-regie-code'),secret))return json({error:'Zum Anzeigen der Medien bitte den Regie-Code eingeben.'},403);const listed=await store.list({prefix:'media/'});return json({media:(listed.blobs||[]).map(x=>x.key).filter(Boolean).sort((a,b)=>a.localeCompare(b,'de',{numeric:true,sensitivity:'base'}))});}
  let entry=await store.getWithMetadata('presentation',{type:'json'});
  if(!entry){await store.setJSON('presentation',{deck:validate(demo),state:{index:0,image:0,blackout:false,paused:false,startedAt:Date.now(),revision:0,epoch:randomUUID()},seen:[]},{onlyIfNew:true});entry=await store.getWithMetadata('presentation',{type:'json'});}
  if(!entry)return json({error:'Speicher nicht erreichbar.'},503);
  if(route==='/api/state'&&req.method==='GET')return json(snapshot(entry.data));
  if(route==='/api/live-action'&&req.method==='POST'){
   const input=await req.json(),record=structuredClone(entry.data),state=record.state;
   if(typeof input.id!=='string'||input.id.length>100)throw Error('Aktionskennung fehlt.');
   if(!['next','prev'].includes(input.action))return json({error:'In Elmars Live-Ansicht sind nur Vor und Zurück erlaubt.'},403);
   if(record.seen.includes(input.id))return json(snapshot(record));
   if(input.epoch!==state.epoch||input.revision!==state.revision)return json({error:'Stand geändert. Bitte erneut drücken.',...snapshot(record)},409);
   const s=record.deck.sections[state.index],shown=snapshot(record).state.image;if(input.action==='next'&&s.mode==='manual'&&s.images.length>1&&shown<s.images.length-1){state.image=shown+1;state.startedAt=Date.now();}else if(input.action==='prev'&&s.mode==='manual'&&s.images.length>1&&shown>0){state.image=shown-1;state.startedAt=Date.now();}else{state.index=Math.max(0,Math.min(record.deck.sections.length-1,state.index+(input.action==='next'?1:-1)));state.image=input.action==='prev'?Math.max(0,record.deck.sections[state.index].images.length-1):0;state.paused=false;state.startedAt=Date.now();}state.revision++;
   record.seen.push(input.id);record.seen=record.seen.slice(-100);
   const result=await store.setJSON('presentation',record,{onlyIfMatch:entry.etag});
   if(!result.modified)return json({error:'Ein anderes Gerät hat inzwischen geändert. Bitte erneut drücken.'},409);
   const verified=await store.getWithMetadata('presentation',{type:'json'});if(!verified)throw Error('Speicherung nicht bestätigt.');
   return json(snapshot(verified.data));
  }
  if(role!=='regie'||!equal(req.headers.get('x-regie-code'),secret))return json({error:'Zum Bearbeiten und für Regie-Funktionen bitte den Regie-Code eingeben.'},403);
  if(req.method==='PUT'&&route==='/api/media'){
   if(req.headers.get('origin')&&new URL(req.headers.get('origin')).origin!==url.origin)return json({error:'Fremder Ursprung.'},403);
   const src=mediaPath(url.searchParams.get('path')),bytes=await req.arrayBuffer();if(bytes.byteLength>4*1024*1024)return json({error:'Auf Netlify maximal 4 MB pro Datei. Fotos verkleinern; längere Videos lokal verwenden.'},413);
   await store.set(src,bytes);if(!await store.getMetadata(src))throw Error('Upload wurde nicht bestätigt. Bitte erneut versuchen.');return json({ok:true});
  }
  if(req.method!=='POST')return json({error:'Nicht gefunden.'},404);
  const input=await req.json();const record=structuredClone(entry.data);const state=record.state;
  if(route==='/api/import'||route==='/api/edit'){
   const edit=route==='/api/edit';if(edit&&(input.epoch!==state.epoch||input.revision!==state.revision))return json({error:'Inzwischen geändert. Entwurf sichern, dann den Abschnitt neu öffnen.',...snapshot(record)},409);
   const deck=validate(edit?input.deck:input);const missing=[];
   for(const src of new Set(deck.sections.flatMap(s=>[...s.images,...(s.video?[s.video]:[]),...(s.audio?[s.audio]:[])])))if(!await store.getMetadata(src))missing.push(src);
   if(missing.length)return json({error:'Zuerst fehlende Medien hochladen: '+missing.join(', ')},400);
   record.deck=deck;state.index=edit?Math.min(state.index,deck.sections.length-1):0;state.image=0;state.paused=false;if(!edit)state.blackout=false;state.startedAt=Date.now();record.seen=[];
  }else if(route==='/api/action'){
   if(typeof input.id!=='string'||input.id.length>100)throw Error('Aktionskennung fehlt.');
   if(record.seen.includes(input.id))return json(snapshot(record));
   if(input.epoch!==state.epoch||input.revision!==state.revision)return json({error:'Stand geändert. Bitte erneut drücken.',...snapshot(record)},409);
   const s=record.deck.sections[state.index];
   if(['next','prev'].includes(input.action)){state.index=Math.max(0,Math.min(record.deck.sections.length-1,state.index+(input.action==='next'?1:-1)));state.image=0;state.paused=false;state.startedAt=Date.now();}
   else if(input.action==='image'){state.image=(snapshot(record).state.image+1)%Math.max(1,s.images.length);state.startedAt=Date.now();}
   else if(input.action==='pause'){state.image=snapshot(record).state.image;state.paused=!state.paused;state.startedAt=Date.now();}
   else if(input.action==='blackout')state.blackout=!state.blackout;
   else throw Error('Unbekannte Aktion.');
   record.seen.push(input.id);record.seen=record.seen.slice(-100);
  }else return json({error:'Nicht gefunden.'},404);
  state.revision++;
  const result=await store.setJSON('presentation',record,{onlyIfMatch:entry.etag});
  if(!result.modified)return json({error:'Ein anderes Gerät hat inzwischen geändert. Bitte erneut versuchen.'},409);
  const verified=await store.getWithMetadata('presentation',{type:'json'});if(!verified||verified.data.state.revision<state.revision)throw Error('Speicherung nicht bestätigt. Bitte Verbindung prüfen.');
  return json(snapshot(verified.data));
 }catch(e){return json({error:e.message||'Vorübergehender Fehler.'},400);}
};}
export default makeHandler();
