import invariant from 'tiny-invariant'
import JSBI from 'jsbi'
import { getNetwork } from '@ethersproject/networks'
import { getDefaultProvider } from '@ethersproject/providers'
import { Contract } from '@ethersproject/contracts'
import { pack, keccak256 } from '@ethersproject/solidity'
import { getCreate2Address } from '@ethersproject/address'

import {
  BigintIsh,
  FACTORY_ADDRESS,
  INIT_CODE_HASH,
  MINIMUM_LIQUIDITY,
  ZERO,
  ONE,
  FIVE,
  _997,
  _1000
} from '../constants'
import IUniswapV2Pair from 'dexbr-v2-core/build/IUniswapV2Pair.json'
import { sqrt, parseBigintIsh } from '../utils'
import { InsufficientReservesError, InsufficientInputAmountError } from '../errors'
import { Token } from './token'
import { TokenAmount } from './fractions/tokenAmount'

let CACHE: { [token0Address: string]: { [token1Address: string]: string } } = {}

export class Pair {
  public readonly liquidityToken: Token
  private readonly tokenAmounts: [TokenAmount, TokenAmount]

  static getAddress(tokenA: Token, tokenB: Token, factoryAddress: string): string {
    const tokens = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA] // does safety checks

    if (CACHE?.[tokens[0].address]?.[tokens[1].address] === undefined) {
      CACHE = {
        ...CACHE,
        [tokens[0].address]: {
          ...CACHE?.[tokens[0].address],
          [tokens[1].address]: getCreate2Address(
            factoryAddress ? factoryAddress : FACTORY_ADDRESS,
            keccak256(['bytes'], [pack(['address', 'address'], [tokens[0].address, tokens[1].address])]),
            INIT_CODE_HASH
          )
        }
      }
    }

