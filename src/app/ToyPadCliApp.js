const readline = require('readline');
const ToyPad = require('../../modern/ToyPad');
const { CharCrypto, PWDGen } = require('../../modern/crypto');
const characterMap = require('../../data/charactermap.json');
const tokenMap = require('../../data/tokenmap.json');

const TagState = require('../core/TagState');
const LedCommandHandler = require('../commands/LedCommandHandler');
const TagCommandHandler = require('../commands/TagCommandHandler');
const { runWriteProgress } = require('../utils/progress');
const {
  getTagKey,
  getPadName,
  inferPadFromIndex,
  tryExtractUidFromPages
} = require('../utils/tag-utils');
const { buildCommandCatalog } = require('./commandCatalog');
const { version } = require('../../package.json');

const KEEP_ALIVE_INTERVAL_MS = 30000;
const KNOWN_SLOT_INDICES = [0, 1, 2, 3, 4, 5, 6];

class ToyPadCliApp {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.toypad = null;
    this.crypto = new CharCrypto();

    this.tagState = new TagState({
      getTagKey,
      getPadName,
      inferPadFromIndex,
      tryExtractUidFromPages,
      knownSlotIndices: KNOWN_SLOT_INDICES
    });

    this.ledCommands = new LedCommandHandler({
      getToyPad: () => this.toypad,
      askQuestion: (question) => this.askQuestion(question)
    });

    this.tagCommands = new TagCommandHandler({
      getToyPad: () => this.toypad,
      tagState: this.tagState,
      characterMap,
      tokenMap,
      crypto: this.crypto,
      pwdGen: PWDGen,
      askQuestion: (question) => this.askQuestion(question),
      runWriteProgress,
      keepAliveIntervalMs: KEEP_ALIVE_INTERVAL_MS,
      getPadName,
      tryExtractUidFromPages
    });

    this.commands = buildCommandCatalog({
      ledCommands: this.ledCommands,
      tagCommands: this.tagCommands,
      tagState: this.tagState,
      getToyPad: () => this.toypad,
      printMenu: () => this.printMenu()
    });

    this.running = false;
    this.promptActive = false;

    process.on('SIGINT', () => {
      this.shutdown('SIGINT');
    });
  }

  printBanner() {
    console.log(`=== ToyPad Interactive Session v${version} ===\n`);
    console.log('This keeps the device connection alive and lets you run commands.');
    console.log('No more unplugging! Just keep this running.\n');
  }

  printMenu() {
    console.log('\n?? Available Commands:');

    const names = Object.keys(this.commands);
    for (const name of names) {
      const label = name.padEnd(7, ' ');
      console.log(`  ${label}- ${this.commands[name].description}`);
    }

    console.log('  quit   - Exit');
    console.log('');
  }

  askQuestion(question) {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => resolve(answer.trim()));
    });
  }

  async connect() {
    this.toypad = new ToyPad();

    console.log('Connecting to ToyPad...');
    await this.toypad.connect();
    console.log('? Connected!\n');

    this.toypad.enableKeepAlive(KEEP_ALIVE_INTERVAL_MS);
    this.attachTagEventHandlers();

    console.log('? Device ready! Keep-alive active (pings every 30s)\n');

    await new Promise((resolve) => setTimeout(resolve, 1200));
    await this.tagState.rescanActiveTags(this.toypad, 'startup');
    this.tagState.startupSyncPending = false;
  }

  attachTagEventHandlers() {
    this.toypad.on('tag-added', (tag) => {
      this.tagState.onTagAdded(tag);

      if (this.tagState.startupSyncPending) {
        return;
      }

      console.log(`\n???  Tag detected on ${getPadName(tag.pad)} pad!`);
      console.log(`   Index: ${tag.index}`);
      console.log(`   UID (auto-detected): ${tag.uid}\n`);
      this.tagState.printActiveTagsSummary();
      this.requestPromptRender();
    });

    this.toypad.on('tag-removed', (tag) => {
      const fallback = this.tagState.onTagRemoved(tag);

      if (this.tagState.startupSyncPending) {
        return;
      }

      console.log(`\n???  Tag removed from ${getPadName(tag.pad)} pad`);
      console.log(`   Index: ${tag.index}\n`);

      if (fallback) {
        console.log(`   Auto-selected remaining tag: ${getPadName(fallback.pad)} [index ${fallback.index}]\n`);
      }

      this.tagState.printActiveTagsSummary();
      this.requestPromptRender();
    });
  }

  async runCommand(input) {
    const cmd = input.trim().toLowerCase();

    if (!cmd) {
      return;
    }

    if (cmd === 'quit' || cmd === 'exit') {
      await this.shutdown('user-exit');
      return;
    }

    const command = this.commands[cmd];
    if (!command) {
      console.log(`? Unknown command: ${cmd}`);
      console.log('Type "help" for available commands\n');
      return;
    }

    try {
      await command.run();
    } catch (err) {
      console.error(`? Command failed: ${err.message}`);
    }
  }

  requestPromptRender() {
    if (!this.running || this.promptActive) {
      return;
    }

    this.loopPrompt();
  }

  loopPrompt() {
    if (!this.running) {
      return;
    }

    this.promptActive = true;
    this.rl.question('toypad> ', async (input) => {
      this.promptActive = false;
      await this.runCommand(input);

      if (this.running) {
        this.loopPrompt();
      }
    });
  }

  async shutdown(source = 'unknown') {
    if (!this.running && source !== 'SIGINT') {
      return;
    }

    this.running = false;
    console.log('\nShutting down...');

    try {
      if (this.toypad) {
        this.toypad.close();
      }
    } catch (_) {
      // Ignore close errors during shutdown.
    }

    try {
      this.rl.close();
    } catch (_) {
      // Ignore readline close races.
    }

    setTimeout(() => {
      console.log('? Stopped');
      process.exit(0);
    }, 400);
  }

  async start() {
    this.printBanner();

    try {
      await this.connect();
      this.running = true;
      this.printMenu();
      this.loopPrompt();
    } catch (err) {
      console.error('? Failed to connect:', err.message);
      console.error('Make sure:');
      console.error('  1. ToyPad is plugged in');
      console.error('  2. Running as Administrator');
      console.error('  3. No other processes are using the device');
      process.exit(1);
    }
  }
}

module.exports = ToyPadCliApp;
