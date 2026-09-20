import { expect, it } from 'vitest';
import { paperMarket } from '../src/paper.js';
import { nextAction } from '../src/portfolio.js';
import { config } from './fixtures.js';
it('takes one coherent snapshot even if the clock advances while producing holdings', async () => {
  let now = 1000;
  const s = await paperMarket(config, () => ++now).snapshot('0x0000000000000000000000000000000000000001');
  expect(() => nextAction(config.strategy, s)).not.toThrow();
  expect(s.holdings.every(h => h.observedAt <= s.now)).toBe(true);
});
