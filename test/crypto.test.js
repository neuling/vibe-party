const { deriveKeys, encrypt, decrypt } = require('../src/crypto');

describe('deriveKeys', () => {
  test('returns roomId and encryptionKey', () => {
    const keys = deriveKeys('tiger-piano-sunset-4821');
    expect(keys).toHaveProperty('roomId');
    expect(keys).toHaveProperty('encryptionKey');
  });

  test('roomId is 16-char hex string', () => {
    const { roomId } = deriveKeys('tiger-piano-sunset-4821');
    expect(roomId).toMatch(/^[0-9a-f]{16}$/);
  });

  test('encryptionKey is 32-byte Buffer', () => {
    const { encryptionKey } = deriveKeys('tiger-piano-sunset-4821');
    expect(Buffer.isBuffer(encryptionKey)).toBe(true);
    expect(encryptionKey.length).toBe(32);
  });

  test('same input produces same output', () => {
    const a = deriveKeys('tiger-piano-sunset-4821');
    const b = deriveKeys('tiger-piano-sunset-4821');
    expect(a.roomId).toBe(b.roomId);
    expect(a.encryptionKey.equals(b.encryptionKey)).toBe(true);
  });

  test('different input produces different output', () => {
    const a = deriveKeys('tiger-piano-sunset-4821');
    const b = deriveKeys('eagle-drum-river-1234');
    expect(a.roomId).not.toBe(b.roomId);
    expect(a.encryptionKey.equals(b.encryptionKey)).toBe(false);
  });
});

describe('encrypt / decrypt', () => {
  const { encryptionKey } = deriveKeys('test-code-here-1234');

  test('round-trip returns original plaintext', () => {
    const plaintext = Buffer.from('Hello, world!');
    const { ciphertext, authTag, nonce } = encrypt(encryptionKey, plaintext, 1);
    const decrypted = decrypt(encryptionKey, nonce, ciphertext, authTag);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  test('different nonces produce different ciphertext', () => {
    const plaintext = Buffer.from('same data');
    const a = encrypt(encryptionKey, plaintext, 1);
    const b = encrypt(encryptionKey, plaintext, 2);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  test('wrong key fails to decrypt', () => {
    const otherKey = deriveKeys('other-code-here-5678').encryptionKey;
    const plaintext = Buffer.from('secret');
    const { ciphertext, authTag, nonce } = encrypt(encryptionKey, plaintext, 1);
    expect(() => decrypt(otherKey, nonce, ciphertext, authTag)).toThrow();
  });

  test('tampered ciphertext fails to decrypt', () => {
    const plaintext = Buffer.from('secret');
    const { ciphertext, authTag, nonce } = encrypt(encryptionKey, plaintext, 1);
    ciphertext[0] ^= 0xff;
    expect(() => decrypt(encryptionKey, nonce, ciphertext, authTag)).toThrow();
  });

  test('nonce buffer is 12 bytes', () => {
    const plaintext = Buffer.from('test');
    const { nonce } = encrypt(encryptionKey, plaintext, 1);
    expect(nonce.length).toBe(12);
  });
});
