const { Command } = require('commander');
const chalk = require('chalk');
const { VERSION, DEFAULT_RELAY_URL } = require('./constants');

const program = new Command();

program
  .name('vibe-party')
  .description('Multiplayer AI coding sessions')
  .version(VERSION);

program
  .command('host')
  .description('Start a new shared coding session')
  .option('-r, --relay <url>', 'Relay server URL', DEFAULT_RELAY_URL)
  .option('-c, --code <code>', 'Use a specific session code instead of generating one')
  .option('--command <cmd>', 'Command to run (default: claude)', 'claude')
  .action((options) => {
    if (options.code && options.code.length < 6) {
      console.error(chalk.red('❌ Session code must be at least 6 characters.'));
      process.exit(1);
    }
    const { startHost } = require('./host');
    startHost({ relay: options.relay, code: options.code, command: options.command });
  });

program
  .command('join <code>')
  .description('Join an existing session with a session code')
  .option('-r, --relay <url>', 'Relay server URL', DEFAULT_RELAY_URL)
  .action((code, options) => {
    if (code.length < 6) {
      console.error(chalk.red('❌ Session code must be at least 6 characters.'));
      process.exit(1);
    }
    const { joinSession } = require('./guest');
    joinSession(code, { relay: options.relay });
  });

program.parse();
