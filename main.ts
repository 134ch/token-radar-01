// Token Radar: turn the sealed DefiLlama snapshot into a ranked board.
//
// The program reads the snapshot, scores every protocol with the radar-2
// model, and writes the board, the dashboard data, the dashboard files, the
// screenshots, and the dossier the judge reads. It changes nothing about the
// snapshot itself: the snapshot stays sealed, and the model does the ranking.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REQUIRED_SCREENSHOTS = 3;
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DOSSIER_CAPS = {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
};

// The value after a --name flag, in --name value or --name=value form.
function flagValue(args: string[], name: string, fallback: string): string {
  const flag = `--${name}`;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1]!;
    if (args[i]!.startsWith(`${flag}=`)) return args[i]!.slice(flag.length + 1);
  }
  return fallback;
}

// Stop with a message on stderr and the given exit code.
function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

// A snapshot file: the path itself when it ends in .json, else snapshot.json inside it.
function snapshotPath(input: string): string {
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

// Copy one directory tree, skipping dotfiles and anything that is not a file.
// Returns the copied file names, in the order they were found.
function copyTree(source: string, target: string): string[] {
  mkdirSync(target, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyTree(from, to));
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      copied.push(entry.name);
    }
  }
  return copied;
}

function main(): void {
  const args = process.argv.slice(2);
  const input = flagValue(args, 'input', '/input');
  const out = flagValue(args, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snapshotFile = snapshotPath(input);

  if (!existsSync(snapshotFile) || !statSync(snapshotFile).isFile()) {
    fail(`token radar: no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }

  const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    fail(`token radar: the model wrote a board the gate refuses: ${issue}`, 1);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  const entryDir = join(fileURLToPath(import.meta.url), '..');
  const dashboardFiles = copyTree(join(entryDir, 'dashboard'), join(out, 'dashboard'));
  const screenshotFiles = copyTree(join(entryDir, 'screenshots'), join(out, 'screenshots'));

  if (screenshotFiles.length < REQUIRED_SCREENSHOTS) {
    const noun = screenshotFiles.length === 1 ? 'image' : 'images';
    fail(`token radar: screenshots/ holds ${screenshotFiles.length} ${noun}: hand in 3, the board, a detail view and a filtered view`, 1);
  }
  for (const name of screenshotFiles) {
    if (!SCREENSHOT_NAME.test(name)) {
      fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }

  writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));

  console.log(`token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`);
  console.log(`token radar: wrote ${out}/board.json, ${out}/data.js, ${out}/dashboard (${dashboardFiles.length} files), ${out}/screenshots (${screenshotFiles.length} images) and ${out}/dossier.json`);
}

main();
