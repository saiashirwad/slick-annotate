// A proposal's diff, read leniently: agents write unified diffs by hand, so file headers are optional and a line
// with no +, - or space in front is taken as context.
export type DiffLine = { kind: 'added' | 'removed' | 'context' | 'hunk'; text: string }

export function diffLines(diff: string): DiffLine[] {
  const lines = diff.replace(/\n$/, '').split('\n')
  let start = 0

  while (start < lines.length && /^(---|\+\+\+) /.test(lines[start])) start++

  return lines.slice(start).flatMap((line): DiffLine[] => {
    if (line.startsWith('\\')) return []

    if (line.startsWith('@@')) return [{ kind: 'hunk', text: line }]

    if (line.startsWith('+')) return [{ kind: 'added', text: line.slice(1) }]

    if (line.startsWith('-')) return [{ kind: 'removed', text: line.slice(1) }]

    return [{ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line }]
  })
}

// The code before and after the change, for VS Code's diff editor. Hunk headers belong to neither side.
export function diffSides(diff: string) {
  const lines = diffLines(diff)

  const side = (skip: DiffLine['kind']) =>
    lines.flatMap((line) => (line.kind === skip || line.kind === 'hunk' ? [] : [line.text])).join('\n')

  return { before: side('added'), after: side('removed') }
}
