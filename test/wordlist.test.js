const { generateCode, WORDS } = require('../src/wordlist');

describe('wordlist', () => {
  test('WORDS has at least 500 entries', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(500);
  });

  test('all words are lowercase alpha', () => {
    for (const word of WORDS) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });

  test('no duplicate words', () => {
    const unique = new Set(WORDS);
    expect(unique.size).toBe(WORDS.length);
  });
});

describe('generateCode', () => {
  test('returns format word-word-NNNN', () => {
    const code = generateCode();
    expect(code).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
  });

  test('all words come from WORDS list', () => {
    const code = generateCode();
    const parts = code.split('-');
    expect(WORDS).toContain(parts[0]);
    expect(WORDS).toContain(parts[1]);
  });

  test('digits are 0000-9999', () => {
    const code = generateCode();
    const digits = parseInt(code.split('-')[2], 10);
    expect(digits).toBeGreaterThanOrEqual(0);
    expect(digits).toBeLessThanOrEqual(9999);
  });

  test('generates different codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
