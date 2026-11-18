// Tests for the token radar model in lib/model.ts.
//
// These tests check behaviour, not the model's own arithmetic restated:
// every expected number below is hand-computed from the formula in the
// model (base = TVL x 0.25, growth weight 0.5, maturity floor 0.6 with a
// 3-year ceiling, diversity 0.90 to 1.10), so a test fails when the code
// drifts from the formula it claims to implement.
//
// Run them with: node --test tests/model.test.mjs
// They need no dependencies beyond the Node standard library.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL,
  ageDays,
  boardIssue,
  buildBoard,
  cappedGrowth,
  diversityMultiplier,
  farmSteps,
  impliedValue,
  isPreToken,
  isRankable,
  maturityMultiplier,
  parseSnapshot,
  stepText,
} from '../lib/model.ts';

const here = dirname(fileURLToPath(import.meta.url));

// A small protocol record, built by the caller. Every field the model
// reads is present, so a test changes one input at a time and watches
// one output move.
function makeProtocol(overrides = {}) {
  return {
    slug: 'test-protocol',
    name: 'Test Protocol',
    category: 'Risk Curators',
    chains: ['Ethereum'],
    tvl_usd: 100_000_000,
    change_7d: 0,
    mcap_usd: null,
    listed_at: '2023-11-14',
    gecko_id: null,
    symbol: null,
    ...overrides,
  };
}

const AS_OF = '2026-11-14';

// Two floats are equal when they agree to six decimal places. The model
// rounds its stored multipliers to four decimals, so tests that read a
// stored multiplier allow that rounding instead of exact equality.
function closeTo(actual, expected, places = 6) {
  const scale = 10 ** places;
  assert.equal(Math.round(actual * scale), Math.round(expected * scale));
}

// ---------------------------------------------------------------------------
// Growth sanity cap
// ---------------------------------------------------------------------------

test('cappedGrowth leaves ordinary growth untouched', () => {
  assert.deepEqual(cappedGrowth(10, MODEL), { growthPct: 10, growthCapped: false });
  assert.deepEqual(cappedGrowth(-25, MODEL), { growthPct: -25, growthCapped: false });
  assert.deepEqual(cappedGrowth(0, MODEL), { growthPct: 0, growthCapped: false });
});

test('cappedGrowth caps the +4448% weekly spike at +60%', () => {
  // One protocol in the sealed snapshot grows +4,448.4747% in a week.
  // The model must use +60% for it and say so, while the raw figure
  // stays available for the dashboard to show.
  const result = cappedGrowth(4448.4747, MODEL);
  assert.equal(result.growthPct, 60);
  assert.equal(result.growthCapped, true);
});

test('cappedGrowth treats exactly +60% as uncapped and just above it as capped', () => {
  assert.deepEqual(cappedGrowth(60, MODEL), { growthPct: 60, growthCapped: false });
  assert.deepEqual(cappedGrowth(60.01, MODEL), { growthPct: 60, growthCapped: true });
  assert.deepEqual(cappedGrowth(120, MODEL), { growthPct: 60, growthCapped: true });
});

test('cappedGrowth clamps a crash to the -60% floor', () => {
  assert.deepEqual(cappedGrowth(-100, MODEL), { growthPct: -60, growthCapped: false });
  assert.deepEqual(cappedGrowth(-60, MODEL), { growthPct: -60, growthCapped: false });
});

test('cappedGrowth treats a missing 7d change as zero growth', () => {
  assert.deepEqual(cappedGrowth(null, MODEL), { growthPct: 0, growthCapped: false });
});

// ---------------------------------------------------------------------------
// Chain diversity
// ---------------------------------------------------------------------------

test('diversityMultiplier discounts a single-chain protocol to 0.90', () => {
  assert.equal(diversityMultiplier(1, MODEL), 0.9);
  assert.equal(diversityMultiplier(0, MODEL), 0.9);
});

test('diversityMultiplier rises with chain count toward 1.10', () => {
  // Two chains: 0.90 + 0.20 x (1 - 1/2) = 1.00.
  assert.equal(diversityMultiplier(2, MODEL), 1);
  // Four chains: 0.90 + 0.20 x (1 - 1/4) = 1.05.
  assert.equal(diversityMultiplier(4, MODEL), 1.05);
  // Ten chains: 0.90 + 0.20 x (1 - 1/10) = 1.08.
  closeTo(diversityMultiplier(10, MODEL), 1.08);
  // One hundred chains is close to, but still below, the 1.10 ceiling.
  closeTo(diversityMultiplier(100, MODEL), 1.098);
  assert.ok(diversityMultiplier(100, MODEL) < 1.1);
});

test('diversityMultiplier never leaves the 0.90 to 1.10 band', () => {
  for (const count of [0, 1, 2, 3, 5, 8, 20, 1000]) {
    const value = diversityMultiplier(count, MODEL);
    assert.ok(value >= 0.9 && value <= 1.1, `chain count ${count} gave ${value}`);
  }
});

// ---------------------------------------------------------------------------
// Maturity
// ---------------------------------------------------------------------------

