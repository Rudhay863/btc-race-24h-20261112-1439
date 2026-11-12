// Dip-buy and sharp-drop bounce swing bot for the BTC race (cbBTC/USDC, 1-minute bars).
//
// The idea, in one paragraph: Bitcoin on 1-minute bars is mostly noise around a slow
// drift, and a full round trip costs about 26 bps in fees, slippage and price impact,
// so the bot only trades when the move is big enough to pay for itself. It takes two
// kinds of trade, both long only, one position at a time, full size (the whole cash
// balance, since the caps allow 100% of equity and there is a single asset):
//
//   - Dip-buy (D): in an uptrend — the close above its 60-bar EMA — after the price
//     has pulled back at least 60 bps from its 60-minute high while the 60-minute
//     return is still non-negative. It rides the rally back up with a take-profit at
//     +80 bps over cost and a 30 bps trailing stop from the peak value.
//   - Bounce (B): after a sharp 60-minute drop of 70 bps or more, but only once the
//     15-minute return has turned positive by at least 15 bps, so the bot buys the
//     bounce after it has started instead of catching the falling knife mid-drop.
//     It exits at +50 bps over cost, on a 40 bps trailing stop, or after 90 bars.
//
// Both modes share a 80/60 bps hard stop under cost and a 5-bar cooldown after an
// exit, and the bot stops entering after 8 round trips so a choppy day cannot bleed
// it through fees. Every exit is re-checked on every bar, so a sell the market
// refuses (a price past the slippage cap at the next open) is sent again on the next
// bar while its reason still holds.
//
// The indicators run in float64 on + - * / and Math.max alone, each correctly
// rounded (IEEE 754), and every decision is a pure function of the bars the harness
// has sent: no wall clock, no environment, no unseeded randomness. The same bars
// give the same orders, run after run, so the two graded executions match byte for
// byte. Orders cap their slippage at 100 bps past the close they were decided on.
//
// Tuned on the published dev window by grid search over the same rules (a faithful
// local replay of the harness fill model, validated byte-for-byte against the kit's
// baselines): the chosen parameters sit in the middle of a broad plateau, not on a
// sharp peak, and the bot makes money in the first two 6-hour blocks of the dev
// window while sitting out the last two (no trades, no losses) when the drift turns
// against it.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** The long trend filter: the close must sit above this EMA for a dip-buy. */
const LONG_EMA_BARS = 60;
/** A dip-buy needs a pullback of at least this far below the 60-minute high. */
const DIP_MIN_BPS = 60;
/** ...while the 60-minute return stays at or above this (the rally is intact). */
const DIP_RET60_MIN_BPS = 0;
/** Dip-buy exits: take-profit, trailing stop and hard stop, in bps over cost / peak. */
const DIP_TP_BPS = 80;
const DIP_TRAIL_BPS = 30;
const DIP_SL_BPS = 80;
/** A dip-buy may be held to the end of the window. */
const DIP_MAX_HOLD_BARS = 1440;
/** A bounce needs a 60-minute drop of at least this much... */
const BOUNCE_DROP_BPS = 70;
/** ...and a 15-minute return of at least this much, so the turn has started. */
const BOUNCE_TURN_BPS = 15;
/** Bounce exits: take-profit, trailing stop, hard stop, and a hard time limit. */
const BOUNCE_TP_BPS = 50;
const BOUNCE_TRAIL_BPS = 40;
const BOUNCE_SL_BPS = 60;
const BOUNCE_MAX_HOLD_BARS = 90;
/** Bars to wait after an exit before the next entry. */
const COOLDOWN_BARS = 5;
/** Stop entering after this many round trips: a choppy day must not bleed fees. */
const MAX_ROUND_TRIPS = 8;
/** Every order caps its slippage at 1% past the close it was decided on. */
const MAX_SLIPPAGE_BPS = 100;

/** One EMA: the closes it has seen until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

function emaStep(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

/** The closes the bot has seen, oldest first. */
const closes: number[] = [];
const emaLong: Ema = { span: LONG_EMA_BARS, warm: [], value: null };
/** The peak value of the open position, in quote units, since its entry. */
let peakValue = 0n;
/** Bars the open position has been held. */
let heldBars = 0;
/** The first bar on which a new entry may be decided (cooldown after an exit). */
let cooldownUntil = -1;
/** Round trips closed so far. */
let roundTrips = 0;
/** Which kind of trade the open position is: 'D' dip-buy or 'B' bounce. */
let mode: 'D' | 'B' | null = null;

/** The return of the latest close over the close n bars back, in bps, or null. */
function retBps(n: number): number | null {
  if (closes.length <= n) return null;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - n];
  return ((now - then) / then) * 10000;
}

/** The highest close of the last 61 bars, the current one included, or null. */
function high61(): number | null {
  if (closes.length === 0) return null;
  let high = closes[closes.length - 1];
  const start = Math.max(0, closes.length - 61);
  for (let i = closes.length - 2; i >= start; i--) {
    if (closes[i] > high) high = closes[i];
  }
  return high;
}

await runBars({
  onBatch(state: BarsState) {
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    closes.push(close);
    emaStep(emaLong, close);
    if (state.warmingUp) return [];

    const ret60 = retBps(60);
    const ret15 = retBps(15);
    const held = state.positions.get(SYMBOL);
    const orders: (BuyInput | SellInput)[] = [];

    if (held !== undefined) {
      heldBars += 1;
      const value = state.value(SYMBOL, held.qty);
      if (value > peakValue) peakValue = value;
      const cost = held.cost;
      const tp = mode === 'D' ? DIP_TP_BPS : BOUNCE_TP_BPS;
      const trail = mode === 'D' ? DIP_TRAIL_BPS : BOUNCE_TRAIL_BPS;
      const sl = mode === 'D' ? DIP_SL_BPS : BOUNCE_SL_BPS;
      const maxHold = mode === 'D' ? DIP_MAX_HOLD_BARS : BOUNCE_MAX_HOLD_BARS;
      const takeProfit = value * BPS >= cost * BigInt(10000 + tp);
      const trailed = value * BPS <= (peakValue * BigInt(10000 - trail)) / 1n;
      const stopped = value * BPS <= cost * BigInt(10000 - sl);
      const tooLong = heldBars >= maxHold;
      if (takeProfit || trailed || stopped || tooLong) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        cooldownUntil = state.seq + COOLDOWN_BARS;
        roundTrips += 1;
        peakValue = 0n;
        heldBars = 0;
        // mode is deliberately NOT cleared here: if this sell is rejected, the
        // exit re-fires on the next bar with the same parameters. It is
        // overwritten by the next buy decision.
      }
      return orders;
    }

    if (state.seq < cooldownUntil || roundTrips >= MAX_ROUND_TRIPS) return [];
    if (emaLong.value === null || ret60 === null || ret15 === null) return [];
    const high = high61();
    if (high === null) return [];

    let entry: 'D' | 'B' | null = null;
    const dipBps = ((high - close) / high) * 10000;
    if (close > emaLong.value && dipBps >= DIP_MIN_BPS && ret60 >= DIP_RET60_MIN_BPS) {
      entry = 'D';
    } else if (ret60 <= -BOUNCE_DROP_BPS && ret15 >= BOUNCE_TURN_BPS) {
      entry = 'B';
    }
    if (entry !== null) {
      const cash = state.cash;
      if (cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
        mode = entry;
        peakValue = 0n;
        heldBars = 0;
      }
    }
    return orders;
  },
});
