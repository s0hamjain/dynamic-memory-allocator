/** Friendly names for the bundled malloc-lab traces. */
export const GROUPS = [
  {
    title: 'Start here',
    items: [
      ['syn-mix-short', 'A handful of mallocs'],
      ['ngram-fox1', 'The quick brown fox'],
      ['syn-string-short', 'A few strings'],
      ['syn-struct-short', 'A few structs'],
      ['syn-array-short', 'A few big arrays'],
      ['syn-mix-realloc', 'Growing with realloc'],
    ],
  },
  {
    title: 'Counting words',
    items: [
      ['ngram-gulliver1', "Gulliver's Travels"],
      ['ngram-gulliver2', "Gulliver's Travels II"],
      ['ngram-moby1', 'Moby-Dick'],
      ['ngram-shake1', 'Shakespeare'],
    ],
  },
  {
    title: 'Logic & puzzles',
    items: [
      ['bdd-nq7', 'Solving 7 queens'],
      ['bdd-aa4', 'Logic diagram, small'],
      ['bdd-ma4', 'Logic diagram, medium'],
      ['bdd-aa32', 'Logic diagram, large'],
      ['cbit-abs', 'Bit trick: abs'],
      ['cbit-parity', 'Bit trick: parity'],
      ['cbit-satadd', 'Bit trick: saturating add'],
      ['cbit-xyz', 'Bit trick: xyz'],
    ],
  },
  {
    title: 'Stress tests',
    items: [
      ['syn-array', 'Arrays'],
      ['syn-array-scaled', 'Arrays, scaled'],
      ['syn-string', 'Strings'],
      ['syn-string-scaled', 'Strings, scaled'],
      ['syn-struct', 'Structs'],
      ['syn-struct-scaled', 'Structs, scaled'],
      ['syn-mix', 'Everything mixed'],
      ['syn-mix-scaled', 'Everything mixed, scaled'],
    ],
  },
]

export const DEFAULT_PROGRAM = 'syn-mix-short'

const titles = new Map(GROUPS.flatMap((g) => g.items))
export const titleOf = (name) => titles.get(name) || name
