class LedCommandHandler {
  constructor({ getToyPad, askQuestion }) {
    this.getToyPad = getToyPad;
    this.askQuestion = askQuestion;
  }

  async runColorTest() {
    const toypad = this.getToyPad();
    console.log('\n🎨 Running LED color test...\n');

    try {
      console.log('  - All pads: RED');
      toypad.setColor(0, 255, 0, 0);
      await new Promise((r) => setTimeout(r, 2000));

      console.log('  - All pads: GREEN');
      toypad.setColor(0, 0, 255, 0);
      await new Promise((r) => setTimeout(r, 2000));

      console.log('  - All pads: BLUE');
      toypad.setColor(0, 0, 0, 255);
      await new Promise((r) => setTimeout(r, 2000));

      console.log('  - All pads: WHITE');
      toypad.setColor(0, 255, 255, 255);
      await new Promise((r) => setTimeout(r, 2000));

      console.log('  - All pads: OFF');
      toypad.setColor(0, 0, 0, 0);

      console.log('\n✅ Test complete!\n');
    } catch (err) {
      console.error('❌ Test failed:', err.message);
    }
  }

  async runIndividualPadTest() {
    const toypad = this.getToyPad();
    console.log('\n🎨 Testing individual pads...\n');

    try {
      console.log('  - Center pad: RED');
      toypad.setColor(1, 255, 0, 0);
      await new Promise((r) => setTimeout(r, 2000));

      console.log('  - Left pad: GREEN');
      toypad.setColor(2, 0, 255, 0);
      await new Promise((r) => setTimeout(r, 2000));

      console.log('  - Right pad: BLUE');
      toypad.setColor(3, 0, 0, 255);
      await new Promise((r) => setTimeout(r, 2000));

      console.log('  - All off');
      toypad.setColor(0, 0, 0, 0);

      console.log('\n✅ Test complete!\n');
    } catch (err) {
      console.error('❌ Test failed:', err.message);
    }
  }

  async customColor() {
    const toypad = this.getToyPad();
    const pad = parseInt(await this.askQuestion('Pad (0=all, 1=center, 2=left, 3=right): '), 10);
    const r = parseInt(await this.askQuestion('Red (0-255): '), 10);
    const g = parseInt(await this.askQuestion('Green (0-255): '), 10);
    const b = parseInt(await this.askQuestion('Blue (0-255): '), 10);

    toypad.setColor(pad, r, g, b);
    console.log(`✓ Set pad ${pad} to RGB(${r}, ${g}, ${b})\n`);
  }

  turnOff() {
    this.getToyPad().setColor(0, 0, 0, 0);
    console.log('✓ All LEDs off\n');
  }
}

module.exports = LedCommandHandler;
