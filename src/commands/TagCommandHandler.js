class TagCommandHandler {
  constructor({
    getToyPad,
    tagState,
    characterMap,
    tokenMap,
    crypto,
    pwdGen,
    askQuestion,
    runWriteProgress,
    keepAliveIntervalMs,
    getPadName,
    tryExtractUidFromPages
  }) {
    this.getToyPad = getToyPad;
    this.tagState = tagState;
    this.characterMap = characterMap;
    this.tokenMap = tokenMap;
    this.crypto = crypto;
    this.pwdGen = pwdGen;
    this.askQuestion = askQuestion;
    this.runWriteProgress = runWriteProgress;
    this.keepAliveIntervalMs = keepAliveIntervalMs;
    this.getPadName = getPadName;
    this.tryExtractUidFromPages = tryExtractUidFromPages;
  }

  async writePageForTagWithCenterFallback(tag, page, data) {
    const toypad = this.getToyPad();

    try {
      return await toypad.writeTag(tag.index, page, data);
    } catch (err) {
      const isF2 = err && err.message && /0xf2/i.test(err.message);
      const isCenterPad = tag.pad === 1;
      const canTryCenterFallback = isCenterPad && tag.index !== 1;

      if (!isF2 || !canTryCenterFallback) {
        throw err;
      }

      console.log(`  ℹ️  Write returned 0xF2 on index ${tag.index}, retrying page 0x${page.toString(16).toUpperCase().padStart(2, '0')} with CENTER slot 1...`);
      return await toypad.writeTag(1, page, data);
    }
  }

  async withKeepAlivePaused(fn, label) {
    const toypad = this.getToyPad();
    const wasKeepAliveEnabled = !!(toypad && toypad.keepAliveEnabled);

    if (wasKeepAliveEnabled) {
      toypad.disableKeepAlive();
      console.log(`  ⏸️  Keep-alive paused during ${label}.`);
    }

    try {
      await fn();
    } finally {
      if (wasKeepAliveEnabled) {
        toypad.enableKeepAlive(this.keepAliveIntervalMs);
        console.log('  ▶️  Keep-alive resumed.\n');
      }
    }
  }

  async configurePasswordModeForTag(tagIndex, passwordBytes) {
    const toypad = this.getToyPad();

    if (!toypad || typeof toypad.setPasswordMode !== 'function') {
      return;
    }

    const zeroPwd = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const isZeroPassword = Buffer.isBuffer(passwordBytes) && passwordBytes.length === 4 && passwordBytes.equals(zeroPwd);

    if (isZeroPassword) {
      await toypad.setPasswordMode(tagIndex, 0);
      console.log('  ✅ ToyPad auth mode set to disable password (type 0) for blank-tag bootstrap.');
      return;
    }

    await toypad.setPasswordMode(tagIndex, 1);
    console.log('  ✅ ToyPad auth mode set to default UID password mode.');
  }

  async writeCustomTag() {
    const toypad = this.getToyPad();
    const centerTag = this.tagState.getCenterTag();

    if (!centerTag) {
      console.log('❌ No tag detected on CENTER pad. Place one custom NFC tag on center and try again.\n');
      return;
    }

    console.log('\n🛠️  Guided Write: Custom NFC Tag (CENTER pad only)\n');
    console.log(`  Selected Tag: CENTER [index ${centerTag.index}] UID=${centerTag.uid}`);
    console.log('  This will write token data to pages 0x24 and 0x25.\n');

    try {
      await this.withKeepAlivePaused(async () => {
        const page43Block = await toypad.readTag(centerTag.index, 0x2B);
        const page38Block = await toypad.readTag(centerTag.index, 0x26);

        const pwd = page43Block.slice(0, 4);
        const pwdHex = pwd.toString('hex').toUpperCase();
        const pwdIsZero = pwd.equals(Buffer.from([0x00, 0x00, 0x00, 0x00]));

        console.log(`  Password page (0x2B): ${pwdHex}`);

        if (!pwdIsZero) {
          console.log('❌ This tag appears to have a non-zero password and is not treated as blank/custom by this flow.');
          console.log('   Use a blank custom NFC tag (password page 00000000).\n');
          return;
        }

        console.log('  ✅ Tag password check passed (no password).');

        try {
          await this.configurePasswordModeForTag(centerTag.index, pwd);
        } catch (err) {
          console.log(`  ⚠️  Could not configure ToyPad password mode: ${err.message}`);
          console.log('  ℹ️  Continuing with direct write attempts.');
        }

        const probeData = page38Block.slice(0, 4);
        await this.writePageForTagWithCenterFallback(centerTag, 0x26, probeData);
        const verifyBlock = await toypad.readTag(centerTag.index, 0x26);
        const verifyData = verifyBlock.slice(0, 4);

        if (!verifyData.equals(probeData)) {
          console.log('❌ Writable check failed: page verify mismatch after probe write.\n');
          return;
        }

        console.log('  ✅ Writable check passed.\n');

        const proceed = (await this.askQuestion('Proceed with writing this CENTER tag? Type YES to continue: ')).toUpperCase();
        if (proceed !== 'YES') {
          console.log('❎ Write cancelled by user.\n');
          return;
        }

        let tokenType = (await this.askQuestion('Type to write (`character` or `vehicle`): ')).toLowerCase();
        if (tokenType === 'gadget') {
          tokenType = 'vehicle';
        }

        if (tokenType !== 'character' && tokenType !== 'vehicle') {
          console.log('❌ Invalid type. Please choose `character` or `vehicle`.\n');
          return;
        }

        const idInput = await this.askQuestion(`Enter ${tokenType} ID: `);
        const selectedId = Number.parseInt(idInput, 10);
        if (!Number.isInteger(selectedId)) {
          console.log('❌ Invalid ID. Must be a number.\n');
          return;
        }

        let selectedEntry = null;
        let page36 = null;
        let page37 = null;

        if (tokenType === 'character') {
          selectedEntry = this.characterMap.find((item) => item.id === selectedId);
          if (!selectedEntry) {
            console.log(`❌ Character ID ${selectedId} not found in charactermap.\n`);
            return;
          }

          const encrypted = this.crypto.encrypt(centerTag.uid, selectedId);
          page36 = encrypted.slice(0, 4);
          page37 = encrypted.slice(4, 8);
        } else {
          selectedEntry = this.tokenMap.find((item) => item.id === selectedId);
          if (!selectedEntry) {
            console.log(`❌ Vehicle/Gadget ID ${selectedId} not found in tokenmap.\n`);
            return;
          }

          page36 = Buffer.alloc(4);
          page36.writeUInt32LE(selectedId, 0);
          page37 = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        }

        console.log('\n  Write Selection Summary');
        console.log('  ───────────────────────────────────');
        console.log(`  Tag UID:      ${centerTag.uid}`);
        console.log(`  Tag Slot:     CENTER [index ${centerTag.index}]`);
        console.log(`  Type:         ${tokenType}`);
        console.log(`  ID:           ${selectedId}`);
        console.log(`  Name:         ${selectedEntry.name || '(unknown)'}`);
        console.log(`  Page 0x24:    ${page36.toString('hex').toUpperCase()}`);
        console.log(`  Page 0x25:    ${page37.toString('hex').toUpperCase()}`);

        const finalConfirm = (await this.askQuestion('\nType WRITE to start writing: ')).toUpperCase();
        if (finalConfirm !== 'WRITE') {
          console.log('❎ Write cancelled by user.\n');
          return;
        }

        console.log('\n🚧 Writing tag... do not remove the tag from CENTER pad.');

        await this.runWriteProgress('Writing', 1400);
        await this.writePageForTagWithCenterFallback(centerTag, 0x24, page36);
        await this.runWriteProgress('Verifying', 900);
        await this.writePageForTagWithCenterFallback(centerTag, 0x25, page37);

        const verify36Block = await toypad.readTag(centerTag.index, 0x24);
        const verify37Block = await toypad.readTag(centerTag.index, 0x25);
        const verify36 = verify36Block.slice(0, 4);
        const verify37 = verify37Block.slice(0, 4);

        if (verify36.equals(page36) && verify37.equals(page37)) {
          console.log('\n✅ WRITE SUCCESSFUL!');
          console.log('  Tag data verified on pages 0x24 and 0x25.\n');
        } else {
          console.log('\n❌ WRITE FAILED: verification mismatch.');
          console.log(`  Expected 0x24: ${page36.toString('hex').toUpperCase()}  Got: ${verify36.toString('hex').toUpperCase()}`);
          console.log(`  Expected 0x25: ${page37.toString('hex').toUpperCase()}  Got: ${verify37.toString('hex').toUpperCase()}\n`);
        }
      }, 'write');
    } catch (err) {
      console.log(`\n❌ WRITE FAILED: ${err.message}\n`);
    }
  }

  async resetCustomTag() {
    const toypad = this.getToyPad();
    const centerTag = this.tagState.getCenterTag();

    if (!centerTag) {
      console.log('❌ No tag detected on CENTER pad. Place one custom NFC tag on center and try again.\n');
      return;
    }

    console.log('\n♻️  Guided Reset: Custom NFC Tag (CENTER pad only)\n');
    console.log(`  Selected Tag: CENTER [index ${centerTag.index}] UID=${centerTag.uid}`);
    console.log('  This resets gameplay pages to 00000000.\n');

    try {
      await this.withKeepAlivePaused(async () => {
        const page24 = (await toypad.readTag(centerTag.index, 0x24)).slice(0, 4);
        const page25 = (await toypad.readTag(centerTag.index, 0x25)).slice(0, 4);
        const page26 = (await toypad.readTag(centerTag.index, 0x26)).slice(0, 4);
        const page2B = (await toypad.readTag(centerTag.index, 0x2B)).slice(0, 4);

        try {
          await this.configurePasswordModeForTag(centerTag.index, page2B);
        } catch (err) {
          console.log(`  ⚠️  Could not configure ToyPad password mode: ${err.message}`);
          console.log('  ℹ️  Continuing with direct reset attempts.');
        }

        console.log('  Current Values');
        console.log('  ───────────────────────────────────');
        console.log(`  Page 0x24: ${page24.toString('hex').toUpperCase()}`);
        console.log(`  Page 0x25: ${page25.toString('hex').toUpperCase()}`);
        console.log(`  Page 0x26: ${page26.toString('hex').toUpperCase()}`);
        console.log(`  Page 0x2B: ${page2B.toString('hex').toUpperCase()} (password page)`);

        const firstConfirm = (await this.askQuestion('\nType RESET to continue: ')).toUpperCase();
        if (firstConfirm !== 'RESET') {
          console.log('❎ Reset cancelled by user.\n');
          return;
        }

        const clearPasswordAnswer = (await this.askQuestion('Also clear password page 0x2B to 00000000? (yes/no): ')).toLowerCase();
        const clearPasswordPage = clearPasswordAnswer === 'yes' || clearPasswordAnswer === 'y';

        const gameplayPages = [0x24, 0x25, 0x26];
        const pagesToReset = [...gameplayPages];
        if (clearPasswordPage) {
          if (page2B.equals(Buffer.from([0x00, 0x00, 0x00, 0x00]))) {
            console.log('  ℹ️  Skipping page 0x2B write (already 00000000).');
          } else {
            pagesToReset.push(0x2B);
          }
        }

        const finalConfirm = (await this.askQuestion('Final confirmation: type ERASE to execute reset: ')).toUpperCase();
        if (finalConfirm !== 'ERASE') {
          console.log('❎ Reset cancelled by user.\n');
          return;
        }

        console.log('\n🚧 Resetting pages... do not remove the tag from CENTER pad.');
        await this.runWriteProgress('Resetting', 1400);

        const zero = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        const writeFailures = [];
        for (const page of pagesToReset) {
          try {
            await this.writePageForTagWithCenterFallback(centerTag, page, zero);
          } catch (err) {
            writeFailures.push({ page, message: err.message });
          }
        }

        await this.runWriteProgress('Verifying', 900);
        const verifyFailures = [];

        for (const page of pagesToReset) {
          const readBack = (await toypad.readTag(centerTag.index, page)).slice(0, 4);
          if (!readBack.equals(zero)) {
            verifyFailures.push({ page, readBack });
          }
        }

        const gameplayWriteFailures = writeFailures.filter((f) => gameplayPages.includes(f.page));
        const gameplayVerifyFailures = verifyFailures.filter((f) => gameplayPages.includes(f.page));
        const optionalWriteFailures = writeFailures.filter((f) => f.page === 0x2b);
        const optionalVerifyFailures = verifyFailures.filter((f) => f.page === 0x2b);

        const gameplayResetSucceeded = gameplayWriteFailures.length === 0 && gameplayVerifyFailures.length === 0;
        const optionalPasswordIssue = optionalWriteFailures.length > 0 || optionalVerifyFailures.length > 0;

        if (gameplayResetSucceeded && !optionalPasswordIssue) {
          console.log('\n✅ RESET SUCCESSFUL!');
          console.log(`  Reset pages: ${pagesToReset.map((p) => `0x${p.toString(16).toUpperCase()}`).join(', ')}`);
          console.log('  All reset pages verify as 00000000.\n');
        } else if (gameplayResetSucceeded && optionalPasswordIssue) {
          console.log('\n⚠️  RESET PARTIAL: gameplay pages were reset, but password page had an issue.');
          console.log(`  Reset gameplay pages: ${gameplayPages.map((p) => `0x${p.toString(16).toUpperCase()}`).join(', ')}`);
          for (const failure of optionalWriteFailures) {
            console.log(`  Page 0x${failure.page.toString(16).toUpperCase()} write error: ${failure.message}`);
          }
          for (const failure of optionalVerifyFailures) {
            console.log(`  Page 0x${failure.page.toString(16).toUpperCase()} verify value: ${failure.readBack.toString('hex').toUpperCase()}`);
          }
          console.log('  Tag gameplay data is cleared; password page may be locked or protected.\n');
        } else {
          console.log('\n❌ RESET FAILED: verification mismatch on one or more pages.');
          for (const failure of writeFailures) {
            console.log(`  Page 0x${failure.page.toString(16).toUpperCase()} write error: ${failure.message}`);
          }
          for (const failure of verifyFailures) {
            console.log(`  Page 0x${failure.page.toString(16).toUpperCase()}: got ${failure.readBack.toString('hex').toUpperCase()}`);
          }
          console.log('');
        }
      }, 'reset');
    } catch (err) {
      console.log(`\n❌ RESET FAILED: ${err.message}\n`);
    }
  }

  async readTagUID() {
    const toypad = this.getToyPad();
    const currentTag = this.tagState.getCurrentTag();

    if (!currentTag) {
      console.log('❌ No tag detected! Place a tag on any pad first.\n');
      return;
    }

    console.log('\n📖 Reading NFC tag UID...\n');

    try {
      const candidateIndices = [currentTag.index];
      if (currentTag.pad === 1 && currentTag.index !== 1) {
        candidateIndices.push(1);
      }

      let best = null;
      let hadReadFailure = false;

      for (const index of candidateIndices) {
        try {
          console.log(`  Reading Page 0 (0x00) from index ${index}...`);
          const page0 = await toypad.readTag(index, 0x00);
          const line1 = page0.slice(0, 4).toString('hex').toUpperCase();
          console.log(`  Line 1 (0x00): ${line1}`);

          console.log(`  Reading Page 1 (0x01) from index ${index}...`);
          const page1 = await toypad.readTag(index, 0x01);
          const line2 = page1.slice(0, 4).toString('hex').toUpperCase();
          console.log(`  Line 2 (0x01): ${line2}`);

          const parsedUid = this.tryExtractUidFromPages(page0.slice(0, 4), page1.slice(0, 4));
          const fallbackUid = page0.slice(0, 3).toString('hex').toUpperCase() + page1.slice(0, 4).toString('hex').toUpperCase();

          if (parsedUid) {
            best = {
              uid: parsedUid,
              index,
              trusted: true
            };
            break;
          }

          if (!best) {
            best = {
              uid: fallbackUid,
              index,
              trusted: false
            };
          }

          console.log('  ℹ️  UID validation failed for this index (BCC mismatch or empty read).');
          if (candidateIndices.length > 1 && index !== candidateIndices[candidateIndices.length - 1]) {
            console.log('  ℹ️  Trying center fallback index...');
          }
        } catch (err) {
          hadReadFailure = true;
          console.log(`  ⚠️  UID page read failed on index ${index}: ${err.message}`);
          if (candidateIndices.length > 1 && index !== candidateIndices[candidateIndices.length - 1]) {
            console.log('  ℹ️  Trying center fallback index...');
          }
        }
      }

      const fullUID = best ? best.uid : 'UNKNOWN';

      console.log(`\n  📌 Full UID: ${fullUID}`);
      console.log(`  📌 Auto-detected UID: ${currentTag.uid}`);
      if (best) {
        console.log(`  📌 UID read index: ${best.index}`);
      } else {
        console.log('  📌 UID read index: (none)');
      }

      if (fullUID === currentTag.uid) {
        console.log('  ✅ UIDs match!\n');
      } else if (best && !best.trusted) {
        console.log('  ⚠️  UID pages appear unreadable/invalid for current slot mapping. Auto-detected UID is likely correct.\n');
      } else if (hadReadFailure && currentTag.uid) {
        console.log('  ⚠️  Could not read UID pages from tag memory. Using auto-detected UID from tag event.\n');
      } else {
        console.log('  ℹ️  Note: UIDs appear different due to format variations\n');
      }
    } catch (err) {
      console.error('❌ Read failed:', err.message);
    }
  }

  async readCharacter() {
    const currentTag = this.tagState.getCurrentTag();

    if (!currentTag) {
      console.log('❌ No tag detected! Place a tag on any pad first.\n');
      return;
    }

    await this.readTagDetails(currentTag);
  }

  async readTagDetails(tag) {
    const toypad = this.getToyPad();
    console.log(`\n🔍 Reading tag data for ${this.getPadName(tag.pad)} [index ${tag.index}]...\n`);

    try {
      console.log('  Reading pages 35-38 and 43...');
      const page43 = await toypad.readTag(tag.index, 0x2B);

      try {
        await this.configurePasswordModeForTag(tag.index, page43.slice(0, 4));
      } catch (err) {
        console.log(`  ⚠️  Could not configure ToyPad password mode: ${err.message}`);
      }

      const page35 = await toypad.readTag(tag.index, 0x23);
      const page36 = await toypad.readTag(tag.index, 0x24);
      const page37 = await toypad.readTag(tag.index, 0x25);
      const page38 = await toypad.readTag(tag.index, 0x26);

      console.log(`\n  UID: ${tag.uid}`);
      console.log(`  Line 35 (0x23): ${page35.slice(0, 4).toString('hex').toUpperCase()}`);
      console.log(`  Line 36 (0x24): ${page36.slice(0, 4).toString('hex').toUpperCase()}`);
      console.log(`  Line 37 (0x25): ${page37.slice(0, 4).toString('hex').toUpperCase()}`);
      console.log(`  Line 38 (0x26): ${page38.slice(0, 4).toString('hex').toUpperCase()}`);
      console.log(`  Line 43 (0x2B): ${page43.slice(0, 4).toString('hex').toUpperCase()}`);

      const encryptedData = Buffer.concat([page36.slice(0, 4), page37.slice(0, 4)]);
      const rawTokenId = page36.slice(0, 4).readUInt32LE(0);
      console.log(`\n  🔒 Encrypted Data: ${encryptedData.toString('hex').toUpperCase()}`);
      console.log(`  🧩 Raw Page36 ID: ${rawTokenId}`);

      console.log('\n  🔓 Attempting to decrypt...');

      let foundCharacter = null;
      const foundToken = this.tokenMap.find((token) => token.id === rawTokenId);

      if (!foundToken) {
        for (const char of this.characterMap) {
          const expectedEncrypted = this.crypto.encrypt(tag.uid, char.id);
          if (encryptedData.equals(expectedEncrypted)) {
            foundCharacter = char;
            break;
          }
        }
      }

      if (foundToken) {
        console.log('  ✅ VEHICLE/GADGET IDENTIFIED!');
        console.log('  ═══════════════════════════════════════');
        console.log(`  🚗 Name:     ${foundToken.name}`);
        console.log(`  🆔 ID:       ${foundToken.id}`);
        console.log('  📦 Type:     Vehicle/Gadget');
        console.log(`  🔧 Rebuild:  ${foundToken.rebuild}`);
        console.log('  ═══════════════════════════════════════');

        const expectedPassword = this.pwdGen(tag.uid);
        const storedPassword = page43.slice(0, 4).readUInt32LE(0);
        console.log(`\n  🔑 Password: ${storedPassword.toString(16).toUpperCase().padStart(8, '0')}`);
        console.log(`  🔑 Expected: ${expectedPassword.toString(16).toUpperCase().padStart(8, '0')}`);

        if (storedPassword === expectedPassword) {
          console.log('  ✅ Password matches!\n');
        } else {
          console.log('  ⚠️  Password mismatch (may be custom or blank tag)\n');
        }
      } else if (foundCharacter) {
        console.log('  ✅ CHARACTER IDENTIFIED!');
        console.log('  ═══════════════════════════════════════');
        console.log(`  🎮 Name:     ${foundCharacter.name}`);
        console.log(`  🌍 World:    ${foundCharacter.world}`);
        console.log(`  🆔 ID:       ${foundCharacter.id}`);
        console.log(`  📦 Type:     ${foundCharacter.type || 'Character'}`);
        console.log('  ═══════════════════════════════════════');

        const expectedPassword = this.pwdGen(tag.uid);
        const storedPassword = page43.slice(0, 4).readUInt32LE(0);
        console.log(`\n  🔑 Password: ${storedPassword.toString(16).toUpperCase().padStart(8, '0')}`);
        console.log(`  🔑 Expected: ${expectedPassword.toString(16).toUpperCase().padStart(8, '0')}`);

        if (storedPassword === expectedPassword) {
          console.log('  ✅ Password matches!\n');
        } else {
          console.log('  ⚠️  Password mismatch (may be custom or blank tag)\n');
        }
      } else {
        console.log('  ℹ️  Tag data not found in known character/vehicle databases');
        console.log('  This may be:');
        console.log('    - A blank/unwritten tag');
        console.log('    - A vehicle/gadget with an unknown token ID');
        console.log('    - Custom data written to the tag\n');
      }
    } catch (err) {
      console.error(`❌ Read failed for ${this.getPadName(tag.pad)} [index ${tag.index}]:`, err.message);
    }
  }

  async readAllTags() {
    if (this.tagState.activeTags.size === 0) {
      console.log('❌ No tags detected! Place tags on the pads first.\n');
      return;
    }

    const tags = this.tagState.getSortedTags();
    console.log(`\n📚 Reading all active tags (${tags.length})...`);

    for (const tag of tags) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      await this.readTagDetails(tag);
    }

    console.log('✅ Finished reading all active tags.\n');
  }
}

module.exports = TagCommandHandler;
