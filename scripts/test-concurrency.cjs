// Creates and removes only this dedicated, disposable LOCAL PostgreSQL container.
// No .env file is read and no application seed or migration is executed.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const container = 'washsync-concurrency-test';
const database = 'washsync_concurrency_test';
const url = `postgresql://postgres@127.0.0.1:55439/${database}`;
const env = { ...process.env, DATABASE_URL: url, WASHSYNC_CONCURRENCY_TEST_URL: url, TZ: 'UTC' };
let started = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || ''}`);
  return result.stdout;
}

(async () => {
  try {
    // If this name/port already exists, fail rather than reuse or delete it.
    run('docker', ['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1:55439:5432',
      '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', `POSTGRES_DB=${database}`, 'postgres:16-alpine']);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', database], { stdio: 'ignore' });
      if (result.status === 0) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
    const sql = run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff',
      '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script']);
    run('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: sql });
    run(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', 'appointments-concurrency.integration.spec.ts'], { stdio: 'inherit' });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (started) {
      try { run('docker', ['stop', container]); }
      catch (error) { console.error(error.message); process.exitCode = 1; }
    }
  }
})();
