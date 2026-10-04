export function validateUpload(file,limit){
 if(!/\.(jpe?g|png|webp|gif|mp4|webm|m4v|mp3|m4a|wav|ogg)$/i.test(file.name))throw Error('Bitte JPG, PNG, WebP oder GIF verwenden; Videos als MP4/WebM und Audio als MP3, M4A, WAV oder OGG. HEIC vorher als JPG exportieren.');
 if(!file.size)throw Error('Die ausgewählte Datei ist leer. Bitte eine andere Datei auswählen.');
 if(file.size>limit)throw Error(`„${file.name}“ ist zu groß (${(file.size/1024/1024).toFixed(1)} MB). Erlaubt sind höchstens ${Math.floor(limit/1024/1024)} MB je Datei. Bitte das Foto verkleinern und erneut auswählen.`);
}
export async function readResponse(response){
 const text=await response.text();let data;
 try{data=JSON.parse(text);}catch{
  if(response.status===413)throw Error('Die Datei ist für den Upload zu groß. Bitte auf weniger als 4 MB verkleinern und erneut auswählen.');
  if(response.status===401||response.status===403)throw Error('Bitte unter „Einrichten“ erneut mit dem Regie-Code verbinden.');
  throw Error(`Der Server hat keine gültige Antwort gesendet (HTTP ${response.status}). Bitte erneut versuchen; bei Wiederholung diese Meldung mitteilen.`);
 }
 return data;
}
