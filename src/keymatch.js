// Match Ctrl key presses across standard and Kitty keyboard protocol encodings.
// Standard: Ctrl+B = 0x02 (single byte)
// Kitty:    Ctrl+B = \x1b[98;5u (CSI codepoint;modifiers u)

function isCtrlKey(buf, letter) {
  const code = letter.toLowerCase().charCodeAt(0) - 96; // a=1, b=2, ...

  // Standard encoding: single byte
  if (buf.length === 1 && buf[0] === code) return true;

  // Kitty keyboard protocol: \x1b[{codepoint};5u (5 = Ctrl modifier)
  const kitty = `\x1b[${letter.toLowerCase().charCodeAt(0)};5u`;
  if (buf.toString() === kitty) return true;

  return false;
}

module.exports = { isCtrlKey };
