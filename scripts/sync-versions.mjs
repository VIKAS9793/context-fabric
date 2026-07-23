import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const rootDir = join(dirname(__filename), '..');

// 1. Get the new version from package.json
const pkgPath = join(rootDir, 'package.json');
const pkgInfo = JSON.parse(readFileSync(pkgPath, 'utf8'));
const newVersion = pkgInfo.version;

if (!newVersion) {
  console.error('Could not find version in package.json');
  process.exit(1);
}

// 2. Read the old version from server.json to use as a regex replacement basis
// (or we can just blindly replace any version string if we know the pattern, 
// but reading the old one from server.json is safer if we want to do global regexes).
const serverJsonPath = join(rootDir, 'server.json');
const serverJsonStr = readFileSync(serverJsonPath, 'utf8');
const serverJsonObj = JSON.parse(serverJsonStr);
const oldVersion = serverJsonObj.version;

if (!oldVersion) {
  console.error('Could not find version in server.json');
  process.exit(1);
}

console.log(`Syncing version strings from ${oldVersion} -> ${newVersion}`);

// 3. Update server.json exactly
serverJsonObj.version = newVersion;
if (serverJsonObj.packages && serverJsonObj.packages[0]) {
  serverJsonObj.packages[0].version = newVersion;
}
writeFileSync(serverJsonPath, JSON.stringify(serverJsonObj, null, 2) + '\n', 'utf8');
console.log('✓ Updated server.json');

// 4. Files where we need to replace the version string (e.g., `1.2.1` -> `1.2.2`)
const textFilesToUpdate = [
  'src/index.ts',
  'src/config.ts',
  'README.md',
  'SECURITY.md',
  'docs/wiki/README.md'
];

// In CHANGELOG, we typically don't replace the old versions, we add a new one. 
// However, doing that automatically is hard. Usually people just edit CHANGELOG by hand before bumping.
// The bump script shouldn't overwrite historical versions in CHANGELOG.md!

for (const relPath of textFilesToUpdate) {
  const absPath = join(rootDir, relPath);
  let content = readFileSync(absPath, 'utf8');
  
  // Create a global regex for the old version, escaping dots
  const oldVersionRegex = new RegExp(oldVersion.replace(/\./g, '\\.'), 'g');
  content = content.replace(oldVersionRegex, newVersion);
  
  writeFileSync(absPath, content, 'utf8');
  console.log(`✓ Updated ${relPath}`);
}

// 5. Git Add the modified files so npm version includes them in the commit
const filesToAdd = ['server.json', ...textFilesToUpdate];
execSync(`git add ${filesToAdd.join(' ')}`, { stdio: 'inherit', cwd: rootDir });
console.log('✓ Staged updated files for commit');
