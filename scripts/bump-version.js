#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const versionArg = args.find(a => !a.startsWith('--'));
const noGit = args.includes('--no-git');

if (!versionArg) {
  console.error('Usage: npm run version:bump <new-version | patch | minor | major> [--no-git]');
  process.exit(1);
}

// Helper to bump semver
function calculateNextVersion(currentVersion, bumpType) {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid current semver: ${currentVersion}`);
  }
  let [major, minor, patch] = parts;
  if (bumpType === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpType === 'minor') {
    minor += 1;
    patch = 0;
  } else if (bumpType === 'patch') {
    patch += 1;
  } else if (/^\d+\.\d+\.\d+.*$/.test(bumpType)) {
    return bumpType.replace(/^v/, '');
  } else {
    throw new Error(`Unknown bump type or invalid version: ${bumpType}`);
  }
  return `${major}.${minor}.${patch}`;
}

const rootPkgPath = path.join(rootDir, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const currentVersion = rootPkg.version;
const newVersion = calculateNextVersion(currentVersion, versionArg);

console.log(`\n🚀 Bumping project version: ${currentVersion} -> ${newVersion}\n`);

// 1. package.json
rootPkg.version = newVersion;
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
console.log('✓ Updated package.json');

// 2. mcp-server/package.json
const mcpPkgPath = path.join(rootDir, 'mcp-server', 'package.json');
if (fs.existsSync(mcpPkgPath)) {
  const mcpPkg = JSON.parse(fs.readFileSync(mcpPkgPath, 'utf8'));
  mcpPkg.version = newVersion;
  fs.writeFileSync(mcpPkgPath, JSON.stringify(mcpPkg, null, 2) + '\n');
  console.log('✓ Updated mcp-server/package.json');
}

// 3. ha-mcp-helper/pyproject.toml
const pyprojectPath = path.join(rootDir, 'ha-mcp-helper', 'pyproject.toml');
if (fs.existsSync(pyprojectPath)) {
  let pyproject = fs.readFileSync(pyprojectPath, 'utf8');
  pyproject = pyproject.replace(/^version = ".*"/m, `version = "${newVersion}"`);
  fs.writeFileSync(pyprojectPath, pyproject);
  console.log('✓ Updated ha-mcp-helper/pyproject.toml');
}

// 4. ha-mcp-helper/config.yaml
const configYamlPath = path.join(rootDir, 'ha-mcp-helper', 'config.yaml');
if (fs.existsSync(configYamlPath)) {
  let configYaml = fs.readFileSync(configYamlPath, 'utf8');
  configYaml = configYaml.replace(/^version: ".*"/m, `version: "${newVersion}"`);
  fs.writeFileSync(configYamlPath, configYaml);
  console.log('✓ Updated ha-mcp-helper/config.yaml');
}

// 5. ha-mcp-helper/app/main.py
const mainPyPath = path.join(rootDir, 'ha-mcp-helper', 'app', 'main.py');
if (fs.existsSync(mainPyPath)) {
  let mainPy = fs.readFileSync(mainPyPath, 'utf8');
  mainPy = mainPy.replace(/version=".*"/g, `version="${newVersion}"`);
  fs.writeFileSync(mainPyPath, mainPy);
  console.log('✓ Updated ha-mcp-helper/app/main.py');
}

// 6. ha-mcp-helper/app/api/routes/health.py
const healthPyPath = path.join(rootDir, 'ha-mcp-helper', 'app', 'api', 'routes', 'health.py');
if (fs.existsSync(healthPyPath)) {
  let healthPy = fs.readFileSync(healthPyPath, 'utf8');
  healthPy = healthPy.replace(/"version": ".*"/g, `"version": "${newVersion}"`);
  fs.writeFileSync(healthPyPath, healthPy);
  console.log('✓ Updated ha-mcp-helper/app/api/routes/health.py');
}

// 7. ha-mcp-helper/tests/test_api.py
const testApiPath = path.join(rootDir, 'ha-mcp-helper', 'tests', 'test_api.py');
if (fs.existsSync(testApiPath)) {
  let testApi = fs.readFileSync(testApiPath, 'utf8');
  testApi = testApi.replace(/assert data\["version"\] == ".*"/g, `assert data["version"] == "${newVersion}"`);
  fs.writeFileSync(testApiPath, testApi);
  console.log('✓ Updated ha-mcp-helper/tests/test_api.py');
}

console.log(`\n✨ Successfully bumped all manifests & code to v${newVersion}!`);

// Optional Git commit & tag
if (!noGit) {
  try {
    const tagName = `v${newVersion}`;
    console.log('\n📦 Staging changes, creating git commit and tag...');
    execSync('git add package.json mcp-server/package.json ha-mcp-helper/', { cwd: rootDir, stdio: 'inherit' });
    execSync(`git commit -m "chore(release): bump version to ${tagName}"`, { cwd: rootDir, stdio: 'inherit' });
    execSync(`git tag -a "${tagName}" -m "Release ${tagName}"`, { cwd: rootDir, stdio: 'inherit' });
    console.log(`\n🎉 Created git commit and tag "${tagName}"!`);
    console.log(`\nTo publish the release, run:\n  git push origin main --tags\n`);
  } catch (error) {
    console.warn('⚠️  Could not automatically create git commit/tag:', error.message);
  }
}
