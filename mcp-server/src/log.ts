const write = (...args: unknown[]) =>
  process.stderr.write(args.map(String).join(' ') + '\n');

export const log = {
  info:  write,
  warn:  write,
  error: write,
};
