const WORD_MASK = 0xffffffff;
const TEA_ROUND_COUNT = 32;
const TEA_DELTA = 0x9e3779b9;
const TEA_START_SUM_DEC = 0xc6ef3720;
const KEY_MIX_TEMPLATE = Buffer.from([
  0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xb7,
  0xd5, 0xd7, 0xe6, 0xe7,
  0xba, 0x3c, 0xa8, 0xd8,
  0x75, 0x47, 0x68, 0xcf,
  0x23, 0xe9, 0xfe, 0xaa
]);

function u32(value) {
  return value >>> 0;
}

function rotateRight32(value, shift) {
  return u32((value >>> shift) | (value << (32 - shift)));
}

function readWordArrayLE(buffer16) {
  return [
    buffer16.readUInt32LE(0),
    buffer16.readUInt32LE(4),
    buffer16.readUInt32LE(8),
    buffer16.readUInt32LE(12)
  ];
}

function writePairLE(left, right) {
  const out = Buffer.alloc(8);
  out.writeUInt32LE(u32(left), 0);
  out.writeUInt32LE(u32(right), 4);
  return out;
}

function teaRoundForward(state, keyWords, sum) {
  const leftMix = (((state.right << 4) + keyWords[0]) ^ (state.right + sum) ^ ((state.right >>> 5) + keyWords[1])) >>> 0;
  state.left = u32(state.left + leftMix);
  const rightMix = (((state.left << 4) + keyWords[2]) ^ (state.left + sum) ^ ((state.left >>> 5) + keyWords[3])) >>> 0;
  state.right = u32(state.right + rightMix);
}

function teaRoundBackward(state, keyWords, sum) {
  const rightMix = (((state.left << 4) + keyWords[2]) ^ (state.left + sum) ^ ((state.left >>> 5) + keyWords[3])) >>> 0;
  state.right = u32(state.right - rightMix);
  const leftMix = (((state.right << 4) + keyWords[0]) ^ (state.right + sum) ^ ((state.right >>> 5) + keyWords[1])) >>> 0;
  state.left = u32(state.left - leftMix);
}

class TEA {
  constructor() {
    this.key = Buffer.alloc(16);
  }

  encrypt(inputBlock) {
    const keys = readWordArrayLE(this.key);
    const state = {
      left: inputBlock.readUInt32LE(0),
      right: inputBlock.readUInt32LE(4)
    };

    let sum = 0;
    for (let i = 0; i < TEA_ROUND_COUNT; i++) {
      sum = u32(sum + TEA_DELTA);
      teaRoundForward(state, keys, sum);
    }

    return writePairLE(state.left, state.right);
  }

  decrypt(inputBlock) {
    const keys = readWordArrayLE(this.key);
    const state = {
      left: inputBlock.readUInt32LE(0),
      right: inputBlock.readUInt32LE(4)
    };

    let sum = TEA_START_SUM_DEC;
    for (let i = 0; i < TEA_ROUND_COUNT; i++) {
      teaRoundBackward(state, keys, sum);
      sum = u32(sum - TEA_DELTA);
    }

    return writePairLE(state.left, state.right);
  }
}

function runMixer(seed, rounds) {
  let accumulator = 0;
  for (let cursor = 0; cursor < rounds; cursor++) {
    const sourceWord = seed.readUInt32LE(cursor * 4);
    const blend = u32(rotateRight32(accumulator, 25) + rotateRight32(accumulator, 10));
    accumulator = u32(sourceWord + blend - accumulator);
  }
  return accumulator;
}

class CharCrypto {
  constructor() {
    this.cipher = new TEA();
  }

  genkey(uidHex) {
    const chunks = [];
    for (const rounds of [3, 4, 5, 6]) {
      chunks.push(this.scramble(uidHex, rounds));
    }
    return Buffer.from(chunks.join(''), 'hex');
  }

  encrypt(uidHex, characterId) {
    this.cipher.key = this.genkey(uidHex);
    const payload = Buffer.alloc(8);
    payload.writeUInt32LE(characterId, 0);
    payload.writeUInt32LE(characterId, 4);
    return this.cipher.encrypt(payload);
  }

  decrypt(uidHex, cipherText) {
    const payload = typeof cipherText === 'string' ? Buffer.from(cipherText, 'hex') : cipherText;
    this.cipher.key = this.genkey(uidHex);
    const plain = this.cipher.decrypt(payload);
    return plain.readUInt32LE(0);
  }

  scramble(uidHex, rounds) {
    const seed = Buffer.from(KEY_MIX_TEMPLATE);
    Buffer.from(uidHex, 'hex').copy(seed, 0);
    seed[(rounds * 4) - 1] = 0xaa;

    const mixed = runMixer(seed, rounds);
    const out = Buffer.alloc(4);
    out.writeUInt32LE(mixed, 0);
    return out.toString('hex');
  }
}

function PWDGen(uidHex) {
  const seed = Buffer.alloc(32, 0xff);
  seed[0] = 0x09;
  Buffer.from(uidHex, 'hex').copy(seed, 1);
  return runMixer(seed, 8);
}

class Burtle {
  constructor(seed = 0) {
    this.s = {
      a: 0xf1ea5eed,
      b: u32(seed),
      c: u32(seed),
      d: u32(seed)
    };

    for (let i = 0; i < 20; i++) {
      this.next();
    }
  }

  next() {
    const st = this.s;
    const e = u32(st.a - rotateRight32(st.b, 27));
    st.a = u32(st.b ^ rotateRight32(st.c, 17));
    st.b = u32(st.c + st.d);
    st.c = u32(st.d + e);
    st.d = u32(e + st.a);
    return st.d & WORD_MASK;
  }
}

module.exports = {
  TEA,
  CharCrypto,
  PWDGen,
  Burtle
};
