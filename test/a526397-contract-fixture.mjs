// Minimal factory fragments from the 15 Sep 2026 runtime inspection, never executed.
export const apiFactory = [
 ['V','Pn','/api/cloudsearch/pc'],['Rh','le','/api/v6/playlist/detail'],
 ['Oh','qi','/api/v3/song/detail'],['zh','Mn','/api/v1/playlist/manipulate/tracks'],
 ['xg','So','/api/song/lyric/v1'],
].map(([key,symbol,route])=>`n.d(t,"${key}",(function(){return ${symbol}}));${symbol}=Object(r.a)("${route}");`).join('\n');
export const playingFactory = 'const He="playing";const{tracks:e,from:t,options:a,triggerScene:l}=n;'+
 'setVolume(e,t){let{payload:n}=e,{select:r}=t;return function*(){const{volume:e}=n;i.AudioPlayer.setVolume(e)}};'+
 'switchPlayingMode(e,t){let{payload:n}=e,{put:r,select:o,call:a}=t;};const{duration:e=0}=n';
export function attachContracts(loader){
 loader.m[14]=apiFactory;loader.m[228]=playingFactory;loader.c[228]={exports:{}};
}
