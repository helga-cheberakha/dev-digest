export const config = {
  apiUrl: process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001',
  pollIntervalMs: 2_000,
  runTimeoutMs: 120_000,
} as const;
