# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/134ch/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/134ch/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-2) ranks 200 pre-token protocols by implied value from the DeFiLlama protocol snapshot of 2026-11-14. The board covers all 40 watchlist protocols, adds 160 pre-token protocols below the $50M TVL floor, and sets aside 24 live-token protocols in a separate tab. The dashboard is static HTML, CSS, and JavaScript with no network calls. You open it from disk, filter and sort the board, select any protocol for its model breakdown, risk notes, and six-step farm plan.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

Entered on [make.fun](https://make.fun/?ref=b3mpkqk5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards

## What this board does

You use this board to compare pre-token protocols on one number, implied value, and to check the reasoning behind that number before you act on it.

- The board ranks 200 pre-token protocols, strongest implied value first. Ranks run 1 to 200 with no gaps, and implied value never rises as rank ascends.
- The top-3 cards show the three highest-ranked protocols. You select any row to open its detail view.
- The detail view shows the model breakdown for that protocol (TVL, raw and capped 7d growth, age, chain count, diversity multiplier, growth and maturity multipliers, recomputed implied value), its risk notes, and a six-step farm plan with a cost and a time for each step.
- The filters narrow the board by search text, category, chain, and sort order, and by pre-token or live-token status. The filtered screenshot shows the Risk Curators category: 29 rows.
- The model panel below the board states the full radar-2 formula and works through rank 1 as an example.

## Before you begin

You need Node.js 22.18 or later and the sealed snapshot at `input/snapshot.json` in the kit. This entry was built and run with Node.js 24.22.1. You need a browser only to open the dashboard and take screenshots.

Owner is 134ch, repository is token-radar-01, referral code is b3mpkqk5.

## Verify the output

After you run the command above, confirm the output in `out/`:

1. Open `out/board.json` and confirm it holds 200 rows, ranks 1 to 200, and all 40 watchlist slugs.
2. Open `out/dashboard/index.html` in a browser and confirm the board, the top-3 cards, and the filters render.
3. Select a row and confirm the detail view shows the model breakdown, risk notes, and farm plan. The detail view states when the recomputed implied value matches the number `board.json` carries.
4. Open `out/dossier.json` and confirm its schema reads `makefun/dossier/v1` and it lists the three screenshots under `images`.

The local run on 2026-11-18 produced `758 protocols, 40 on the watchlist, 200 rows scored (160 early, 24 live set aside)`. Rank 1 is Steakhouse Financial at $588,115,396 implied value; rank 2 is Gauntlet at $351,528,731; rank 3 is Veda at $337,627,035.

## What the model does

Radar-2 starts from the starter model and adds two generic signals. No protocol is special-cased; the same function scores every row.

- **7d growth sanity cap.** The model uses the 7d TVL change, clamped to -60% to +120%, then capped at +60%. The raw figure stays in `board.json` as `growth_raw_pct`, and the board marks capped rows with `*`. In this snapshot 6 protocols grow more than +60% in 7 days; one grows +4,448.4747%, which reads as a reclassification, a bridge inflow, or a data revision rather than organic growth. After the cap that protocol ranks 43rd instead of dominating the board.
- **Chain diversity.** The model multiplies by `0.90 + 0.20 x (1 - 1 / chain_count)`, from x0.90 for a single-chain protocol to x1.10 as the chain count grows. The snapshot gives no TVL per chain, so the factor assumes TVL spreads evenly over the chains named. In this snapshot 126 rows are single-chain.
- **Formula.** Implied value = TVL x 0.25 x (1 + capped growth / 100 x 0.5) x (0.6 + min(age in days, 1095) / 1095 x 0.4) x diversity. Age is the days since listing with no token on record; a protocol with no listing date uses 90 days.

Implied value is a model of this snapshot, not a price and not a prediction that a token will launch.

## What this entry does not do

- It does not fetch live data. The board reflects the sealed snapshot of 2026-11-14 only.
- It does not advise you to buy, farm, or hold any protocol. The farm plan is a generic six-step template with per-protocol costs and times; it names no wallet, exchange, or contract address.
- It does not hide risk. Every row carries risk notes drawn from its own record only: single-chain concentration, a capped growth spike, no 7d change, a 7d TVL fall, an unknown age, or a position below the watchlist floor.

## Before you submit

- Public GitHub repository: 134ch/token-radar-01.
- Bundle the agent transcripts with the kit CLI (`node cli/makefun.mjs bundle`) and run `node cli/makefun.mjs check` on the new bundle before you submit. Do not submit without the check verdict.
- Entries close 2026-12-14 10:00 UTC. Rewards total $1,325 in USDC: $1,000 for 1st place, $50 each for 2nd to 5th, $25 each for 6th to 10th.
