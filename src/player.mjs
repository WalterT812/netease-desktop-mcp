export class PlayerController {
  constructor(adapter,music){this.adapter=adapter;this.music=music;}
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
