/** Real Windows safeStorage regression: old packaged shell -> relocated new shell. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

assert.equal(process.platform, 'win32', 'This regression requires actual Windows DPAPI.');
const root = process.cwd();
const require = createRequire(import.meta.url);
const { version: currentVersion } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
mkdirSync(join(root, '.harness'), { recursive: true });
const output = mkdtempSync(join(root, '.harness', 'credential-upgrade-'));
const profile = join(output, 'profile');
const legacySource = join(output, 'legacy-credentials.ts');
// Exact service used to publish v1.0.0; uses the original version-1 credential file.
writeFileSync(legacySource, execFileSync('git', ['show', '48c306f63ad6f8ea441355b564d812b5110964de:electron/main/services/credentials.ts']));

async function shell(name, implementation, version) {
  const destination = join(output, name);
  cpSync(dirname(require('electron')), destination, { recursive: true });
  const binary = join(destination, 'My Cinema.exe');
  renameSync(join(destination, 'electron.exe'), binary);
  const appDir = join(destination, 'resources', 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'my-cinema', productName: 'My Cinema', version, main: 'main.cjs' }));
  await build({ stdin: { contents: `
    import { app, safeStorage } from 'electron';
    import assert from 'node:assert/strict';
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { join, basename } from 'node:path';
    import { CredentialStore } from ${JSON.stringify(implementation)};
    const originalName = app.getName();
    const originalDirectoryName = basename(app.getPath('userData'));
    const profile = process.env.MY_CINEMA_CHECK_PROFILE;
    const phase = process.env.MY_CINEMA_CHECK_PHASE;
    mkdirSync(join(profile, 'tmp'), { recursive: true });
    app.setPath('userData', profile);
    app.setPath('temp', join(profile, 'tmp'));
    app.whenReady().then(() => {
      assert.equal(originalName, 'My Cinema');
      assert.equal(app.getVersion(), ${JSON.stringify(version)});
      assert.equal(originalDirectoryName, 'My Cinema');
      assert.equal(safeStorage.isEncryptionAvailable(), true);
      const store = new CredentialStore(join(profile, 'credentials.json'), {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: value => safeStorage.encryptString(value),
        decrypt: value => safeStorage.decryptString(value),
      });
      if (phase === 'write-old') store.setKey('mycinema-upgrade-test-only-1');
      else {
        assert.equal(store.getKey(), phase === 'read-new' ? 'mycinema-upgrade-test-only-1' : 'mycinema-upgrade-test-only-2');
        assert.equal(store.getState(), 'configured');
        if (phase === 'read-new') store.setKey('mycinema-upgrade-test-only-2');
      }
      const ciphertext = JSON.parse(readFileSync(join(profile, 'credentials.json'), 'utf8')).tmdbApiKey;
      assert.equal(Buffer.from(ciphertext, 'base64').includes(Buffer.from('mycinema-upgrade-test-only')), false);
      writeFileSync(process.env.MY_CINEMA_CHECK_REPORT, JSON.stringify({
        phase, platform: process.platform, packaged: app.isPackaged, appName: app.getName(), appVersion: app.getVersion(),
        realWindowsEncryption: true, syntheticCredentialOnly: true, result: 'passed'
      }, null, 2));
      app.quit();
    }).catch(error => { console.error('[credential-upgrade] phase failed:', phase, error.name); app.exit(1); });
    setTimeout(() => app.exit(1), 30000).unref();
  `, resolveDir: root, loader: 'ts', sourcefile: 'credential-upgrade.ts' }, outfile: join(appDir, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
  return binary;
}
const oldBinary = await shell('old-install', legacySource, '1.0.0');
const newBinary = await shell('updated-install', join(root, 'electron/main/services/credentials.ts'), currentVersion);
for (const [phase, binary] of [['write-old', oldBinary], ['read-new', newBinary], ['restart-new', newBinary]]) {
  const report = join(output, `report-${phase}.json`);
  const env = { ...process.env, MY_CINEMA_CHECK_PROFILE: profile, MY_CINEMA_CHECK_PHASE: phase, MY_CINEMA_CHECK_REPORT: report };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`)));
  });
  const result = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(result.packaged, true);
  console.log('[credential-upgrade]', JSON.stringify(result));
}
console.log('[credential-upgrade] PASS: original v1 encryption, relocated update, replacement and process restart.');
