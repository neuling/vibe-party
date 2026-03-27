const WebSocket = require('ws');

let server;
const PORT = 9876;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendJSON(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function waitForBinaryMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(Buffer.from(data)));
  });
}

beforeAll(async () => {
  const { createServer } = require('../server/index.js');
  server = createServer(PORT, { rateLimitMax: 100 });
  await new Promise((resolve) => setTimeout(resolve, 100));
});

afterAll(async () => {
  await new Promise((resolve) => {
    if (server && server.close) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
});

describe('relay server', () => {
  test('first client gets room_created', async () => {
    const ws = await connect();
    const msgPromise = waitForMessage(ws);
    sendJSON(ws, { type: 'join', room_id: 'test-room-1' });
    const msg = await msgPromise;
    expect(msg.type).toBe('room_created');
    ws.close();
  });

  test('second client triggers peer_joined for both', async () => {
    const ws1 = await connect();
    const msg1Promise = waitForMessage(ws1);
    sendJSON(ws1, { type: 'join', room_id: 'room-2' });
    await msg1Promise; // room_created

    const ws2 = await connect();
    const peer1Promise = waitForMessage(ws1);
    const peer2Promise = waitForMessage(ws2);
    sendJSON(ws2, { type: 'join', room_id: 'room-2' });

    const [peerMsg1, peerMsg2] = await Promise.all([peer1Promise, peer2Promise]);
    expect(peerMsg1.type).toBe('peer_joined');
    expect(peerMsg2.type).toBe('peer_joined');

    ws1.close();
    ws2.close();
  });

  test('third client gets room_full', async () => {
    const ws1 = await connect();
    sendJSON(ws1, { type: 'join', room_id: 'room-3' });
    await waitForMessage(ws1);

    const ws2 = await connect();
    sendJSON(ws2, { type: 'join', room_id: 'room-3' });
    await waitForMessage(ws1); // peer_joined
    await waitForMessage(ws2); // peer_joined

    const ws3 = await connect();
    const msgPromise = waitForMessage(ws3);
    sendJSON(ws3, { type: 'join', room_id: 'room-3' });
    const msg = await msgPromise;
    expect(msg.type).toBe('room_full');

    ws1.close();
    ws2.close();
    ws3.close();
  });

  test('binary frames are forwarded to peer', async () => {
    const ws1 = await connect();
    sendJSON(ws1, { type: 'join', room_id: 'room-4' });
    await waitForMessage(ws1);

    const ws2 = await connect();
    sendJSON(ws2, { type: 'join', room_id: 'room-4' });
    await waitForMessage(ws1); // peer_joined
    await waitForMessage(ws2); // peer_joined

    const binaryPromise = waitForBinaryMessage(ws2);
    const testData = Buffer.from([0x01, 0x02, 0x03, 0xff]);
    ws1.send(testData);
    const received = await binaryPromise;
    expect(received.equals(testData)).toBe(true);

    ws1.close();
    ws2.close();
  });

  test('peer_left is sent when client disconnects', async () => {
    const ws1 = await connect();
    sendJSON(ws1, { type: 'join', room_id: 'room-5' });
    await waitForMessage(ws1);

    const ws2 = await connect();
    sendJSON(ws2, { type: 'join', room_id: 'room-5' });
    await waitForMessage(ws1); // peer_joined
    await waitForMessage(ws2); // peer_joined

    const leftPromise = waitForMessage(ws1);
    ws2.close();
    const msg = await leftPromise;
    expect(msg.type).toBe('peer_left');

    ws1.close();
  });
});
