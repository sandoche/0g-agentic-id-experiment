import { expect, it, vi } from 'vitest';
import { createWorker } from '../src/worker.js';
import { config, snapshot } from './fixtures.js';
import type { Journal, Store } from '../src/state.js';
import type { Address } from '../src/types.js';
const wallet = '0x1111111111111111111111111111111111111111';
function setup() {
  let journal: Journal = { version: 1, wallet, owner: wallet, sequence: 0 };
  const store: Store = { load: async () => structuredClone(journal), save: async j => { journal = structuredClone(j); }, lock: async () => {}, close: async () => {} };
  const market = { preflight: vi.fn(async () => {}), tradable: async () => true, snapshot: vi.fn(async () => snapshot(0n, 0n, 0n, 0n, 100n)) };
  const execute = vi.fn(async () => 'settled' as const), reconcile = vi.fn(async () => 'pending' as const), readOwner = vi.fn(async (): Promise<Address> => wallet);
  const cfg = structuredClone(config);
  const worker = createWorker(cfg, market, { execute, reconcile }, store, readOwner, async () => {});
  return { worker, store, market, execute, reconcile, readOwner, cfg };
}
it('runs at five minutes without overlapping or signing in simulation', async () => {
  vi.useFakeTimers();
  const s = setup(); await s.worker.configure({ oneinch: 'synthetic', mode: 'simulation' }, wallet);
  s.worker.start(); await vi.advanceTimersByTimeAsync(299999); expect(s.market.snapshot).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(s.market.snapshot).toHaveBeenCalledTimes(1); expect(s.execute).not.toHaveBeenCalled();
  expect((await s.store.load()).paper).toBeDefined(); await s.worker.stop();
  await vi.advanceTimersByTimeAsync(300000); expect(s.market.snapshot).toHaveBeenCalledTimes(1); vi.useRealTimers();
});
it('reconciles pending execution before obtaining any new snapshot', async () => {
  const s = setup(); await s.worker.configure({ oneinch: 'synthetic', mode: 'live' }, wallet);
  const j = await s.store.load(); j.pending = { kind: 'fusion', id: 'pending', payload: {} }; await s.store.save(j);
  await s.worker.tick(); expect(s.reconcile).toHaveBeenCalledOnce(); expect(s.market.snapshot).not.toHaveBeenCalled(); expect(s.execute).not.toHaveBeenCalled();
});
it('never resumes live pending execution when configured for simulation', async () => {
  const s = setup(); await s.worker.configure({ oneinch: 'synthetic', mode: 'simulation' }, wallet);
  const j = await s.store.load(); j.pending = { kind: 'fusion', id: 'pending', payload: {} }; await s.store.save(j);
  await s.worker.tick();
  expect(s.reconcile).not.toHaveBeenCalled(); expect(s.execute).not.toHaveBeenCalled();
  expect((await s.store.load()).pending?.id).toBe('pending'); expect(s.worker.status().state).toBe('pending');
});
it('erases keys and pauses on owner transfer; price errors do not kill later cycles', async () => {
  const s = setup(); await s.worker.configure({ oneinch: 'synthetic', mode: 'live' }, wallet);
  s.market.snapshot.mockRejectedValueOnce(new Error('private error'));
  await s.worker.tick(); await s.worker.tick(); expect(s.execute).toHaveBeenCalledOnce();
  s.readOwner.mockResolvedValue('0x2222222222222222222222222222222222222222' as typeof wallet);
  await s.worker.tick(); expect(s.cfg.credentials.oneinch).toBeUndefined(); expect(s.worker.status().state).toBe('paused');
  expect(JSON.stringify(s.worker.events(0))).not.toContain('private error');
});
it('ignores overlapping ticks and checks stop again after the market read', async () => {
  const s = setup(); await s.worker.configure({ oneinch: 'synthetic', mode: 'live' }, wallet);
  let release!: () => void;
  s.market.snapshot.mockImplementationOnce(async () => { await new Promise<void>(r => { release = r; }); return snapshot(0n, 0n, 0n, 0n, 100n); });
  const first = s.worker.tick(); await vi.waitFor(() => expect(release).toBeDefined());
  await s.worker.tick(); await s.worker.stop();
  let drained = false; const drain = s.worker.drain().then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false); release(); await first; await drain; expect(drained).toBe(true);
  expect(s.market.snapshot).toHaveBeenCalledOnce(); expect(s.execute).not.toHaveBeenCalled();
});
it('a completed stop invalidates an earlier configuration still awaiting preflight', async () => {
  const s = setup(); let release!: () => void;
  s.market.preflight.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
  const configure = s.worker.configure({ oneinch: 'synthetic', mode: 'live' }, wallet);
  const failed = expect(configure).rejects.toThrow('NOT_CONFIGURED');
  await vi.waitFor(() => expect(release).toBeDefined()); await s.worker.stop(); release(); await failed;
  expect(s.worker.status().state).toBe('stopped'); expect(s.cfg.credentials.oneinch).toBeUndefined();
  await s.worker.tick(); expect(s.execute).not.toHaveBeenCalled();
});
