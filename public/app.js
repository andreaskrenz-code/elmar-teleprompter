import {validateUpload,readResponse} from './upload-utils.js';
const $=id=>document.getElementById(id),tv=location.pathname==='/tv',live=location.pathname==='/live';
let current=null,busy=false,online=false,prepare=false,draft=null,dirty=false,active=false,mediaKey='',audioKey='',pollTimer,polling=false,lock,mediaLibrary=[],liveTextMode='cue',liveRenderedSectionKey='';
let code=sessionStorage.getItem('regie-code')||'';
$('code').value=code;$('regie').hidden=tv||live;$('live').hidden=!live;$('tv').hidden=!tv;document.body.classList.toggle('tv-mode',tv);document.body.classList.toggle('live-mode',live);
document.title=tv?'Geburtstag Elmar · Bildschirm':live?'Geburtstag Elmar · Live':'Geburtstag Elmar · Regie';
const note=message=>{$('notice').textContent=message;$('notice').hidden=!message;};
const uploadStatus=document.createElement('p');uploadStatus.setAttribute('role','status');$('photoList').before(uploadStatus);
new MutationObserver(()=>{uploadStatus.textContent=$('savedStatus').textContent;}).observe($('savedStatus'),{childList:true,characterData:true,subtree:true});
function controls(){for(const id of ['next','prev','nextImage','pause','blackout','saveSection','prepareMode','presentMode','moveSectionUp','moveSectionDown','moveSectionTo'])$(id).disabled=busy||!online||!current;
 for(const id of ['liveNext','livePrev'])$(id).disabled=busy||!online||!current;
 for(const id of ['sectionPhotos','sectionVideo','sectionAudio','deckFile','mediaFiles'])$(id).disabled=busy;
 if(current){const s=current.deck.sections[current.state.index],shown=current.state.image;$('prev').disabled||=current.state.index===0;$('next').disabled||=current.state.index===current.deck.sections.length-1;$('livePrev').disabled||=current.state.index===0&&!(s.mode==='manual'&&s.images.length>1&&shown>0);$('liveNext').disabled||=current.state.index===current.deck.sections.length-1&&!(s.mode==='manual'&&s.images.length>1&&shown<s.images.length-1);$('nextImage').disabled||=s.images.length<2;$('pause').disabled||=s.mode!=='auto'||s.images.length<2;$('moveSectionUp').disabled||=current.state.index===0;$('moveSectionDown').disabled||=current.state.index===current.deck.sections.length-1;}}
