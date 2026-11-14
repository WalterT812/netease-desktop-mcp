import { playingFactory } from './a526397-contract-fixture.mjs';

// Fixed factory fragments observed on the installed 3.1.41 client; never executed.
export const apiFactory = [
  ['V', 'Mn', '/api/cloudsearch/pc'], ['gi', 'ce', '/api/v6/playlist/detail'],
  ['di', 'Wi', '/api/v3/song/detail'], ['Oh', 'In', '/api/v1/playlist/manipulate/tracks'],
  ['zg', 'To', '/api/song/lyric/v1'],
].map(([key, symbol, route]) => `n.d(t,"${key}",(function(){return ${symbol}}));${symbol}=Object(r.a)("${route}");`).join('\n');

export function attachContracts(loader, api) {
  loader.m[15] = apiFactory;
  loader.m[306] = playingFactory;
  loader.c[306] = { exports: {} };
  loader.c[15] = { exports: { V: api.V, gi: api.Rh, di: api.Oh, Oh: api.zh, zg: api.xg } };
  loader.c[368] = { exports: { a: () => ({ lyricLines: [{ time: 0, lyric: 'line' }] }) } };
}
