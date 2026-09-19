import { createWalletClient, decodeFunctionData, encodeFunctionData, erc20Abi, http, keccak256, type LocalAccount } from 'viem';
import { assets } from './assets.js';
import { chainDefinition, createRpc } from './rpc.js';
import { ROUTER, routerCode, swapAbi, type SwapPort } from './swap.js';
import { requireTradingChain } from './config.js';
import { createTransactionRunner, type TransactionPort } from './transaction.js';
import type { Store } from './state.js';
import type { Asset, Config, TradingChain } from './types.js';
type Gate = { native(): Promise<bigint>; nonces(): Promise<[number, number]>; owner(): Promise<void>; balance(): Promise<bigint> };
export async function signingGate<T>(request: { gas?: bigint; gasPrice?: bigint; maxFeePerGas?: bigint; nonce?: number }, io: Gate, spend: bigint, sign: () => Promise<T>): Promise<T> {
  const fee = request.gasPrice ?? request.maxFeePerGas;
  if (!fee || fee <= 0n || !request.gas || request.gas <= 0n) throw new Error('INVALID_GAS');
  if (await io.native() < request.gas * fee * 2n) throw new Error('INSUFFICIENT_GAS');
  const [latest, pending] = await io.nonces();
  if (latest !== pending || request.nonce !== pending) throw new Error('NONCE_CONFLICT');
  if (await io.balance() < spend) throw new Error('INSUFFICIENT_BALANCE');
  await io.owner();
  return sign();
}
export function createChain(config: Config, account: LocalAccount, store: Store, guard: () => Promise<void>, event?: Parameters<typeof createTransactionRunner>[2]) {
  const rpc = (chain: TradingChain) => createRpc(config, requireTradingChain(chain));
  const balance = (asset: Asset) => rpc(asset.chainId).readContract({ address: asset.address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  const transport: TransactionPort = {
    async sign(call) {
      const client = rpc(call.chainId);
      if (await client.getChainId() !== call.chainId) throw new Error('RPC_CHAIN_MISMATCH');
      // The signing boundary independently identifies the exact token debit for a fresh balance check.
      let source: Asset | undefined, spend = 0n;
      if (call.to.toLowerCase() === ROUTER) {
        const decoded = decodeFunctionData({ abi: swapAbi, data: call.data });
        source = assets.find(a => a.chainId === call.chainId && a.address === decoded.args[1].srcToken.toLowerCase()); spend = decoded.args[1].amount;
      } else {
        const approval = decodeFunctionData({ abi: erc20Abi, data: call.data });
        if (approval.functionName !== 'approve' || approval.args[0].toLowerCase() !== ROUTER) throw new Error('UNSAFE_TRANSACTION');
        source = assets.find(a => a.chainId === call.chainId && a.address === call.to.toLowerCase()); spend = approval.args[1];
      }
      if (!source || call.value !== 0n) throw new Error('UNSAFE_TRANSACTION');
      const wallet = createWalletClient({ account, chain: chainDefinition(call.chainId, config.rpcUrls[call.chainId]), transport: http(config.rpcUrls[call.chainId], { retryCount: 0, timeout: 10000 }) });
      const request = await wallet.prepareTransactionRequest({ to: call.to, data: call.data, value: call.value });
      return signingGate(request, {
        native: () => client.getBalance({ address: account.address }),
        nonces: async () => [await client.getTransactionCount({ address: account.address, blockTag: 'latest' }), await client.getTransactionCount({ address: account.address, blockTag: 'pending' })],
        balance: () => balance(source!), owner: guard,
      }, spend, () => wallet.signTransaction(request));
    },
    async broadcast(chain, raw) {
      const client = rpc(chain);
      if (await client.getChainId() !== chain) throw new Error('RPC_CHAIN_MISMATCH');
      return client.sendRawTransaction({ serializedTransaction: raw });
    },
    async receipt(chain, hash) {
      const client = rpc(chain);
      if (await client.getChainId() !== chain) throw new Error('RPC_CHAIN_MISMATCH');
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        if ((await client.getBlockNumber()) < receipt.blockNumber + 1n) return undefined;
        return receipt.status;
      } catch { return undefined; }
    },
  };
  const runner = createTransactionRunner(store, transport, event);
  const port: SwapPort = {
    balance, guard, send: runner.send,
    async verifyRouter(chain) {
      const client = rpc(chain);
      if (await client.getChainId() !== chain) throw new Error('RPC_CHAIN_MISMATCH');
      const code = await client.getBytecode({ address: ROUTER });
      if (!code || keccak256(code) !== routerCode[chain]) throw new Error('ROUTER_CODE_MISMATCH');
    },
    allowance: asset => rpc(asset.chainId).readContract({ address: asset.address, abi: erc20Abi, functionName: 'allowance', args: [account.address, ROUTER] }),
    approve: (asset, amount) => runner.send({ chainId: asset.chainId, to: asset.address, value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER, amount] }) }),
  };
  return { port, runner, rpc };
}
