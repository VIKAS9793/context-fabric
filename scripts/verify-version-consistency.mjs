import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const server = readJson('server.json');
const indexSource = readFileSync(resolve(root, 'src/index.ts'), 'utf8');
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');

const expectedVersion = pkg.version;
const mismatches = [];

if (lock.version !== expectedVersion) {
  mismatches.push(`package-lock.json version ${lock.version} != package.json version ${expectedVersion}`);
}

if (lock.packages?.['']?.version !== expectedVersion) {
  mismatches.push(
    `package-lock.json root package version ${lock.packages?.['']?.version ?? 'missing'} != package.json version ${expectedVersion}`,
  );
}

if (server.version !== expectedVersion) {
  mismatches.push(`server.json version ${server.version} != package.json version ${expectedVersion}`);
}

const registryPackageVersion = server.packages?.[0]?.version;
if (registryPackageVersion !== expectedVersion) {
  mismatches.push(
    `server.json packages[0].version ${registryPackageVersion ?? 'missing'} != package.json version ${expectedVersion}`,
  );
}

const serverVersionMatch = indexSource.match(/version:\s*'([^']+)'/);
if (!serverVersionMatch) {
  mismatches.push('src/index.ts MCP server version literal is missing');
} else if (serverVersionMatch[1] !== expectedVersion) {
  mismatches.push(`src/index.ts version ${serverVersionMatch[1]} != package.json version ${expectedVersion}`);
}

const escapedVersion = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const changelogPattern = new RegExp(`^## \\[${escapedVersion}\\]`, 'm');
if (!changelogPattern.test(changelog)) {
  mismatches.push(`CHANGELOG.md is missing an entry for ${expectedVersion}`);
}

if (mismatches.length > 0) {
  for (const mismatch of mismatches) {
    fail(`release:check failed: ${mismatch}`);
  }
  process.exit(process.exitCode ?? 1);
}

process.stdout.write(`release:check ok for ${expectedVersion}\n`);