    return CACHE[tokens[0].address][tokens[1].address]
  }

  static async fetchData(
    tokenA: Token,
    tokenB: Token,
    factoryAddress: string,
    provider = getDefaultProvider(getNetwork(tokenA.chainId))
  ): Promise<Pair> {
    invariant(tokenA.chainId === tokenB.chainId, 'CHAIN_ID')
    const address = Pair.getAddress(tokenA, tokenB, factoryAddress ? factoryAddress : FACTORY_ADDRESS)
    const [reserves0, reserves1] = await new Contract(address, IUniswapV2Pair.abi, provider).getReserves()
    const balances = tokenA.sortsBefore(tokenB) ? [reserves0, reserves1] : [reserves1, reserves0]
    return new Pair(new TokenAmount(tokenA, balances[0]), new TokenAmount(tokenB, balances[1]), factoryAddress ? factoryAddress : FACTORY_ADDRESS)
  }

  constructor(tokenAmountA: TokenAmount, tokenAmountB: TokenAmount, factoryAddress: string) {
    const tokenAmounts = tokenAmountA.token.sortsBefore(tokenAmountB.token) // does safety checks
      ? [tokenAmountA, tokenAmountB]
      : [tokenAmountB, tokenAmountA]
    this.liquidityToken = new Token(
      tokenAmounts[0].token.chainId,
      Pair.getAddress(tokenAmounts[0].token, tokenAmounts[1].token, factoryAddress ? factoryAddress : FACTORY_ADDRESS),
      18,
      'UNI-V2',
      'Uniswap V2'
    )
    this.tokenAmounts = tokenAmounts as [TokenAmount, TokenAmount]
  }

  get token0(): Token {
    return this.tokenAmounts[0].token
  }

  get token1(): Token {
    return this.tokenAmounts[1].token
  }

  get reserve0(): TokenAmount {
    return this.tokenAmounts[0]
  }

  get reserve1(): TokenAmount {
    return this.tokenAmounts[1]
  }

  reserveOf(token: Token): TokenAmount {
    invariant(token.equals(this.token0) || token.equals(this.token1), 'TOKEN')
    return token.equals(this.token0) ? this.reserve0 : this.reserve1
  }

  getOutputAmount(inputAmount: TokenAmount, factoryAddress: string): [TokenAmount, Pair] {
    invariant(inputAmount.token.equals(this.token0) || inputAmount.token.equals(this.token1), 'TOKEN')
    if (JSBI.equal(this.reserve0.raw, ZERO) || JSBI.equal(this.reserve1.raw, ZERO)) {
      throw new InsufficientReservesError()
    }
    const inputReserve = this.reserveOf(inputAmount.token)
    const outputReserve = this.reserveOf(inputAmount.token.equals(this.token0) ? this.token1 : this.token0)
    const inputAmountWithFee = JSBI.multiply(inputAmount.raw, _997)
    const numerator = JSBI.multiply(inputAmountWithFee, outputReserve.raw)
    const denominator = JSBI.add(JSBI.multiply(inputReserve.raw, _1000), inputAmountWithFee)
    const outputAmount = new TokenAmount(
      inputAmount.token.equals(this.token0) ? this.token1 : this.token0,
      JSBI.divide(numerator, denominator)
    )
    if (JSBI.equal(outputAmount.raw, ZERO)) {
      throw new InsufficientInputAmountError()
    }
    return [outputAmount, new Pair(inputReserve.add(inputAmount), outputReserve.subtract(outputAmount), factoryAddress ? factoryAddress : FACTORY_ADDRESS)]
  }

  getInputAmount(outputAmount: TokenAmount, factoryAddress: string): [TokenAmount, Pair] {
    invariant(outputAmount.token.equals(this.token0) || outputAmount.token.equals(this.token1), 'TOKEN')
    if (
      JSBI.equal(this.reserve0.raw, ZERO) ||
      JSBI.equal(this.reserve1.raw, ZERO) ||
      JSBI.greaterThanOrEqual(outputAmount.raw, this.reserveOf(outputAmount.token).raw)
    ) {
      throw new InsufficientReservesError()
    }

    const outputReserve = this.reserveOf(outputAmount.token)
    const inputReserve = this.reserveOf(outputAmount.token.equals(this.token0) ? this.token1 : this.token0)
    const numerator = JSBI.multiply(JSBI.multiply(inputReserve.raw, outputAmount.raw), _1000)
    const denominator = JSBI.multiply(JSBI.subtract(outputReserve.raw, outputAmount.raw), _997)
    const inputAmount = new TokenAmount(
      outputAmount.token.equals(this.token0) ? this.token1 : this.token0,
      JSBI.add(JSBI.divide(numerator, denominator), ONE)
    )
    return [inputAmount, new Pair(inputReserve.add(inputAmount), outputReserve.subtract(outputAmount), factoryAddress ? factoryAddress : FACTORY_ADDRESS)]
  }

  getLiquidityMinted(totalSupply: TokenAmount, tokenAmountA: TokenAmount, tokenAmountB: TokenAmount): TokenAmount {
    invariant(totalSupply.token.equals(this.liquidityToken), 'LIQUIDITY')
    const tokenAmounts = tokenAmountA.token.sortsBefore(tokenAmountB.token) // does safety checks
      ? [tokenAmountA, tokenAmountB]
      : [tokenAmountB, tokenAmountA]
    invariant(tokenAmounts[0].token.equals(this.token0) && tokenAmounts[1].token.equals(this.token1), 'TOKEN')

    let liquidity: JSBI
    if (JSBI.equal(totalSupply.raw, ZERO)) {
      liquidity = JSBI.subtract(sqrt(JSBI.multiply(tokenAmounts[0].raw, tokenAmounts[1].raw)), MINIMUM_LIQUIDITY)
    } else {
      const amount0 = JSBI.divide(JSBI.multiply(tokenAmounts[0].raw, totalSupply.raw), this.reserve0.raw)
      const amount1 = JSBI.divide(JSBI.multiply(tokenAmounts[1].raw, totalSupply.raw), this.reserve1.raw)
      liquidity = JSBI.lessThanOrEqual(amount0, amount1) ? amount0 : amount1
    }
    if (!JSBI.greaterThan(liquidity, ZERO)) {
      throw new InsufficientInputAmountError()
    }
    return new TokenAmount(this.liquidityToken, liquidity)
  }

  getLiquidityValue(
    token: Token,
    totalSupply: TokenAmount,
    liquidity: TokenAmount,
    feeOn: boolean = false,
    kLast?: BigintIsh
  ): TokenAmount {
    invariant(token.equals(this.token0) || token.equals(this.token1), 'TOKEN')
    invariant(totalSupply.token.equals(this.liquidityToken), 'TOTAL_SUPPLY')
    invariant(liquidity.token.equals(this.liquidityToken), 'LIQUIDITY')
    invariant(JSBI.lessThanOrEqual(liquidity.raw, totalSupply.raw), 'LIQUIDITY')

    let totalSupplyAdjusted: TokenAmount
    if (!feeOn) {
      totalSupplyAdjusted = totalSupply
    } else {
      invariant(!!kLast, 'K_LAST')
      const kLastParsed = parseBigintIsh(kLast as any)
      if (!JSBI.equal(kLastParsed, ZERO)) {
        const rootK = sqrt(JSBI.multiply(this.reserve0.raw, this.reserve1.raw))
        const rootKLast = sqrt(kLastParsed)
        if (JSBI.greaterThan(rootK, rootKLast)) {
          const numerator = JSBI.multiply(totalSupply.raw, JSBI.subtract(rootK, rootKLast))
          const denominator = JSBI.add(JSBI.multiply(rootK, FIVE), rootKLast)
          const feeLiquidity = JSBI.divide(numerator, denominator)
          totalSupplyAdjusted = totalSupply.add(new TokenAmount(this.liquidityToken, feeLiquidity))
        } else {
          totalSupplyAdjusted = totalSupply
        }
      } else {
        totalSupplyAdjusted = totalSupply
      }
    }

    return new TokenAmount(
      token,
      JSBI.divide(JSBI.multiply(liquidity.raw, this.reserveOf(token).raw), totalSupplyAdjusted.raw)
    )
  }
}
