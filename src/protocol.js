const PACKET_TYPES = {
  TERMINAL_OUTPUT: 0x01,
  TERMINAL_INPUT: 0x02,
  RESIZE: 0x03,
  CHAT: 0x04,
  DRIVE_REQUEST: 0x10,
  DRIVE_GRANT: 0x11,
  DRIVE_RELEASE: 0x12,
  PING: 0x20,
  PONG: 0x21,
};

function encode(type, nonce, ciphertext, authTag) {
  const packet = Buffer.alloc(1 + 12 + ciphertext.length + 16);
  packet.writeUInt8(type, 0);
  nonce.copy(packet, 1);
  ciphertext.copy(packet, 13);
  authTag.copy(packet, 13 + ciphertext.length);
  return packet;
}

function decode(packet) {
  const type = packet.readUInt8(0);
  const nonce = packet.slice(1, 13);
  const ciphertextEnd = packet.length - 16;
  const ciphertext = packet.slice(13, ciphertextEnd);
  const authTag = packet.slice(ciphertextEnd);
  return { type, nonce, ciphertext, authTag };
}

module.exports = { PACKET_TYPES, encode, decode };
