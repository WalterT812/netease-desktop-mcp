import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEndpoint, Cdp } from '../src/cdp.mjs';
import { parseInspection } from '../src/windows.mjs';
import { WebSocketServer } from 'ws';

async function socketFixture(t, handler) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { for (const client of server.clients) client.terminate(); server.close(); });
  server.on('connection', socket => socket.on('message', data => handler(socket, JSON.parse(data))));
  const port = server.address().port;
  const cdp = await Cdp.connect(`ws://127.0.0.1:${port}/devtools/page/fixture`, port, 500);
  t.after(() => cdp.disconnect());
  return cdp;
}

test('CDP correlates responses and disconnect never sends Browser.close', async t => {
  const methods = [];
  const cdp = await socketFixture(t, (socket, request) => {
    methods.push(request.method);
    socket.send(JSON.stringify({ id: request.id, result: { result: { value: { known: true } } } }));
  });
  assert.deepEqual(await cdp.evaluate(() => ({ known: true }), { action: 'status' }), { known: true });
  cdp.disconnect();
  assert.deepEqual(methods, ['Runtime.evaluate']);
});
test('CDP timeout does not silently resend mutations', async t => {
  let received = 0;
  const cdp = await socketFixture(t, () => { received++; });
  await assert.rejects(cdp.send('Input.dispatchKeyEvent', { key: 'Enter' }), /CDP_TIMEOUT/);
  assert.equal(received, 1);
});
test('CDP connection loss rejects outstanding calls', async t => {
  const cdp = await socketFixture(t, socket => socket.close());
  await assert.rejects(cdp.send('Runtime.evaluate'), /CDP_DISCONNECTED/);
});

test('only the expected loopback CDP websocket endpoint is accepted', () => {
  assert.equal(validateEndpoint('ws://127.0.0.1:9229/devtools/page/example', 9229).host, '127.0.0.1:9229');
  for (const address of ['ws://example.com:9229/devtools/page/x', 'ws://127.0.0.1:9230/devtools/page/x', 'ws://user:pass@127.0.0.1:9229/devtools/page/x', 'ws://127.0.0.1:9229/other']) {
    assert.throws(() => validateEndpoint(address, 9229), /UNSAFE_ENDPOINT/);
  }
});
test('Windows ownership validation rejects wildcard listening', () => {
  assert.throws(() => parseInspection({ processId: 123, expectedPath: 'C:\\Music\\cloudmusic.exe', actualPath: 'C:\\Music\\cloudmusic.exe', addresses: ['0.0.0.0'] }), /NON_LOOPBACK/);
});
test('Windows ownership validation rejects another executable', () => {
  assert.throws(() => parseInspection({ processId: 123, expectedPath: 'C:\\Music\\cloudmusic.exe', actualPath: 'C:\\Other\\app.exe', addresses: ['127.0.0.1'] }), /WRONG_PROCESS/);
});
test('Windows path comparison is case insensitive', () => {
  assert.equal(parseInspection({ processId: 123, expectedPath: 'C:\\Music\\cloudmusic.exe', actualPath: 'c:\\music\\cloudmusic.exe', addresses: ['127.0.0.1'] }).processId, 123);
});