test('maturityMultiplier starts at 0.60 for a newborn protocol', () => {
  assert.equal(maturityMultiplier(0, MODEL), 0.6);
  assert.equal(maturityMultiplier(-30, MODEL), 0.6);
});

test('maturityMultiplier reaches 1.00 at the three-year ceiling and stays there', () => {
  assert.equal(maturityMultiplier(1095, MODEL), 1);
  assert.equal(maturityMultiplier(2000, MODEL), 1);
  assert.equal(maturityMultiplier(10000, MODEL), 1);
});

test('maturityMultiplier is 0.80 halfway to the ceiling', () => {
  // 547.5 days is half of 1095, so 0.6 + 0.5 x 0.4 = 0.8.
  assert.equal(maturityMultiplier(547.5, MODEL), 0.8);
});

test('maturityMultiplier uses 365 days when the age is unknown', () => {
  // 0.6 + (365 / 1095) x 0.4 = 0.6 + 0.1333... = 0.7333...
  closeTo(maturityMultiplier(null, MODEL), 0.6 + (365 / 1095) * 0.4);
});

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

test('ageDays counts whole days between listing and the snapshot date', () => {
  assert.equal(ageDays('2026-11-14', '2025-11-14'), 365);
  assert.equal(ageDays('2026-11-14', '2026-11-14'), 0);
  assert.equal(ageDays('2026-11-14', '2026-11-13'), 1);
});

test('ageDays returns null when the listing date is missing or bad', () => {
  assert.equal(ageDays('2026-11-14', null), null);
  assert.equal(ageDays('2026-11-14', 'not-a-date'), null);
  assert.equal(ageDays('not-a-date', '2025-11-14'), null);
});

test('ageDays never goes below zero for a future listing date', () => {
  assert.equal(ageDays('2026-11-14', '2027-01-01'), 0);
});

// ---------------------------------------------------------------------------
// Implied value
// ---------------------------------------------------------------------------

test('impliedValue hand case: $100M TVL, no growth, mature, one chain', () => {
  // Base 25,000,000 x growth 1.00 x maturity 1.00 x diversity 0.90.
  const result = impliedValue(makeProtocol(), AS_OF, MODEL);
  assert.equal(result.implied, 22_500_000);
  assert.equal(result.growthPct, 0);
  assert.equal(result.growthCapped, false);
  closeTo(result.maturityMult, 1);
  assert.equal(result.diversityMult, 0.9);
});

test('impliedValue hand case: the same protocol on two chains', () => {
  // Diversity rises to 1.00, so the value rises to the full base.
  const result = impliedValue(
    makeProtocol({ chains: ['Ethereum', 'Solana'] }),
    AS_OF,
    MODEL,
  );
  assert.equal(result.implied, 25_000_000);
});

test('impliedValue hand case: +60% growth lifts the value by the growth weight', () => {
  // Growth multiplier 1 + 0.60 x 0.5 = 1.30, so 25,000,000 x 1.30 x 0.90.
  const result = impliedValue(makeProtocol({ change_7d: 60 }), AS_OF, MODEL);
  assert.equal(result.implied, 29_250_000);
  assert.equal(result.growthMult, 1.3);
});

test('impliedValue caps a +4448% spike instead of letting it dominate', () => {
  const capped = impliedValue(makeProtocol({ change_7d: 4448.4747 }), AS_OF, MODEL);
  const atCap = impliedValue(makeProtocol({ change_7d: 60 }), AS_OF, MODEL);
  assert.equal(capped.implied, atCap.implied);
  assert.equal(capped.growthCapped, true);
  assert.equal(capped.growthRawPct, 4448.4747);
});

test('impliedValue orders protocols by value: more TVL outranks less TVL', () => {
  const small = impliedValue(makeProtocol({ tvl_usd: 50_000_000 }), AS_OF, MODEL);
  const large = impliedValue(makeProtocol({ tvl_usd: 500_000_000 }), AS_OF, MODEL);
  assert.ok(large.implied > small.implied);
  assert.equal(large.implied, small.implied * 10);
});

test('impliedValue orders by diversity: more chains outrank fewer chains', () => {
  const oneChain = impliedValue(makeProtocol(), AS_OF, MODEL);
  const fourChains = impliedValue(
    makeProtocol({ chains: ['Ethereum', 'Solana', 'Arbitrum', 'Base'] }),
    AS_OF,
    MODEL,
  );
  assert.ok(fourChains.implied > oneChain.implied);
});

test('impliedValue never drops below one dollar', () => {
  const result = impliedValue(
    makeProtocol({ tvl_usd: 1, change_7d: -100 }),
    AS_OF,
    MODEL,
  );
  assert.ok(result.implied >= 1);
});

test('impliedValue treats a null 7d change as zero growth', () => {
  const result = impliedValue(makeProtocol({ change_7d: null }), AS_OF, MODEL);
  assert.equal(result.growthPct, 0);
  assert.equal(result.growthRawPct, null);
  assert.equal(result.implied, 22_500_000);
});

// ---------------------------------------------------------------------------
// Pre-token and rankable checks
// ---------------------------------------------------------------------------

