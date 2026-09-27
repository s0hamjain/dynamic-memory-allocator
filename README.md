# heapscope

Watch a malloc implementation work. The heap is a grid of cells, one per
16 bytes, in address order (left to right, top to bottom). Blocks flash as
they're allocated, freed and merged, and new rows appear as the heap grows.

```sh
cd visualizer
npm install
npm run dev
```

- **How it works** (where you land): a short walkthrough of a tiny program,
  one idea per step: malloc, free, reusing a hole, merging holes, growing
  the heap.
- **Programs**: replay real allocation traces, from a handful of mallocs to
  word-counting *Moby-Dick*, or drop in your own `.rep` file.
- **Playground**: drag a block onto the heap and watch it fly to wherever
  malloc puts it; swipe across blocks to free them; *Fill it up* and *Swiss
  cheese* for instant fragmentation.
- Two numbers: **utilization** (share of the heap holding real data) and
  **throughput** (allocator requests per second, measured in your browser).

The allocator in `visualizer/src/sim/allocator.js` is a JavaScript port of a
segregated-fit, best-fit allocator with 15 size classes, 16-byte mini blocks
and footerless allocated blocks. It returns the same addresses as the C
original on every trace.
