import {setTimeout as delay} from 'node:timers/promises';
export class PlayerController {
  constructor(adapter,music){this.adapter=adapter;this.music=music;}
  async seek(trackId,seconds){
    if(typeof trackId!=='string'||!/^\d+$/.test(trackId)||typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)throw Error('INVALID_ARGUMENT');
    await this.adapter.playerControl('seek',{trackId,seconds});
    for(let i=0;i<10;i++){const s=await this.adapter.playerRead();if(s.trackId!==trackId)throw Error('TRACK_CHANGED');if(s.positionSeconds!==null&&Math.abs(s.positionSeconds-seconds)<=2)return {verified:true,positionSeconds:s.positionSeconds,trackId};await delay(150);}
    throw Error('SEEK_NOT_VERIFIED: Read current position before trying again.');
  }
  async volume(percent){
    if(typeof percent!=='number'||!Number.isFinite(percent)||percent<0||percent>100)throw Error('INVALID_ARGUMENT');
    await this.adapter.playerControl('volume',{percent});
    for(let i=0;i<10;i++){const s=await this.adapter.playerRead();if(typeof s.volumePercent==='number'&&Math.abs(s.volumePercent-percent)<=1)return {verified:true,volumePercent:s.volumePercent};await delay(150);}
    throw Error('VOLUME_NOT_VERIFIED: Read volume before trying again.');
  }
  async snapshot(){
    const before=await this.adapter.playerRead();
    const visible=await this.music.status();
    const after=await this.adapter.playerRead();
    if(before.trackId!==after.trackId||before.title!==after.title)throw Error('TRACK_CHANGED: Refresh the player.');
    const same=visible.title===after.title&&after.artists.every(a=>visible.artists?.includes(a.name));
    return {...after,playing:same?visible.playing:null,liked:same?visible.liked:null,trackKey:same?visible.trackKey:null,
      fetchedAt:new Date().toISOString(),identitySource:'desktop_catalog_id_with_visible_controls'};
  }
}
