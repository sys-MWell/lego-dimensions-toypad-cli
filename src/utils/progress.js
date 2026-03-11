function renderProgressBar(current, total, label) {
  const width = 24;
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(width * ratio);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
  const pct = Math.round(ratio * 100);

  process.stdout.write(`\r  ${label}: [${bar}] ${pct}%`);
  if (current >= total) {
    process.stdout.write('\n');
  }
}

async function runWriteProgress(label, ms) {
  const total = 20;
  const stepDelay = Math.max(20, Math.round(ms / total));

  for (let i = 0; i <= total; i++) {
    renderProgressBar(i, total, label);
    await new Promise((resolve) => setTimeout(resolve, stepDelay));
  }
}

module.exports = {
  runWriteProgress
};
