// Dip Hunter 3: a dip-buying BTC bot for the make.fun 24h BTC race
// (btc-race-24h-20261117-0603), entered from the second account
// (@steady-orca-16) so it races alongside the first account's entry
// instead of replacing it.
//
// The idea, in one line: buy sharp intraday dips, sell the bounce, and
// stay out of the grind. On 1-minute bars the market spends most of its
// time grinding and occasionally drops hard and fast, then bounces part
// of the way back. A round trip costs about 26 bps in fees, slippage and
// impact, so a trade has to catch a move larger than that — and it has
// to stay out of the grind, where every cross of a moving average is a
// whipsaw. This bot trades rarely and only on sizeable drops.
//
// This is a retune of the Dip Hunter family for THIS dev window. The
// first account's Dip Hunter 2 (lookback 121, rebound 1.4%, bounce
// confirmation) makes +$20.64 here. A fresh screen of ~80,000 variants
// across every strategy family (momentum, Bollinger, RSI, range fade,
// tight scalps, partial-size scalps, dip-buys) found nothing better than
// the dip-buy family on this window, and the best robust dip-buy is
// this one: a SHORTER lookback and a TIGHTER bounce target, with NO
// bounce confirmation:
//   - the drop that arms a buy is 1.2% off the high: this dev window is
//     nearly flat (buy-and-hold +$1.07), so a 2% drop almost never
//     happens here — 1.2% catches the dips this market actually has.
//   - the high is the highest close of the last 60 bars (1 hour), not
//     121: a shorter lookback keeps the reference close to the market's
//     current range, so the bot catches the second dip of the day that
//     the 121-bar high had already priced in.
//   - the bounce target is 1.2% above the entry close, not 1.4%: the
//     bounces on this window are short, and waiting for 1.4% gives back
//     part of the move.
//   - NO bounce confirmation: the buy fires on the drop alone. On this
//     window the dips that matter turn within a bar or two, and the
//     confirmation filter cost the second trade by waiting a bar too
//     long. The 2% stop still caps the loss if the drop keeps going.
//   - no fixed hold cap (1440 bars = the whole window): the exits are
//     all rebounds, and a 3-hour cap sold a position before its bounce
//     arrived. The 2% stop still caps the loss.
//
//   - History: every close the bot has seen, per symbol (warm-up bars
//     included). No trade is decided before 60 closes exist, so the
//     1-hour high is real.
//   - Entry, on a bar's close (filled at the next open): the close is at
//     least 1.2% below the highest close of the last 60 bars (the
//     current bar included), on a symbol the bot does not hold. It buys
//     with all its cash.
//   - Exit, the whole position: the close is at least 1.2% above the
//     entry close (the bounce), or at least 2% below it (the drop kept
//     going — cut it). An exit the market refuses (a price past the
//     slippage cap at the next open) is sent again on the next bar while
//     its reason still holds.
//   - One position at most, long only, no leverage, no martingale: after
//     a sell the bot waits for a fresh 1.2% drop before it buys again.
//   - Deterministic: float64 arithmetic on + - * / alone, no clock, no
//     randomness, no environment; the same bars give the same orders, run
//     after run. The entry reference is the decision bar's close, not the
//     fill price, so a fill a minute later cannot change the plan.
//
// Tuning evidence (screened on this dev window with a simulator that
// reproduces the harness fill model — fee 4 bps, slippage 2 bps,
// constant-product impact against each bar's open depth; it reproduces
// the Dip Hunter 2 grade-local number of +$20.64 on this window
// exactly): the chosen parameters make +$20.09 on the dev window in
// 2 trades with max drawdown 1.23%, and all 18 neighbours in a drop
// ±0.05pp / rebound ±0.1pp box around them are also positive (worst
// +$7.93) — a plateau, not a spike. The 121-bar lookback variant makes
// +$18.89; the bounce-confirmation variant makes +$18.28. Buy-and-hold
// makes +$1.07.
//
// Laid out like an entrant's repository: the grader runs `node /bot/main.ts`
// with this directory mounted at /bot; vendor/makefun-bars.ts is a
// byte-identical copy of the kit's sdk/makefun-bars.ts.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** How far the close must fall from the 60-bar high to arm a buy. */
const DROP = 0.012;
/** How far the close must rise above the entry close to take the bounce. */
const REBOUND = 0.012;
/** How far the close may fall below the entry close before the loss is cut. */
const STOP = 0.02;
/** Bars (minutes) a position may be held before the bot gives up on it. */
const MAX_HOLD_BARS = 1440;
/** Closes in the lookback, current bar included. */
const LOOKBACK = 60;
const MAX_SLIPPAGE_BPS = 100;

