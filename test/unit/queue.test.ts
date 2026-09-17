import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AsyncQueue } from '../../src/lib/queue.js';

describe('AsyncQueue', () => {
  it('runs tasks with concurrency 1 in order', async () => {
    const queue = new AsyncQueue(1);
    const order: number[] = [];

    const p1 = queue.add(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      return 'a';
    });
    const p2 = queue.add(async () => {
      order.push(2);
      return 'b';
    });

    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a, 'a');
    assert.equal(b, 'b');
    assert.deepEqual(order, [1, 2]);
  });

  it('propagates task errors', async () => {
    const queue = new AsyncQueue(1);
    await assert.rejects(
      () =>
        queue.add(async () => {
          throw new Error('boom');
        }),
      /boom/,
    );
  });
});