test('isPreToken is true only when no token record exists', () => {
  assert.equal(isPreToken(makeProtocol()), true);
  assert.equal(isPreToken(makeProtocol({ mcap_usd: 1_000_000 })), false);
  assert.equal(isPreToken(makeProtocol({ gecko_id: 'some-token' })), false);
  assert.equal(isPreToken(makeProtocol({ symbol: 'TST' })), false);
});

test('isRankable excludes exchanges and versioned pools', () => {
  assert.equal(isRankable(makeProtocol()), true);
  assert.equal(isRankable(makeProtocol({ category: 'CEX' })), false);
  assert.equal(isRankable(makeProtocol({ name: 'Test Protocol V2' })), false);
  assert.equal(isRankable(makeProtocol({ mcap_usd: 5_000_000 })), false);
});

// ---------------------------------------------------------------------------
// Farm plan
// ---------------------------------------------------------------------------

test('farmSteps returns six steps, each 20 to 600 characters', () => {
  const steps = farmSteps(makeProtocol(), 365).map(stepText);
  assert.equal(steps.length, 6);
  for (const step of steps) {
    assert.ok(step.length >= 20 && step.length <= 600, `step of ${step.length} chars: ${step}`);
  }
});

test('farmSteps gives a longer hold to a younger protocol', () => {
  const young = farmSteps(makeProtocol(), 90).map(stepText).join(' ');
  const old = farmSteps(makeProtocol(), 900).map(stepText).join(' ');
  assert.match(young, /60 days/);
  assert.match(old, /30 days/);
  assert.ok(!old.includes('60 days'));
});

test('farmSteps names the protocol category action for a lender', () => {
  const steps = farmSteps(makeProtocol({ category: 'Lending' }), 365).map(stepText);
  assert.match(steps.join(' '), /Supply/);
});

// ---------------------------------------------------------------------------
// Board built from the sealed snapshot
// ---------------------------------------------------------------------------

// The sealed snapshot lives in the kit, outside this repository. The
// tests look for it in the kit's usual place first, then beside the
// repository, and skip the board checks when neither exists.
const SNAPSHOT_PATHS = [
  '/home/hatch/workspace/makefun/token-radar-01-kit/input/snapshot.json',
  join(here, '..', '..', 'token-radar-01-kit', 'input', 'snapshot.json'),
  join(here, '..', 'snapshot.json'),
];
const snapshotPath = SNAPSHOT_PATHS.find((p) => existsSync(p));

test('board from the sealed snapshot: 200 rows, ranks 1 to 200', { skip: !snapshotPath }, () => {
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  assert.equal(snapshot.protocols.length, 758);
  assert.equal(snapshot.watchlist.length, 40);
  const board = buildBoard(snapshot, MODEL);
  assert.equal(board.length, 200);
  assert.deepEqual(board.map((r) => r.rank), Array.from({ length: 200 }, (_, i) => i + 1));
  assert.equal(boardIssue(board, snapshot), null);
});

test('board covers every watchlist slug', { skip: !snapshotPath }, () => {
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const board = buildBoard(snapshot, MODEL);
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    assert.ok(slugs.has(slug), `watchlist slug ${slug} is missing from the board`);
  }
});

test('board is ordered by implied value, strongest first', { skip: !snapshotPath }, () => {
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const board = buildBoard(snapshot, MODEL);
  for (let i = 1; i < board.length; i++) {
    assert.ok(
      board[i].implied_value_usd <= board[i - 1].implied_value_usd,
      `row ${i + 1} outranks row ${i}`,
    );
  }
  assert.ok(board[0].implied_value_usd > board[board.length - 1].implied_value_usd);
});

test('board rank 1 is Steakhouse Financial at $588,115,396', { skip: !snapshotPath }, () => {
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const board = buildBoard(snapshot, MODEL);
  assert.equal(board[0].name, 'Steakhouse Financial');
  assert.equal(board[0].implied_value_usd, 588_115_396);
});

test('board caps shift-defi at rank 43 instead of letting +4448% dominate', { skip: !snapshotPath }, () => {
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const board = buildBoard(snapshot, MODEL);
  const row = board.find((r) => r.slug === 'shift-defi');
  assert.ok(row, 'shift-defi is on the board');
  assert.equal(row.rank, 43);
  assert.equal(row.implied_value_usd, 8_582_517);
  assert.equal(row.model.growth_raw_pct, 4448.4747);
  assert.equal(row.model.growth_pct, 60);
  assert.equal(row.model.growth_capped, true);
});

test('board farm plans all have six steps of 20 to 600 characters', { skip: !snapshotPath }, () => {
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const board = buildBoard(snapshot, MODEL);
  for (const row of board) {
    assert.equal(row.farm_steps.length, 6, `${row.slug} farm plan length`);
    for (const step of row.farm_steps) {
      assert.ok(step.length >= 20 && step.length <= 600, `${row.slug} step of ${step.length} chars`);
    }
  }
});

test('parseSnapshot refuses a snapshot that is not JSON', () => {
  assert.throws(() => parseSnapshot('not json'), /not JSON/);
  assert.throws(() => parseSnapshot('[]'), /not a JSON object/);
});
