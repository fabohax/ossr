#!/usr/bin/env tsx
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

// This script wraps the sponsored-process-and-reimburse flow for testing.
import { execSync } from 'node:child_process';

const cmd = 'npx tsx packages/stacks/scripts/sponsored-process-and-reimburse.ts';
try {
  console.log('Running dry-run of sponsored process-and-reimburse...');
  execSync(cmd, { stdio: 'inherit' });
} catch (err) {
  console.error('Failed to run sponsored-process-and-reimburse:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
