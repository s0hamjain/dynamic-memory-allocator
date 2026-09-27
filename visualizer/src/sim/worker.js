import { parseTrace } from './trace.js'
import { analyze, applyOp, transferList } from './replay.js'
import { Allocator } from './allocator.js'

/** Allocator throughput in ops/s: repeat the bare replay for at least ~80 ms. */
function throughput(trace) {
  let reps = 0
  const t0 = performance.now()
  let elapsed = 0
  do {
    const a = new Allocator()
    const ptr = new Float64Array(trace.numIds).fill(-1)
    for (let i = 0; i < trace.numOps; i++) applyOp(a, trace, ptr, i)
    reps++
    elapsed = performance.now() - t0
  } while (elapsed < 80 && reps < 2000)
  return (trace.numOps * reps) / (elapsed / 1000)
}

self.onmessage = ({ data: { text, name, token } }) => {
  try {
    const trace = parseTrace(text, name)
    const analysis = analyze(trace, (p) => self.postMessage({ token, progress: p }))
    analysis.throughput = throughput(trace)
    const buffers = transferList(analysis)
    buffers.push(trace.type.buffer, trace.id.buffer, trace.size.buffer)
    self.postMessage({ token, trace, analysis }, buffers)
  } catch (e) {
    self.postMessage({ token, error: e.message })
  }
}
