class TagState {
  constructor({ getTagKey, getPadName, inferPadFromIndex, tryExtractUidFromPages, knownSlotIndices }) {
    this.getTagKey = getTagKey;
    this.getPadName = getPadName;
    this.inferPadFromIndex = inferPadFromIndex;
    this.tryExtractUidFromPages = tryExtractUidFromPages;
    this.knownSlotIndices = knownSlotIndices;

    this.activeTags = new Map();
    this.currentTagPad = null;
    this.currentTagIndex = null;
    this.currentTagUid = null;
    this.isRescanning = false;
    this.startupSyncPending = true;
  }

  selectFirstActiveTag() {
    const tags = this.getSortedTags();

    if (tags.length === 0) {
      this.currentTagPad = null;
      this.currentTagIndex = null;
      this.currentTagUid = null;
      return;
    }

    this.currentTagPad = tags[0].pad;
    this.currentTagIndex = tags[0].index;
    this.currentTagUid = tags[0].uid;
  }

  getCurrentTag() {
    if (!this.currentTagPad) {
      return null;
    }

    return {
      pad: this.currentTagPad,
      index: this.currentTagIndex,
      uid: this.currentTagUid
    };
  }

  getCenterTag() {
    for (const tag of this.activeTags.values()) {
      if (tag.pad === 1) {
        return tag;
      }
    }

    return null;
  }

  getSortedTags() {
    return Array.from(this.activeTags.values()).sort((a, b) => (a.pad - b.pad) || (a.index - b.index));
  }

  printActiveTagsSummary() {
    const counts = { 1: 0, 2: 0, 3: 0 };

    for (const tag of this.activeTags.values()) {
      counts[tag.pad] = (counts[tag.pad] || 0) + 1;
    }

    console.log(`   Active tags: CENTER=${counts[1] || 0}, LEFT=${counts[2] || 0}, RIGHT=${counts[3] || 0}`);

    if (this.activeTags.size === 0) {
      console.log('   (no active tags)\n');
      return;
    }

    for (const tag of this.activeTags.values()) {
      console.log(`   - ${this.getPadName(tag.pad)} [index ${tag.index}] UID=${tag.uid}`);
    }

    console.log('');
  }

  onTagAdded(tag) {
    this.activeTags.set(this.getTagKey(tag.pad, tag.index), tag);
    this.currentTagPad = tag.pad;
    this.currentTagIndex = tag.index;
    this.currentTagUid = tag.uid;
  }

  onTagRemoved(tag) {
    this.activeTags.delete(this.getTagKey(tag.pad, tag.index));

    if (this.currentTagPad === tag.pad && this.currentTagIndex === tag.index) {
      const fallback = this.activeTags.values().next().value;
      if (fallback) {
        this.currentTagPad = fallback.pad;
        this.currentTagIndex = fallback.index;
        this.currentTagUid = fallback.uid;
        return fallback;
      }

      this.currentTagPad = null;
      this.currentTagIndex = null;
      this.currentTagUid = null;
    }

    return null;
  }

  async rescanActiveTags(toypad, reason = 'manual') {
    if (this.isRescanning) {
      return;
    }

    this.isRescanning = true;

    try {
      console.log(`\n🔄 Running full slot scan (${reason})...`);
      const discoveredByIndex = new Map();

      for (const index of this.knownSlotIndices) {
        try {
          const page0 = await toypad.readTag(index, 0x00);
          const page1 = await toypad.readTag(index, 0x01);
          const uid = this.tryExtractUidFromPages(page0, page1);

          if (!uid) {
            continue;
          }

          discoveredByIndex.set(index, {
            pad: this.inferPadFromIndex(index),
            index,
            uid
          });
        } catch (_) {
          // Ignore unreadable/empty slots during sweep.
        }
      }

      if (discoveredByIndex.size > 0 || this.activeTags.size === 0) {
        this.activeTags.clear();
      }

      for (const tag of discoveredByIndex.values()) {
        this.activeTags.set(this.getTagKey(tag.pad, tag.index), tag);
      }

      this.selectFirstActiveTag();
      this.printActiveTagsSummary();
    } catch (err) {
      console.log(`⚠️  Full slot scan failed: ${err.message}`);
    } finally {
      this.isRescanning = false;
    }
  }
}

module.exports = TagState;
