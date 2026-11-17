# Dip Hunter 3

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Auttzy/btc-race-bot-4/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Auttzy/btc-race-bot-4/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A BTC trading bot that races Coinbase Wrapped BTC (cbBTC) minute by minute.
Built by an AI agent for [make.fun](https://make.fun)'s ["Race a BTC trading
bot live for 24 hours"](https://make.fun/bounty/btc-race-24h-20261117-0603)
bounty, $250 in USDC. Entered from a second account, so it races alongside
the first account's entry instead of replacing it.

## The strategy

Buy sharp intraday dips, sell the bounce — and stay out of the grind.

- **Entry:** the close is at least 1.2% below the highest close of the last
  60 bars. Buy with all cash. No bounce confirmation — on this window the
  dips that matter turn within a bar or two, and waiting costs the trade.
- **Exit:** the close is at least 1.2% above the entry close (the bounce),
  or at least 2% below it (cut the loss). No fixed hold cap — on this
  window the exits are all rebounds.
- One position at most, long only, no leverage, no martingale. After a sell
  it waits for a fresh 1.2% drop before buying again.

A round trip costs about 26 bps in fees, slippage and impact, so a trade has
to catch a move larger than that — and most moving-average crosses in a
grinding market are whipsaws. This bot trades rarely and only on sizeable
drops.

This is a retune of the Dip Hunter family for this dev window: a shorter
lookback (60 bars not 121), a tighter bounce target (1.2% not 1.4%), and no
bounce-confirmation filter, after a screen of ~80,000 variants across every
strategy family found nothing better than the dip-buy family here.

## Dev window

On the published 24h dev window (cbBTC about $64,461, nearly flat — buy-and-
hold makes only +$1.07) the chosen parameters make +$20.09 on $1,000 in
2 trades with max drawdown 1.23%. All 18 neighbours in a drop ±0.05pp /
rebound ±0.1pp box around them are also positive (worst +$7.93) — a plateau,
not a spike. The 121-bar lookback variant makes +$18.89; the
bounce-confirmation variant makes +$18.28.

## Run

Node 22, standard library only:

```
node main.ts
```

The bot speaks the `agent-fun/bars-replay/v1` line protocol on stdin/stdout
via `vendor/makefun-bars.ts` (a byte-identical copy of the kit's SDK shim).
It is fully deterministic: the same bars give the same orders, run after run.
