const crypto = require('crypto');

function deriveKeys(sessionCode) {
  const salt = crypto.createHash('sha256').update(sessionCode).digest();
  const roomId = crypto.createHash('sha256')
    .update('room:' + sessionCode)
    .digest('hex')
    .slice(0, 16);
  const encryptionKey = crypto.pbkdf2Sync(sessionCode, salt, 100000, 32, 'sha512');
  return { roomId, encryptionKey };
}

function encrypt(key, plaintext, nonceCounter) {
  const nonce = Buffer.alloc(12);
  nonce.writeUIntBE(nonceCounter, 6, 6);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, authTag, nonce };
}

function decrypt(key, nonce, ciphertext, authTag) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { deriveKeys, encrypt, decrypt };
