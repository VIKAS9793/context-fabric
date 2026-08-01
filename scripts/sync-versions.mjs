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

// 5. Autogenerate a CHANGELOG.md entry from git history
try {
  const lastTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
  const rawLog = execSync(`git log ${lastTag}..HEAD --pretty=format:"- %s"`, { encoding: 'utf8' }).trim();
  
  let added = [];
  let fixed = [];
  let other = [];
  
  if (rawLog) {
    const commits = rawLog.split('\n');
    for (const commit of commits) {
      if (commit.toLowerCase().includes('fix') || commit.toLowerCase().includes('bug')) {
        fixed.push(commit);
      } else if (commit.toLowerCase().includes('feat') || commit.toLowerCase().includes('add')) {
        added.push(commit);
      } else {
        other.push(commit);
      }
    }
  } else {
    other.push('- No specific commits found.');
  }

  let changelogInjection = `---

## [${newVersion}] — ${new Date().toISOString().split('T')[0]}
`;
  if (added.length > 0) changelogInjection += `\n### Added\n${added.join('\n')}\n`;
  if (fixed.length > 0) changelogInjection += `\n### Fixed\n${fixed.join('\n')}\n`;
  if (other.length > 0) changelogInjection += `\n### Changes\n${other.join('\n')}\n`;

  const changelogPath = join(rootDir, 'CHANGELOG.md');
  let changelogContent = readFileSync(changelogPath, 'utf8');
  changelogContent = changelogContent.replace('---', changelogInjection);
  writeFileSync(changelogPath, changelogContent, 'utf8');
  console.log('✓ Auto-generated new version heading in CHANGELOG.md from git history');
} catch (error) {
  console.warn('⚠️ Could not generate changelog from git history. Skipping.');
}

for (const relPath of textFilesToUpdate) {
  const absPath = join(rootDir, relPath);
  let content = readFileSync(absPath, 'utf8');
  
  // Create a global regex for the old version, escaping all regex metacharacters
  const oldVersionRegex = new RegExp(oldVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  content = content.replace(oldVersionRegex, newVersion);
  
  writeFileSync(absPath, content, 'utf8');
  console.log(`✓ Updated ${relPath}`);
}

// 5. Git Add the modified files so npm version includes them in the commit
const filesToAdd = ['server.json', 'CHANGELOG.md', ...textFilesToUpdate];
execSync(`git add ${filesToAdd.join(' ')}`, { stdio: 'inherit', cwd: rootDir });
console.log('✓ Staged updated files for commit');
