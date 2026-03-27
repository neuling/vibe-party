const { PACKET_TYPES, encode, decode } = require('../src/protocol');

describe('PACKET_TYPES', () => {
  test('has all required types', () => {
    expect(PACKET_TYPES.TERMINAL_OUTPUT).toBe(0x01);
    expect(PACKET_TYPES.TERMINAL_INPUT).toBe(0x02);
    expect(PACKET_TYPES.RESIZE).toBe(0x03);
    expect(PACKET_TYPES.DRIVE_REQUEST).toBe(0x10);
    expect(PACKET_TYPES.DRIVE_GRANT).toBe(0x11);
    expect(PACKET_TYPES.DRIVE_RELEASE).toBe(0x12);
    expect(PACKET_TYPES.PING).toBe(0x20);
    expect(PACKET_TYPES.PONG).toBe(0x21);
  });
});

describe('encode / decode', () => {
  test('round-trip preserves all fields', () => {
    const type = PACKET_TYPES.TERMINAL_OUTPUT;
    const nonce = Buffer.alloc(12, 0xab);
    const ciphertext = Buffer.from('encrypted data here');
    const authTag = Buffer.alloc(16, 0xcd);

    const packet = encode(type, nonce, ciphertext, authTag);
    const decoded = decode(packet);

    expect(decoded.type).toBe(type);
    expect(decoded.nonce.equals(nonce)).toBe(true);
    expect(decoded.ciphertext.equals(ciphertext)).toBe(true);
    expect(decoded.authTag.equals(authTag)).toBe(true);
  });

  test('packet length is 1 + 12 + ciphertext.length + 16', () => {
    const ciphertext = Buffer.from('test');
    const packet = encode(0x01, Buffer.alloc(12), ciphertext, Buffer.alloc(16));
    expect(packet.length).toBe(1 + 12 + ciphertext.length + 16);
  });

  test('works with empty ciphertext', () => {
    const type = PACKET_TYPES.DRIVE_REQUEST;
    const nonce = Buffer.alloc(12);
    const ciphertext = Buffer.alloc(0);
    const authTag = Buffer.alloc(16);

    const packet = encode(type, nonce, ciphertext, authTag);
    const decoded = decode(packet);

    expect(decoded.type).toBe(type);
    expect(decoded.ciphertext.length).toBe(0);
  });

  test('different types are preserved', () => {
    for (const [name, type] of Object.entries(PACKET_TYPES)) {
      const packet = encode(type, Buffer.alloc(12), Buffer.from('x'), Buffer.alloc(16));
      const decoded = decode(packet);
      expect(decoded.type).toBe(type);
    }
  });
});
