/**
 * Parser for malloc-lab .rep traces (see ../../traces/README).
 *
 *   <weight>\n<num_ids>\n<num_ops>\n<max_alloc>\n
 *   a <id> <bytes> | r <id> <bytes> | f <id>
 */

export const OP_ALLOC = 0
export const OP_FREE = 1
export const OP_REALLOC = 2
export const OP_CHAR = ['a', 'f', 'r']

// Keeps every heap offset well inside JavaScript's exact-integer range.
const MAX_SIZE = 2 ** 40

export function parseTrace(text, name = 'trace') {
  const lines = text.split(/\r?\n/)
  const header = []
  let i = 0
  while (header.length < 4 && i < lines.length) {
    const t = lines[i++].trim()
    if (!t) continue
    const v = Number(t)
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`${name}: line ${i}: expected a number in the header, found “${t}”`)
    }
    header.push(v)
  }
  if (header.length < 4) throw new Error(`${name}: header is incomplete (need 4 numbers)`)
  const [weight, numIds, numOps, maxAlloc] = header

  const type = new Uint8Array(numOps)
  const id = new Int32Array(numOps)
  const size = new Float64Array(numOps)
  let n = 0
  let maxId = -1
  for (; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) continue
    if (n >= numOps) throw new Error(`${name}: line ${i + 1}: more operations than the header's ${numOps}`)
    const parts = t.split(/\s+/)
    const c = parts[0]
    const ix = Number(parts[1])
    if (!Number.isInteger(ix)) throw new Error(`${name}: line ${i + 1}: bad id “${parts[1]}”`)
    if (c === 'a' || c === 'r') {
      const sz = Number(parts[2])
      if (!Number.isInteger(sz) || sz < 0) throw new Error(`${name}: line ${i + 1}: bad size “${parts[2]}”`)
      if (sz > MAX_SIZE) {
        throw new Error(`${name}: line ${i + 1}: ${parts[2]} bytes is too large to replay exactly (limit is 2^40 bytes)`)
      }
      type[n] = c === 'a' ? OP_ALLOC : OP_REALLOC
      size[n] = sz
    } else if (c === 'f') {
      type[n] = OP_FREE
    } else {
      throw new Error(`${name}: line ${i + 1}: unknown op “${c}” (expected a, r or f)`)
    }
    id[n] = ix
    if (ix > maxId) maxId = ix
    n++
  }
  if (n < numOps) throw new Error(`${name}: header promises ${numOps} ops but only ${n} were found`)

  return { name, weight, numIds: Math.max(numIds, maxId + 1), numOps, maxAlloc, type, id, size }
}
