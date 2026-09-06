import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../src/server.mjs';

test('native player resource is attached only to the render tool; reads do not remount the card',async t=>{
 const server=createServer({}, {player:{async snapshot(){return {trackId:'123',title:'Music',lyrics:[],playing:true};}}});
 const client=new Client({name:'widget-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 t.after(async()=>{await client.close();await server.close();});await server.connect(b);await client.connect(a);
 const tools=(await client.listTools()).tools,render=tools.find(t=>t.name==='netease_show_player'),read=tools.find(t=>t.name==='netease_get_player');
 assert.ok(render);assert.ok(read);assert.equal(render._meta.ui.resourceUri,'ui://netease/player-v1.html');assert.equal(read._meta?.ui?.resourceUri,undefined);assert.equal(read.annotations.readOnlyHint,true);
 const resource=await client.readResource({uri:render._meta.ui.resourceUri});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(resource.contents[0].text,/ui\/message/);
 const result=await client.callTool({name:render.name,arguments:{}});assert.equal(result.structuredContent.result.trackId,'123');
});
