function buildCommandCatalog({ ledCommands, tagCommands, tagState, getToyPad, printMenu }) {
  return {
    test: {
      description: 'Run full color test (all pads)',
      run: async () => ledCommands.runColorTest()
    },
    pads: {
      description: 'Test individual pads separately',
      run: async () => ledCommands.runIndividualPadTest()
    },
    color: {
      description: 'Set custom color',
      run: async () => ledCommands.customColor()
    },
    write: {
      description: 'Guided write to custom CENTER tag',
      run: async () => tagCommands.writeCustomTag()
    },
    reset: {
      description: 'Guided reset of custom CENTER gameplay pages',
      run: async () => tagCommands.resetCustomTag()
    },
    read: {
      description: 'Read and identify character/vehicle on tag',
      run: async () => tagCommands.readCharacter()
    },
    readall: {
      description: 'Read and identify all detected tags',
      run: async () => tagCommands.readAllTags()
    },
    readuid: {
      description: 'Read NFC tag UID from pages 0x00 & 0x01',
      run: async () => tagCommands.readTagUID()
    },
    rescan: {
      description: 'Force full scan of all known slot indices',
      run: async () => tagState.rescanActiveTags(getToyPad(), 'manual')
    },
    tags: {
      description: 'Show all currently detected tags by pad/index',
      run: async () => {
        console.log('');
        tagState.printActiveTagsSummary();
      }
    },
    off: {
      description: 'Turn all LEDs off',
      run: async () => ledCommands.turnOff()
    },
    help: {
      description: 'Show this menu',
      run: async () => printMenu()
    }
  };
}

module.exports = {
  buildCommandCatalog
};
