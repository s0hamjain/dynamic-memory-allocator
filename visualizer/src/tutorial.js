/**
 * The "how it works" walkthrough: a tiny scripted program run through the
 * real allocator, one idea per step. `focus` picks what the on-heap tag
 * points at after the step's ops run.
 */
export const STEPS = [
  {
    ops: [{ init: true }],
    text: 'This is the heap: memory a program can borrow. Each square is 16 bytes.',
  },
  {
    ops: [{ malloc: 100, as: 'a' }],
    text: 'malloc(100) asks for 100 bytes. The allocator finds room and marks it in use.',
    tag: 'malloc(100)',
  },
  {
    ops: [{ malloc: 200, as: 'b' }, { malloc: 60, as: 'c' }],
    text: 'More requests get packed right next to each other.',
    tag: 'malloc(60)',
  },
  {
    ops: [{ free: 'a' }],
    text: 'free() gives a block back. It becomes a hole that can be reused.',
    tag: 'free',
  },
  {
    ops: [{ malloc: 40, as: 'd' }],
    text: 'A small request fits in the hole, so no new memory is needed.',
    tag: 'malloc(40)',
  },
  {
    ops: [{ free: 'b' }],
    text: 'Holes that touch merge into one bigger hole.',
    tag: 'merged',
  },
  {
    ops: [{ malloc: 5000, as: 'e' }],
    text: "Nothing big enough? The heap grows to make room.",
    tag: 'malloc(5000)',
  },
  {
    ops: [],
    text: 'Utilization is how much of the heap holds real data. Throughput is how many requests it handles per second. Higher is better.',
    stats: true,
  },
]
