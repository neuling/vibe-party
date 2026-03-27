const WebSocket = require('ws');
const { deriveKeys, encrypt, decrypt } = require('../src/crypto');
const { PACKET_TYPES, encode, decode } = require('../src/protocol');

let server;
const PORT = 9877;

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

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(data));
  });
}

describe('end-to-end encrypted session', () => {
  test('host sends encrypted terminal output, guest decrypts it', async () => {
    const sessionCode = 'alpha-bravo-charlie-1234';
    const { roomId, encryptionKey } = deriveKeys(sessionCode);

    const host = await connect();
    host.send(JSON.stringify({ type: 'join', room_id: roomId }));
    let msg = JSON.parse((await waitForMessage(host)).toString());
    expect(msg.type).toBe('room_created');

    const guest = await connect();
    guest.send(JSON.stringify({ type: 'join', room_id: roomId }));
    await waitForMessage(host);
    await waitForMessage(guest);

    const terminalData = Buffer.from('\x1b[32mHello from Claude!\x1b[0m');
    const { ciphertext, authTag, nonce } = encrypt(encryptionKey, terminalData, 0);
    const packet = encode(PACKET_TYPES.TERMINAL_OUTPUT, nonce, ciphertext, authTag);
    host.send(packet);

    const received = Buffer.from(await waitForMessage(guest));
    const decoded = decode(received);
    expect(decoded.type).toBe(PACKET_TYPES.TERMINAL_OUTPUT);
    const plaintext = decrypt(encryptionKey, decoded.nonce, decoded.ciphertext, decoded.authTag);
    expect(plaintext.equals(terminalData)).toBe(true);

    host.close();
    guest.close();
  });

  test('guest sends encrypted input, host decrypts it', async () => {
    const sessionCode = 'delta-echo-foxtrot-5678';
    const { roomId, encryptionKey } = deriveKeys(sessionCode);

    const host = await connect();
    host.send(JSON.stringify({ type: 'join', room_id: roomId }));
    await waitForMessage(host);

    const guest = await connect();
    guest.send(JSON.stringify({ type: 'join', room_id: roomId }));
    await waitForMessage(host);
    await waitForMessage(guest);

    const keystroke = Buffer.from('ls -la\n');
    const { ciphertext, authTag, nonce } = encrypt(encryptionKey, keystroke, 0);
    const packet = encode(PACKET_TYPES.TERMINAL_INPUT, nonce, ciphertext, authTag);
    guest.send(packet);

    const received = Buffer.from(await waitForMessage(host));
    const decoded = decode(received);
    expect(decoded.type).toBe(PACKET_TYPES.TERMINAL_INPUT);
    const plaintext = decrypt(encryptionKey, decoded.nonce, decoded.ciphertext, decoded.authTag);
    expect(plaintext.equals(keystroke)).toBe(true);

    host.close();
    guest.close();
  });

  test('wrong session code cannot decrypt', async () => {
    const hostKeys = deriveKeys('golf-hotel-india-9999');
    const guestKeys = deriveKeys('wrong-code-here-0000');

    const terminalData = Buffer.from('secret output');
    const { ciphertext, authTag, nonce } = encrypt(hostKeys.encryptionKey, terminalData, 0);

    expect(() => {
      decrypt(guestKeys.encryptionKey, nonce, ciphertext, authTag);
    }).toThrow();
  });

  test('resize packet carries terminal dimensions', async () => {
    const sessionCode = 'juliet-kilo-lima-3333';
    const { roomId, encryptionKey } = deriveKeys(sessionCode);

    const host = await connect();
    host.send(JSON.stringify({ type: 'join', room_id: roomId }));
    await waitForMessage(host);

    const guest = await connect();
    guest.send(JSON.stringify({ type: 'join', room_id: roomId }));
    await waitForMessage(host);
    await waitForMessage(guest);

    const dims = { cols: 120, rows: 40 };
    const payload = Buffer.from(JSON.stringify(dims));
    const { ciphertext, authTag, nonce } = encrypt(encryptionKey, payload, 0);
    const packet = encode(PACKET_TYPES.RESIZE, nonce, ciphertext, authTag);
    host.send(packet);

    const received = Buffer.from(await waitForMessage(guest));
    const decoded = decode(received);
    expect(decoded.type).toBe(PACKET_TYPES.RESIZE);
    const decrypted = JSON.parse(
      decrypt(encryptionKey, decoded.nonce, decoded.ciphertext, decoded.authTag).toString()
    );
    expect(decrypted).toEqual({ cols: 120, rows: 40 });

    host.close();
    guest.close();
  });
});