async function request(url,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);try{const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal,headers:{'x-regie-code':code,...options.headers}});const data=await readResponse(response);if(!response.ok){if(data.deck)accept(data);throw Error(data.error||'Verbindung nicht möglich.');}return data;}catch(e){if(e.name==='AbortError')throw Error('Die Übertragung dauert zu lange. Bitte Verbindung prüfen und die Datei erneut auswählen.');if(e instanceof TypeError)throw Error('Die Verbindung ist abgebrochen. Bitte Verbindung prüfen und erneut versuchen.');throw e;}finally{clearTimeout(timer);}}
async function login(value){await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:value})});}
function source(s,st){return s.video||s.images[st.image]||'';}
function mountMedia(container,src,isTV,s){container.replaceChildren();if(!src){if(!isTV){const empty=document.createElement('span');empty.className='empty-preview';empty.textContent=current?.state.blackout?'Bildschirm schwarz':'Noch kein Bild zugeordnet';container.append(empty);}return;}
 const el=document.createElement(s.video?'video':'img');el.src='/'+src.split('/').map(encodeURIComponent).join('/');
 if(s.video){el.playsInline=true;el.muted=!isTV||!$('sound').checked;el.loop=s.loop;el.preload='auto';if(isTV||container.id==='livePreview')el.autoplay=true;if(isTV){el.addEventListener('loadedmetadata',()=>{if(current){const seconds=(current.state.serverNow-current.state.startedAt)/1000;if(seconds>1&&Number.isFinite(el.duration))el.currentTime=s.loop?seconds%el.duration:Math.min(seconds,Math.max(0,el.duration-.1));}});el.play().catch(()=>{if(active){$('tvError').textContent='Video starten: hier tippen.';$('tvError').hidden=false;$('tvError').onclick=()=>el.play().then(()=>{$('tvError').hidden=true;}).catch(()=>{});}});}}else el.alt=isTV?'':s.title;
 el.onerror=()=>{if(isTV){$('tvError').textContent='Medium konnte nicht geladen werden. Bitte in der Regie prüfen.';$('tvError').hidden=false;}else note('Ein Medium konnte nicht geladen werden: '+src);};container.append(el);
}
function stopTvAudio(){const host=$('tvAudioHost');if(!host)return;for(const el of host.querySelectorAll('audio')){try{el.pause();}catch{}}host.replaceChildren();audioKey='';}
function syncTvAudio(s,state){if(!tv||!active)return;const host=$('tvAudioHost');if(!host)return;const src=s.audio||'';const key=src?[state.epoch,state.index,src,state.startedAt].join('|'):'';if(!src){if(audioKey)stopTvAudio();return;}if(key===audioKey)return;stopTvAudio();audioKey=key;const el=document.createElement('audio');el.src=mediaUrl(src);el.preload='auto';el.autoplay=true;host.append(el);el.addEventListener('loadedmetadata',()=>{const seconds=Math.max(0,(state.serverNow-state.startedAt)/1000);if(Number.isFinite(el.duration)&&seconds>0)el.currentTime=Math.min(seconds,Math.max(0,el.duration-.15));el.play().catch(()=>{if(active){$('tvError').textContent='Lied starten: hier tippen.';$('tvError').hidden=false;$('tvError').onclick=()=>el.play().then(()=>{$('tvError').hidden=true;}).catch(()=>{});}});});el.onerror=()=>{$('tvError').textContent='Audiodatei konnte nicht geladen werden.';$('tvError').hidden=false;};}
function accept(data){if(current&&current.state.epoch===data.state.epoch&&current.state.revision>data.state.revision)return;const old=current;current=data;online=true;
 const {deck,state}=data,s=deck.sections[state.index];
 if(tv){if(!active)return;const key=[state.epoch,state.index,source(s,state),state.blackout,state.startedAt].join('|');if(key!==mediaKey){mediaKey=key;$('tvError').hidden=true;mountMedia($('tvMedia'),state.blackout?'':source(s,state),true,s);}syncTvAudio(s,state);if($('tvError').textContent.startsWith('Verbindung'))$('tvError').hidden=true;return;}
 if(live){const key=[state.epoch,state.index,source(s,state),state.blackout].join('|');const sectionKey=[state.epoch,state.index,s.id||'',s.text||'',s.cue||''].join('|');const sectionChanged=sectionKey!==liveRenderedSectionKey;const sameSection=!!old&&old.state.epoch===state.epoch&&old.state.index===state.index&&(old.deck.sections[old.state.index]?.id||'')===(s.id||'');const oldImage=sameSection?old.state.image:null;const imageChanged=sameSection&&oldImage!==state.image;liveRenderedSectionKey=sectionKey;$('liveCounter').textContent=`${state.index+1} / ${deck.sections.length}`;$('liveMediaCounter').textContent=s.images.length>1?`Bild ${state.image+1} / ${s.images.length}${s.audio?' · ♫':''}`:(s.audio?'♫ Lied':'');$('liveTitle').textContent=s.title;renderLiveText(s,{resetScroll:sectionChanged});if(imageChanged&&s.mode==='manual')scrollLiveToImageStep(state.image,oldImage);$('liveStatus').classList.remove('offline');$('liveStatus').title='Verbunden';if(key!==mediaKey){mediaKey=key;mountMedia($('livePreview'),state.blackout?'':source(s,state),false,s);}controls();return;}
 $('connection').textContent='Verbunden';$('counter').textContent=`ABSCHNITT ${String(state.index+1).padStart(2,'0')} / ${String(deck.sections.length).padStart(2,'0')}`;
 const changed=!old||old.state.index!==state.index||old.state.epoch!==state.epoch||old.deck.sections[state.index]?.text!==s.text;
 $('sectionTitle').textContent=s.title;if($('speech').textContent!==s.text)$('speech').textContent=s.text;$('noteText').textContent=s.notes;$('notes').hidden=!s.notes;
 $('nextTitle').textContent=deck.sections[state.index+1]?.title||'Ende der Rede';$('progressText').textContent=`${state.index+1} von ${deck.sections.length}`;$('progress').max=deck.sections.length;$('progress').value=state.index+1;
 $('mediaCount').textContent=s.images.length?`${state.image+1} / ${s.images.length}`:'';
 $('mediaLabel').textContent=state.blackout?'TV ist schwarz geschaltet':s.video?'Video':s.images.length?(s.mode==='auto'?`Bildfolge · alle ${s.durationSeconds} Sekunden`:'Bildwechsel per Taste'):'Noch kein Bild zugeordnet';
 $('pause').textContent=state.paused?'Bildfolge fortsetzen':'Bildfolge pausieren';$('blackout').textContent=state.blackout?'TV-Bild wieder zeigen':'TV schwarz schalten';$('blackout').setAttribute('aria-pressed',String(state.blackout));
 const key=[state.epoch,state.index,source(s,state),state.blackout].join('|');if(key!==mediaKey){mediaKey=key;mountMedia($('preview'),state.blackout?'':source(s,state),false,s);}
 if(changed){window.scrollTo(0,0);if(prepare&&!dirty)loadDraft();}controls();
}
async function poll(){if(polling)return;polling=true;clearTimeout(pollTimer);try{accept(await request('/api/state'));}catch(e){online=false;if(tv){if(active){$('tvError').textContent='Verbindung unterbrochen. Letztes Bild bleibt stehen.';$('tvError').hidden=false;}}else if(live){$('liveStatus').classList.add('offline');$('liveStatus').title='Verbindung unterbrochen';controls();}else{$('connection').textContent='Nicht verbunden';controls();if(!current){$('settings').hidden=false;$('settingsButton').setAttribute('aria-expanded','true');note(e.message);}}}finally{polling=false;pollTimer=setTimeout(poll,location.hostname==='localhost'||/^\d+\.\d+\./.test(location.hostname)?500:1000);}}
async function action(action){if(busy||!current||!online)return;if(dirty&&['next','prev'].includes(action)&&!confirm('Ungespeicherte Änderungen verwerfen und zum anderen Abschnitt wechseln?'))return;
 if(['next','prev'].includes(action))dirty=false;busy=true;controls();note('');try{accept(await request(live?'/api/live-action':'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:globalThis.crypto?.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`,action,revision:current.state.revision,epoch:current.state.epoch})}));if(prepare)loadDraft();}catch(e){note(e.message+' Es wird kein weiterer Schritt automatisch ausgelöst.');}finally{busy=false;controls();}}
for(const [id,name] of Object.entries({next:'next',prev:'prev',nextImage:'image',pause:'pause',blackout:'blackout'}))$(id).onclick=()=>action(name);
$('liveNext').onclick=()=>action('next');$('livePrev').onclick=()=>action('prev');
const IMAGE_MARKER='[📷 BILDWECHSEL]';
function renderTextWithImageMarkers(box,value){
 const parts=String(value).split(IMAGE_MARKER);
 box.replaceChildren();
 parts.forEach((part,i)=>{
  if(part)box.append(document.createTextNode(part));
  if(i<parts.length-1){
   const marker=document.createElement('span');
   marker.className='live-image-marker';
   marker.textContent=`📷  WEITER → BILD ${i+2}`;
   marker.setAttribute('aria-label',`Bildwechsel auf Bild ${i+2}`);
   box.append(marker);
  }
 });
 box.dataset.renderedValue=value;
}
function scrollLiveToImageStep(imageIndex,previousImageIndex){
 const box=$('liveCue');if(!box)return;
 const markers=[...box.querySelectorAll('.live-image-marker')];
 if(!markers.length)return;
 const forward=Number(imageIndex)>Number(previousImageIndex);
 const markerIndex=forward?Number(imageIndex)-1:Math.max(0,Number(imageIndex));
 const marker=markers[markerIndex];if(!marker)return;
 const boxRect=box.getBoundingClientRect();

 if(forward){
  // V3.30: Nach dem Klick soll der Bildwechsel-Hinweis komplett nach oben
  // verschwinden und genau der Text DANACH oben im Lesebereich beginnen.
  let node=marker.nextSibling;
  while(node){
   if(node.nodeType===Node.TEXT_NODE){
    const value=node.nodeValue||'';
    const first=value.search(/\S/);
    if(first>=0){
     const range=document.createRange();
     range.setStart(node,first);
     range.setEnd(node,Math.min(value.length,first+1));
     const rect=range.getBoundingClientRect();
     range.detach?.();
     const target=Math.max(0,box.scrollTop+(rect.top-boxRect.top)-6);
     box.scrollTo({top:target,behavior:'smooth'});
     return;
    }
   }else if(node.nodeType===Node.ELEMENT_NODE){
    const rect=node.getBoundingClientRect();
    const target=Math.max(0,box.scrollTop+(rect.top-boxRect.top)-6);
    box.scrollTo({top:target,behavior:'smooth'});
    return;
   }
   node=node.nextSibling;
  }
  // Fallback, falls nach dem Marker kein weiterer Text mehr kommt.
  const markerRect=marker.getBoundingClientRect();
  const target=Math.max(0,box.scrollTop+(markerRect.bottom-boxRect.top)+8);
  box.scrollTo({top:target,behavior:'smooth'});
  return;
 }

 // Beim Zurueckgehen den zugehoerigen Marker sichtbar machen.
 const markerRect=marker.getBoundingClientRect();
 const markerTop=box.scrollTop+(markerRect.top-boxRect.top);
 const contextOffset=Math.max(36,Math.min(140,box.clientHeight*.24));
 box.scrollTo({top:Math.max(0,markerTop-contextOffset),behavior:'smooth'});
}
function renderLiveText(section,{resetScroll=false}={}){
 const cue=(section?.cue||'').trim();
 const full=(section?.text||'').trim();
 const value=liveTextMode==='full'?(full||cue||'—'):(cue||full||'—');
 const box=$('liveCue');
 const oldScroll=box.scrollTop;
 if(box.dataset.renderedValue!==value)renderTextWithImageMarkers(box,value);
 $('liveStage').classList.toggle('full-text',liveTextMode==='full');
 $('liveShowCue').classList.toggle('active',liveTextMode==='cue');
 $('liveShowFull').classList.toggle('active',liveTextMode==='full');
 $('liveShowCue').setAttribute('aria-pressed',String(liveTextMode==='cue'));
 $('liveShowFull').setAttribute('aria-pressed',String(liveTextMode==='full'));
 // Regelmaessige Statusabfragen duerfen die Leseposition nicht veraendern.
 // Nur ein echter Abschnitts-/Moduswechsel startet bewusst oben.
 if(resetScroll)box.scrollTop=0;else box.scrollTop=oldScroll;
}
function setLiveTextMode(mode){
 const nextMode=mode==='full'?'full':'cue';
 const changed=nextMode!==liveTextMode;
 liveTextMode=nextMode;
 if(current)renderLiveText(current.deck.sections[current.state.index],{resetScroll:changed});
}
$('liveShowCue').onclick=()=>setLiveTextMode('cue');
$('liveShowFull').onclick=()=>setLiveTextMode('full');

// Live-Farbschema: auf dem jeweiligen Tablet merken. Der Wechsel ist rein optisch
// und beeinflusst weder Abschnitt, Scrollposition noch die Bild-/Textgroesse.
let liveTheme=localStorage.getItem('elmar-live-theme')==='light'?'light':'dark';
function applyLiveTheme(){
 const light=liveTheme==='light';
 document.body.classList.toggle('live-light',light);
 const button=$('liveThemeToggle');
 if(button){
  button.textContent=light?'Dunkel':'Hell';
  button.setAttribute('aria-pressed',String(light));
  button.setAttribute('aria-label',light?'Dunkle Darstellung einschalten':'Helle Darstellung einschalten');
 }
 localStorage.setItem('elmar-live-theme',liveTheme);
}
$('liveThemeToggle').onclick=()=>{liveTheme=liveTheme==='light'?'dark':'light';applyLiveTheme();};
applyLiveTheme();

// Live-Anzeige fuer das Tablet: stufenloses Skalieren statt fester Groessenstufen.
// Bild -/+ skaliert die komplette Vorschau proportional. Gleichzeitig wird der Text
// gegenlaeufig angepasst: kleineres Bild = groesserer Text, groesseres Bild = kleinerer Text.
// Die Werte werden nur auf diesem Geraet im Browser gespeichert.
let liveImageScale=Number(localStorage.getItem('elmar-live-image-scale')||'1');
let liveTextScale=Number(localStorage.getItem('elmar-live-text-scale')||'1');
if(!Number.isFinite(liveImageScale)||liveImageScale<=0)liveImageScale=1;
if(!Number.isFinite(liveTextScale)||liveTextScale<=0)liveTextScale=1;
function applyLiveDisplay(){
 const stage=$('liveStage');if(!stage)return;
 // Sehr weiter Sicherheitsbereich, aber keine sichtbaren Stufen oder deaktivierten Tasten.
 liveImageScale=Math.max(.05,Math.min(8,liveImageScale));
 liveTextScale=Math.max(.35,Math.min(4,liveTextScale));
 stage.style.setProperty('--live-image-scale',String(liveImageScale));
 stage.style.setProperty('--live-cue-size',`${40*liveTextScale}px`);
 stage.style.setProperty('--live-title-size',`${43*liveTextScale}px`);
 localStorage.setItem('elmar-live-image-scale',String(liveImageScale));
 localStorage.setItem('elmar-live-text-scale',String(liveTextScale));
 // Aeltere Stufenwerte nicht mehr verwenden.
 localStorage.removeItem('elmar-live-image-level');
 localStorage.removeItem('elmar-live-text-level');
 $('liveImageSmaller').disabled=false;$('liveImageLarger').disabled=false;
 $('liveTextSmaller').disabled=false;$('liveTextLarger').disabled=false;
}
function changeImageSize(factor){
 liveImageScale*=factor;
 // Gegenlaeufige, etwas sanftere Textanpassung.
 liveTextScale*=factor<1?1.075:.93;
 applyLiveDisplay();
}
$('liveImageSmaller').onclick=()=>changeImageSize(.88);
$('liveImageLarger').onclick=()=>changeImageSize(1/.88);
$('liveTextSmaller').onclick=()=>{liveTextScale*=.92;applyLiveDisplay();};
$('liveTextLarger').onclick=()=>{liveTextScale*=1/.92;applyLiveDisplay();};
applyLiveDisplay();
$('settingsButton').onclick=()=>{$('settings').hidden=!$('settings').hidden;$('settingsButton').setAttribute('aria-expanded',String(!$('settings').hidden));};
$('unlock').onclick=async()=>{code=$('code').value.trim();try{await login(code);sessionStorage.setItem('regie-code',code);note('Regie verbunden.');accept(await request('/api/state'));if(prepare)loadMediaLibrary();}catch(e){note(e.message);}};
let font=Number(localStorage.getItem('speech-font'))||32;function size(){document.documentElement.style.setProperty('--speech-size',`${font}px`);localStorage.setItem('speech-font',font);}size();$('smaller').onclick=()=>{font=Math.max(22,font-2);size();};$('larger').onclick=()=>{font=Math.min(60,font+2);size();};
function mediaUrl(src){return '/'+src.split('/').map(encodeURIComponent).join('/');}
async function loadMediaLibrary(){if(!code){$('galleryStatus').textContent='Bitte zuerst die Regie mit dem Code verbinden.';return;}try{const data=await request('/api/media-list');mediaLibrary=(data.media||[]).filter(src=>/\.(jpg|jpeg|png|webp|gif)$/i.test(src));photos();renderMediaGallery();}catch(e){$('galleryStatus').textContent='Galerie konnte nicht geladen werden: '+e.message;}}
async function saveDraft({quiet=false}={}){if(!draft||busy)return false;busy=true;controls();try{const deck=JSON.parse(JSON.stringify(current.deck));const index=deck.sections.findIndex(s=>s.id===draft.id);if(index<0)throw Error('Abschnitt wurde inzwischen ersetzt. Bitte neu laden.');deck.sections[index]={...draft,title:$('editTitle').value,text:$('editText').value,cue:$('editCue').value,notes:$('editNotes').value,mode:$('editMode').value,durationSeconds:Number($('editDuration').value),loop:$('editLoop').checked,audio:draft.audio||null};const data=await request('/api/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck,revision:draft.baseRevision,epoch:draft.baseEpoch,focusSectionId:draft.id})});dirty=false;accept(data);loadDraft();if(!quiet)$('savedStatus').textContent='Gespeichert ✓';note('');return true;}catch(e){note(e.message);return false;}finally{busy=false;controls();}}
function usedImageSet(){const used=new Set();if(current?.deck?.sections)for(const section of current.deck.sections){const images=section.id===draft?.id?(draft?.images||[]):(section.images||[]);for(const src of images)used.add(src);}else for(const src of draft?.images||[])used.add(src);return used;}
async function chooseMedia(src){if(!draft||busy)return;draft.video=null;const multi=$('multiImageMode')?.checked;if(multi){if(!draft.images.includes(src))draft.images.push(src);}else draft.images=[src];dirty=true;photos();renderMediaGallery();$('savedStatus').textContent='Bild wird zugeordnet …';const ok=await saveDraft({quiet:true});if(ok){$('savedStatus').textContent=multi?`${draft.images.length} Bilder zugeordnet ✓`:'Bild zugeordnet ✓';photos();renderMediaGallery();}}
function renderMediaGallery(){const gallery=$('mediaGallery');if(!gallery)return;gallery.replaceChildren();const term=($('mediaSearch').value||'').trim().toLocaleLowerCase('de');const used=usedImageSet();const available=mediaLibrary.filter(src=>!used.has(src));const items=available.filter(src=>!term||src.toLocaleLowerCase('de').includes(term));$('galleryStatus').textContent=`${available.length} von ${mediaLibrary.length} Bildern noch verfügbar${term?` · ${items.length} Treffer`:''}`;if(!items.length){const empty=document.createElement('div');empty.className='media-empty';empty.textContent=term?'Keine verfügbaren Bilder passen zur Suche.':'Alle geladenen Bilder sind bereits zugeordnet.';gallery.append(empty);return;}for(const src of items){const button=document.createElement('button');button.type='button';button.className='media-tile';button.title='Diesem Abschnitt zuordnen: '+src.split('/').pop();const img=document.createElement('img');img.src=mediaUrl(src);img.alt=src.split('/').pop();img.loading='lazy';const name=document.createElement('span');name.textContent=src.split('/').pop();const move=document.createElement('b');move.textContent='＋';move.setAttribute('aria-hidden','true');button.append(img,name,move);button.onclick=()=>chooseMedia(src);gallery.append(button);}}
function switchMode(value){if(!value&&dirty&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;prepare=value;dirty=false;$('editor').hidden=!value;document.querySelector('.workspace').hidden=value;$('prepareMode').setAttribute('aria-pressed',String(value));$('presentMode').setAttribute('aria-pressed',String(!value));if(value&&current){loadDraft();loadMediaLibrary();}}
$('prepareMode').onclick=()=>switchMode(true);$('presentMode').onclick=()=>switchMode(false);
$('refreshMedia').onclick=()=>loadMediaLibrary();$('mediaSearch').oninput=()=>renderMediaGallery();$('multiImageMode').onchange=()=>renderMediaGallery();
function renderSectionMoveTargets(){const select=$('moveSectionTarget');if(!select||!current||!draft)return;const previous=select.value;select.replaceChildren();current.deck.sections.forEach((section,i)=>{if(section.id===draft.id)return;const option=document.createElement('option');option.value=String(i);option.textContent=`Bereich ${i+1} · ${section.title||'Ohne Überschrift'}`;select.append(option);});if(previous&&[...select.options].some(o=>o.value===previous))select.value=previous;else{const preferred=Math.min(current.deck.sections.length-1,current.state.index+1);const exact=[...select.options].find(o=>Number(o.value)===preferred);if(exact)select.value=exact.value;}}
function loadDraft(){draft=JSON.parse(JSON.stringify(current.deck.sections[current.state.index]));draft.baseRevision=current.state.revision;draft.baseEpoch=current.state.epoch;$('editHeading').textContent=`${current.state.index+1}. ${draft.title}`;$('sectionOrderStatus').textContent=`Bereich ${current.state.index+1} von ${current.deck.sections.length}`;$('editTitle').value=draft.title;$('editText').value=draft.text;$('editCue').value=draft.cue||'';$('editNotes').value=draft.notes;$('editMode').value=draft.mode;$('editDuration').value=draft.durationSeconds;$('editLoop').checked=draft.loop;$('audioLabel').textContent=draft.audio?'Lied: '+draft.audio.split('/').pop():'';$('removeAudio').hidden=!draft.audio;$('savedStatus').textContent='';dirty=false;renderSectionMoveTargets();photos();renderMediaGallery();}
async function changeAssigned(mutator,message){if(!draft||busy)return;mutator();dirty=true;photos();renderMediaGallery();$('savedStatus').textContent='Bildzuordnung wird gespeichert …';const ok=await saveDraft({quiet:true});if(ok){$('savedStatus').textContent=message;photos();renderMediaGallery();}}
function photos(){const list=$('photoList');if(!list||!draft)return;list.replaceChildren();if(!draft.images.length&&!draft.video){const empty=document.createElement('div');empty.className='assigned-empty';empty.innerHTML='<strong>Noch kein Bild zugeordnet</strong><span>Wähle unten ein verfügbares Bild aus.</span>';list.append(empty);}draft.images.forEach((src,i)=>{const card=document.createElement('article');card.className='assigned-card';const img=document.createElement('img');img.src=mediaUrl(src);img.alt=`Zugeordnetes Foto ${i+1}`;const info=document.createElement('div');info.className='assigned-info';const badge=document.createElement('small');badge.textContent=draft.images.length>1?`Bild ${i+1} von ${draft.images.length}`:'Zugeordnetes Bild';const label=document.createElement('strong');label.textContent=src.split('/').pop();info.append(badge,label);const actions=document.createElement('div');actions.className='assigned-actions';if(draft.images.length>1){const up=document.createElement('button');up.type='button';up.className='quiet';up.textContent='←';up.title='Bild nach vorne';up.disabled=i===0;up.onclick=()=>changeAssigned(()=>{[draft.images[i-1],draft.images[i]]=[draft.images[i],draft.images[i-1]];},'Reihenfolge gespeichert ✓');const down=document.createElement('button');down.type='button';down.className='quiet';down.textContent='→';down.title='Bild nach hinten';down.disabled=i===draft.images.length-1;down.onclick=()=>changeAssigned(()=>{[draft.images[i+1],draft.images[i]]=[draft.images[i],draft.images[i+1]];},'Reihenfolge gespeichert ✓');actions.append(up,down);}const remove=document.createElement('button');remove.type='button';remove.className='remove-photo';remove.textContent='Entfernen';remove.onclick=()=>changeAssigned(()=>draft.images.splice(i,1),'Bild entfernt und wieder verfügbar ✓');actions.append(remove);card.append(img,info,actions);list.append(card);});$('removeVideo').hidden=!draft.video;if(draft.video){const p=document.createElement('div');p.className='assigned-video';p.textContent='Video: '+draft.video.split('/').pop();list.append(p);}}
for(const id of ['editTitle','editText','editCue','editNotes','editMode','editDuration','editLoop'])$(id).oninput=()=>{dirty=true;$('savedStatus').textContent='Noch nicht gespeichert';};
function insertImageMarker(textareaId){
 const field=$(textareaId);if(!field||!draft)return;
 const start=field.selectionStart??field.value.length,end=field.selectionEnd??start;
 const before=field.value.slice(0,start),after=field.value.slice(end);
 const lead=before&&!before.endsWith('\n')?'\n\n':'';
 const tail=after&&!after.startsWith('\n')?'\n\n':'';
 const insertion=lead+IMAGE_MARKER+tail;
 field.value=before+insertion+after;
 const pos=before.length+insertion.length;field.focus();field.setSelectionRange(pos,pos);
 dirty=true;$('savedStatus').textContent='Bildwechsel eingefügt – Textänderungen noch speichern';
}
$('insertTextImageMarker').onclick=()=>insertImageMarker('editText');
$('insertCueImageMarker').onclick=()=>insertImageMarker('editCue');
$('editTitle').addEventListener('change',async()=>{
 if(!draft||busy)return;
 dirty=true;$('savedStatus').textContent='Überschrift wird gespeichert …';
 const ok=await saveDraft({quiet:true});
 if(ok)$('savedStatus').textContent='Überschrift gespeichert ✓';
});
async function moveSectionToIndex(targetIndex){
 if(!draft||!current||busy)return;
 const movingId=draft.id;
 if(dirty){$('savedStatus').textContent='Änderungen werden vor dem Verschieben gespeichert …';const ok=await saveDraft({quiet:true});if(!ok)return;}
 const from=current.deck.sections.findIndex(s=>s.id===movingId);
 const to=Math.max(0,Math.min(current.deck.sections.length-1,Number(targetIndex)));
 if(from<0||!Number.isInteger(to)||from===to)return;
 busy=true;controls();note('');
 try{
  const deck=JSON.parse(JSON.stringify(current.deck));
  const [section]=deck.sections.splice(from,1);
  deck.sections.splice(to,0,section);
  $('savedStatus').textContent=`Bereich ${from+1} wird an Position ${to+1} verschoben …`;
  const data=await request('/api/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck,revision:current.state.revision,epoch:current.state.epoch,focusSectionId:movingId})});
  dirty=false;accept(data);loadDraft();$('savedStatus').textContent=`Bereich steht jetzt auf Position ${current.state.index+1} ✓`;
 }catch(e){note(e.message);$('savedStatus').textContent='Bereich konnte nicht verschoben werden.';}finally{busy=false;controls();}
}
async function moveSection(delta){if(!draft||!current)return;const from=current.deck.sections.findIndex(s=>s.id===draft.id);if(from<0)return;await moveSectionToIndex(from+delta);}
$('moveSectionUp').onclick=()=>moveSection(-1);
$('moveSectionDown').onclick=()=>moveSection(1);
$('moveSectionTo').onclick=()=>{const target=Number($('moveSectionTarget').value);if(Number.isInteger(target))moveSectionToIndex(target);};
async function upload(file,src){validateUpload(file,current?.uploadLimitBytes??4*1024*1024);await request('/api/media?path='+encodeURIComponent(src),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});}
function imageFiles(files){return [...files].filter(file=>/^image\/(jpeg|png|webp|gif)$/i.test(file.type)||/\.(jpg|jpeg|png|webp|gif)$/i.test(file.name));}
async function libraryUpload(files){const images=imageFiles(files);if(busy||!images.length)return;busy=true;controls();const zone=$('mediaDropZone');try{for(const file of images)validateUpload(file,current?.uploadLimitBytes??4*1024*1024);for(let i=0;i<images.length;i++){const file=images[i];const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const src='media/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+safe;$('savedStatus').textContent=`Füge Bild ${i+1} von ${images.length} hinzu …`;await upload(file,src);}$('savedStatus').textContent=`${images.length} neue${images.length===1?'s':''} Bild${images.length===1?'':'er'} im Vorrat ✓`;await loadMediaLibrary();}catch(e){note(e.message);$('savedStatus').textContent='Bilder konnten nicht vollständig hinzugefügt werden.';}finally{zone?.classList.remove('drag-over');busy=false;controls();}}
const dropZone=$('mediaDropZone'),libraryInput=$('libraryPhotos');if(dropZone&&libraryInput){dropZone.onclick=e=>{if(e.target!==libraryInput)libraryInput.click();};dropZone.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();libraryInput.click();}};for(const event of ['dragenter','dragover'])dropZone.addEventListener(event,e=>{e.preventDefault();e.stopPropagation();dropZone.classList.add('drag-over');});for(const event of ['dragleave','drop'])dropZone.addEventListener(event,e=>{e.preventDefault();e.stopPropagation();dropZone.classList.remove('drag-over');});dropZone.addEventListener('drop',e=>libraryUpload(e.dataTransfer.files));libraryInput.onchange=async e=>{const input=e.target;try{await libraryUpload(input.files);}finally{input.value='';}};}
async function sectionUpload(files,video){if(!draft||busy||!files.length)return;busy=true;controls();note('');try{for(const file of files)validateUpload(file,current?.uploadLimitBytes??4*1024*1024);if(video&&draft.images.length&&!confirm('Die Fotos in diesem Abschnitt durch ein Video ersetzen?'))return;for(const file of files){const src='media/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');$('savedStatus').textContent='Übertrage '+file.name;await upload(file,src);if(video){draft.video=src;draft.images=[];}}if(video){dirty=true;const ok=await saveDraft({quiet:true});if(ok)$('savedStatus').textContent='Video gespeichert ✓';}await loadMediaLibrary();}catch(e){$('savedStatus').textContent='Upload nicht abgeschlossen: '+e.message;note(e.message);}finally{busy=false;controls();}}
$('sectionPhotos').onchange=async e=>{const input=e.target;try{await libraryUpload(input.files);}finally{input.value='';}};$('sectionVideo').onchange=async e=>{const input=e.target;try{await sectionUpload([...input.files],true);}finally{input.value='';}};$('removeVideo').onclick=async()=>{draft.video=null;dirty=true;await saveDraft({quiet:true});photos();renderMediaGallery();};
async function audioUpload(file){if(!draft||busy||!file)return;busy=true;controls();try{validateUpload(file,current?.uploadLimitBytes??4*1024*1024);const src='media/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');$('savedStatus').textContent='Übertrage Lied '+file.name;await upload(file,src);draft.audio=src;dirty=true;const ok=await saveDraft({quiet:true});if(ok){$('savedStatus').textContent='Lied gespeichert ✓';$('audioLabel').textContent='Lied: '+file.name;$('removeAudio').hidden=false;}}catch(e){note(e.message);$('savedStatus').textContent='Audio nicht gespeichert: '+e.message;}finally{busy=false;controls();}}
$('sectionAudio').onchange=async e=>{const input=e.target;try{await audioUpload(input.files[0]);}finally{input.value='';}};$('removeAudio').onclick=async()=>{if(!draft)return;draft.audio=null;dirty=true;await saveDraft({quiet:true});$('audioLabel').textContent='';$('removeAudio').hidden=true;};
$('saveSection').onclick=()=>saveDraft();
$('deckFile').onchange=async e=>{const file=e.target.files[0];if(!file||busy)return;if(!confirm('Die aktuelle Rede durch diese Datei ersetzen und beim ersten Abschnitt beginnen?'))return;busy=true;controls();try{const deck=JSON.parse(await file.text());const data=await request('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(deck)});dirty=false;accept(data);if(prepare)loadDraft();$('importStatus').textContent='Rede geladen.';note('');}catch(e){$('importStatus').textContent=e.message;}finally{busy=false;controls();e.target.value='';}};
$('mediaFiles').onchange=async e=>{if(busy)return;busy=true;controls();try{const files=[...e.target.files].filter(f=>/\.(jpg|jpeg|png|webp|gif|mp4|webm|m4v|mp3|m4a|wav|ogg)$/i.test(f.name));for(let i=0;i<files.length;i++){const f=files[i],relative=f.webkitRelativePath.split('/').slice(1).join('/');$('importStatus').textContent=`Übertrage ${i+1} von ${files.length}: ${f.name}`;await upload(f,'media/'+relative);}$('importStatus').textContent=`${files.length} Medien übertragen. Jetzt Rede-Datei laden.`;if(prepare)await loadMediaLibrary();}catch(e){$('importStatus').textContent=e.message;}finally{busy=false;controls();}};
$('export').onclick=()=>{if(!current)return;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(current.deck,null,2)],{type:'application/json'}));a.href=url;a.download='elmar-rede.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function awake(){try{lock=await navigator.wakeLock?.request('screen');}catch{}}
$('activate').onclick=async()=>{try{const data=await request('/api/state');active=true;$('tvStart').hidden=true;$('tvError').hidden=true;document.documentElement.requestFullscreen?.().catch(()=>{});awake();accept(data);}catch(e){$('tvError').textContent=e.message;$('tvError').hidden=false;}};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){poll();if(active)awake();}});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(tv||prepare||['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(e.target.tagName))return;if(e.key==='ArrowRight'){e.preventDefault();action('next');}if(e.key==='ArrowLeft'){e.preventDefault();action('prev');}});
if(!tv)request('/api/addresses').then(({urls})=>{for(const url of urls){const p=document.createElement('p');p.textContent='Vorbereitung: '+url+'/regie · Elmar Live: '+url+'/live · TV/Raspberry: '+url+'/tv';$('addresses').append(p);}}).catch(()=>{});
if(!tv&&!live&&!code){$('settings').hidden=false;$('settingsButton').setAttribute('aria-expanded','true');}
controls();if(live){active=true;awake();}poll();
