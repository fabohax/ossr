import { spawnSync } from 'node:child_process';
import { fixtureEnv } from '../e2e/fixture-config.mjs';
const env = { ...process.env, ...fixtureEnv };
const build = spawnSync('npm', ['run', 'build'], { env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const run = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { env, stdio: 'inherit' });
process.exit(run.status ?? 1);
