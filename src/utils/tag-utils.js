function getTagKey(pad, index) {
  return `${pad}:${index}`;
}

function getPadName(pad) {
  const padNames = ['', 'CENTER', 'LEFT', 'RIGHT'];
  return padNames[pad] || `PAD-${pad}`;
}

function inferPadFromIndex(index) {
  if (index === 0) return 1;
  if (index >= 1 && index <= 3) return 2;
  if (index >= 4 && index <= 6) return 3;
  return 0;
}

function tryExtractUidFromPages(page0, page1) {
  if (!page0 || !page1 || page0.length < 4 || page1.length < 4) {
    return null;
  }

  const uid0 = page0[0];
  const uid1 = page0[1];
  const uid2 = page0[2];
  const bcc0 = page0[3];
  const expectedBcc0 = (uid0 ^ uid1 ^ uid2 ^ 0x88) & 0xff;

  if (bcc0 !== expectedBcc0) {
    return null;
  }

  const uid = Buffer.concat([page0.slice(0, 3), page1.slice(0, 4)]).toString('hex').toUpperCase();
  if (!uid || /^0+$/.test(uid)) {
    return null;
  }

  return uid;
}

module.exports = {
  getTagKey,
  getPadName,
  inferPadFromIndex,
  tryExtractUidFromPages
};
