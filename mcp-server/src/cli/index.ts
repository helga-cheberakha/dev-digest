/**
 * devdigest — CLI entry point / subcommand dispatcher.
 *
 * Invoked by the `bin/devdigest` shell script. Reads the first positional
 * argument as the subcommand, strips it from argv, and delegates to the
 * command module so its own `parseArgs` sees only the flags.
 */

const GLOBAL_USAGE = `DevDigest CLI

Usage:
  devdigest <command> [options]

Commands:
  review    Review your local diff before opening a PR

Run \`devdigest review --help\` for per-command flags.
`;

const subcommand = process.argv[2];

if (subcommand === 'review') {
  // Strip the subcommand so review's parseArgs (process.argv.slice(2)) sees flags only.
  process.argv.splice(2, 1);
  const { main } = await import('./review.js');
  await main();
} else if (subcommand === undefined || subcommand === '--help' || subcommand === '-h') {
  process.stdout.write(GLOBAL_USAGE);
  process.exit(0);
} else {
  process.stderr.write(`Unknown command: "${subcommand}"\n\n${GLOBAL_USAGE}`);
  process.exit(2);
}
