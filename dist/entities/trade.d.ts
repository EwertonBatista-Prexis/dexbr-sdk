import { Token } from 'entities/token';
import { TradeType } from '../constants';
import { TokenAmount } from './fractions';
import { Percent } from './fractions/percent';
import { Price } from './fractions/price';
import { Pair } from './pair';
import { Route } from './route';
interface InputOutput {
    readonly inputAmount: TokenAmount;
    readonly outputAmount: TokenAmount;
}
export declare function inputOutputComparator(a: InputOutput, b: InputOutput): number;
export declare function tradeComparator(a: Trade, b: Trade): number;
export interface BestTradeOptions {
    maxNumResults?: number;
    maxHops?: number;
}
export declare class Trade {
    readonly route: Route;
    readonly tradeType: TradeType;
    readonly inputAmount: TokenAmount;
    readonly outputAmount: TokenAmount;
    readonly executionPrice: Price;
    readonly nextMidPrice: Price;
    readonly slippage: Percent;
    constructor(route: Route, amount: TokenAmount, tradeType: TradeType, factoryAddress: string);
    minimumAmountOut(slippageTolerance: Percent): TokenAmount;
    maximumAmountIn(slippageTolerance: Percent): TokenAmount;
    static bestTradeExactIn(pairs: Pair[], amountIn: TokenAmount, tokenOut: Token, { maxNumResults, maxHops }: BestTradeOptions | undefined, currentPairs: Pair[] | undefined, originalAmountIn: TokenAmount | undefined, bestTrades: Trade[] | undefined, factoryAddress: string): Trade[];
    static bestTradeExactOut(pairs: Pair[], tokenIn: Token, amountOut: TokenAmount, { maxNumResults, maxHops }: BestTradeOptions | undefined, currentPairs: Pair[] | undefined, originalAmountOut: TokenAmount | undefined, bestTrades: Trade[] | undefined, factoryAddress: string): Trade[];
}
export {};