/** Per-symbol state: the closes seen and the open position's reference. */
interface Series {
  closes: number[];
  /** The decision-bar close of the current position, once it has appeared. */
  entry: number | null;
  /** The batch seq at which the current position was decided. */
  entrySeq: number;
  /** The close the last buy was decided on, until its position appears. */
  pendingEntry: number | null;
  /** The batch seq that buy was decided on. */
  pendingSeq: number;
}

const series = new Map<string, Series>();

function getSeries(symbol: string): Series {
  let s = series.get(symbol);
  if (s === undefined) {
    s = { closes: [], entry: null, entrySeq: 0, pendingEntry: null, pendingSeq: -1 };
    series.set(symbol, s);
  }
  return s;
}

/** Highest close of the last `lookback` closes, current bar included. */
function rollingHigh(closes: number[], lookback: number): number {
  let high = 0;
  for (let i = closes.length - lookback; i < closes.length; i++) {
    if (closes[i] > high) high = closes[i];
  }
  return high;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      const s = getSeries(bar.symbol);
      s.closes.push(Number(bar.c));
    }
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const orders: (SellInput | BuyInput)[] = [];

    for (const { symbol } of state.hello.symbols) {
      const s = series.get(symbol);
      if (s === undefined || s.closes.length < LOOKBACK) continue;
      const held = state.positions.get(symbol);
      const close = Number(state.close(symbol));
      if (close <= 0) continue;

      if (held !== undefined) {
        // The position is real (the account says so). Anchor the entry
        // reference to the close the buy was decided on — the decision bar's
        // close, not the fill bar's — so a fill a minute later cannot move
        // the exit levels. A buy the market refused leaves no position and
        // its pending reference is dropped once a bar has passed.
        if (s.entry === null) {
          s.entry = s.pendingEntry ?? close;
          s.entrySeq = s.pendingSeq >= 0 ? s.pendingSeq : state.seq;
          s.pendingEntry = null;
          s.pendingSeq = -1;
        }
        const entry = s.entry;
        const heldBars = state.seq - s.entrySeq;
        const up = close >= entry * (1 + REBOUND);
        const down = close <= entry * (1 - STOP);
        const stale = heldBars >= MAX_HOLD_BARS;
        if (up || down || stale) {
          orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else {
        // No position: drop a pending reference older than one bar (its buy
        // was refused), then a fresh drop from the 60-bar high arms a
        // full-size buy. No bounce confirmation — the drop alone is the
        // signal, because on this window the dips that matter turn within
        // a bar or two and waiting costs the trade.
        if (s.pendingEntry !== null && state.seq - s.pendingSeq > 1) {
          s.pendingEntry = null;
          s.pendingSeq = -1;
        }
        s.entry = null;
        const high = rollingHigh(s.closes, LOOKBACK);
        if (close <= high * (1 - DROP)) {
          let slice = state.cash;
          const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
          if (slice > byWeight) slice = byWeight;
          if (slice > 0n && slice >= BigInt(fees.min_notional_quote_units)) {
            orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
            s.pendingEntry = close;
            s.pendingSeq = state.seq;
          }
        }
      }
      if (orders.length >= caps.max_orders_per_bar) break;
    }
    return orders;
  },
});
