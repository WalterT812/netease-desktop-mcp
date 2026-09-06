// Read-only projection of the verified desktop store. Never return account profiles.
export function playerBridge(action) {
  if(action!=='read')throw Error('UNKNOWN_ACTION');
  if(!Array.from(document.scripts).some(s=>/\/app\.chunk\.d4e863d\.js(?:$|\?)/.test(s.src)))throw Error('UNSUPPORTED_PLAYLIST_CLIENT');
  const node=document.querySelector('[data-testid="tid_createplaylist_section"]');
  let fiber=node?.[Object.keys(node).find(k=>k.startsWith('__reactInternalInstance')||k.startsWith('__reactFiber'))],store;
  for(let depth=0;fiber&&depth++<100;fiber=fiber.return){const candidate=fiber.memoizedProps?.value?.store;if(typeof candidate?.getState==='function'){store=candidate;break;}}
  const p=store?.getState()?.playing;if(!p)throw Error('UNSUPPORTED_PLAYLIST_CLIENT');
  const text=(v,max=500)=>typeof v==='string'?v.slice(0,max):null;
  const id=v=>/^[0-9]+$/.test(String(v??''))?String(v):null;
  const cover=()=>{try{const u=new URL(p.resourceCoverUrl);if(!['https:','http:'].includes(u.protocol)||!u.hostname.endsWith('.music.126.net')||u.username||u.password)return null;u.protocol='https:';return u.href;}catch{return null;}};
  // Unknown lyric shapes remain unknown. Never stringify arbitrary store objects.
  let lyrics=null;
  if(Array.isArray(p.playingLyric)){
    const source=p.playingLyric.slice(0,500);
    if(source.every(x=>typeof x==='string'))lyrics=source.map(x=>x.slice(0,500));
    else if(source.every(x=>x&&typeof x==='object'&&typeof x.content==='string'))lyrics=source.map(x=>x.content.slice(0,500));
  }
  return {trackId:id(p.onlineResourceId),title:text(p.resourceName),
    artists:Array.isArray(p.resourceArtists)?p.resourceArtists.slice(0,12).map(a=>({id:id(a?.id),name:text(a?.name,150)})).filter(a=>a.name):[],
    coverUrl:cover(),durationSeconds:typeof p.resourceDuration==='number'&&Number.isFinite(p.resourceDuration)&&p.resourceDuration>=0?p.resourceDuration:null,
    mode:text(p.playingMode,40),lyrics,lyricLine:Number.isSafeInteger(p.playingLyricLineNumber)&&p.playingLyricLineNumber>=0?p.playingLyricLineNumber:null};
}
