import {readFileSync} from 'node:fs';
export const PLAYER_URI='ui://netease/player-v1.html';
export function registerPlayerResource(server){
 const html=readFileSync(new URL('./ui/player.html',import.meta.url),'utf8');
 server.registerResource('netease-player',PLAYER_URI,{mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{
  uri:PLAYER_URI,mimeType:'text/html;profile=mcp-app',text:html,
  _meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:['https://*.music.126.net']}},'openai/widgetDescription':'网易云桌面播放器，展示当前歌曲、封面与歌词，提供播放控制和发给当前对话的输入框。'},
 }]}));
}
