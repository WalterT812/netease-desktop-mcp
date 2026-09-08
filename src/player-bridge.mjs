// Verified player projection and narrowly scoped controls. Never return account profiles.
export function playerBridge(action,args={}) {
  if(!['read','seek','volume','cycleMode'].includes(action))throw Error('UNKNOWN_ACTION');
  const builds=[...new Set(Array.from(document.scripts).map(s=>/\/app\.chunk\.([^/.?]+)\.js(?:$|\?)/.exec(s.src)?.[1]).filter(Boolean))];
  if(builds.length!==1||!['d4e863d','5b23b4d'].includes(builds[0]))throw Error('UNSUPPORTED_PLAYLIST_CLIENT');
  const node=document.querySelector('[data-testid="tid_createplaylist_section"]');
  let fiber=node?.[Object.keys(node).find(k=>k.startsWith('__reactInternalInstance')||k.startsWith('__reactFiber'))],store;
  for(let depth=0;fiber&&depth++<100;fiber=fiber.return){const candidate=fiber.memoizedProps?.value?.store;if(typeof candidate?.getState==='function'){store=candidate;break;}}
  const p=store?.getState()?.playing;if(!p)throw Error('UNSUPPORTED_PLAYLIST_CLIENT');
  if(action==='cycleMode'){
    const labels={playOrder:'顺序播放',playCycle:'列表循环',playOneCycle:'单曲循环',playRandom:'随机播放'};
    if(typeof args.expectedMode!=='string'||!Object.prototype.hasOwnProperty.call(labels,args.expectedMode))throw Error('INVALID_ARGUMENT');
    if(p.playingMode!==args.expectedMode)throw Error('UNSUPPORTED_CONTROL_LAYOUT');
    const matches=[...document.querySelectorAll('.default-bar-wrapper span[title]')].filter(s=>s.title===labels[p.playingMode]&&s.getClientRects().length);
    const button=matches.length===1?matches[0].closest('button'):null;
    if(!button||button.disabled)throw Error('UNSUPPORTED_CONTROL_LAYOUT');
    button.click();return {dispatched:true};
  }
  const sliders=[...document.querySelectorAll('input[type="range"][_nk="os9s91"]')];
  const slider=sliders.length===1?sliders[0]:null;
  const position=slider&&Number(slider.getAttribute('max'))===p.resourceDuration?Number(slider.value):NaN;
  const positionSeconds=Number.isFinite(position)&&position>=0&&position<=p.resourceDuration?position:null;
  const volumePercent=typeof p.playingVolume==='number'&&p.playingVolume>=0&&p.playingVolume<=1?Math.round(p.playingVolume*100):null;
  if(action==='seek'){
    if(typeof args.trackId!=='string'||args.trackId!==String(p.onlineResourceId))throw Error('TRACK_CHANGED');
    if(typeof args.seconds!=='number'||!Number.isFinite(args.seconds)||args.seconds<0||args.seconds>p.resourceDuration)throw Error('INVALID_ARGUMENT');
    if(positionSeconds===null||!p.resourceTrackId||p.isLoadingFirst||p.restoreResource||p.resourceIsTryType)throw Error('UNSUPPORTED_CONTROL_LAYOUT');
    if(typeof store.dispatch!=='function')throw Error('UNSUPPORTED_CONTROL_LAYOUT');
    store.dispatch({type:'playing/setPlayingPosition',payload:{duration:args.seconds}});return {dispatched:true};
  }
  if(action==='volume'){
    if(typeof args.percent!=='number'||!Number.isFinite(args.percent)||args.percent<0||args.percent>100)throw Error('INVALID_ARGUMENT');
    if(volumePercent===null||typeof store.dispatch!=='function')throw Error('UNSUPPORTED_CONTROL_LAYOUT');
    store.dispatch({type:'playing/setVolume',payload:{volume:args.percent/100}});return {dispatched:true};
  }
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
  return {trackId:id(p.onlineResourceId),title:text(p.resourceName),positionSeconds,volumePercent,
    canSeek:positionSeconds!==null&&!!p.resourceTrackId&&!p.isLoadingFirst&&!p.restoreResource&&!p.resourceIsTryType,
    artists:Array.isArray(p.resourceArtists)?p.resourceArtists.slice(0,12).map(a=>({id:id(a?.id),name:text(a?.name,150)})).filter(a=>a.name):[],
    coverUrl:cover(),durationSeconds:typeof p.resourceDuration==='number'&&Number.isFinite(p.resourceDuration)&&p.resourceDuration>=0?p.resourceDuration:null,
    mode:text(p.playingMode,40),lyrics,lyricLine:Number.isSafeInteger(p.playingLyricLineNumber)&&p.playingLyricLineNumber>=0?p.playingLyricLineNumber:null};
}
