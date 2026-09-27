import * as v from 'valibot'

export const Index = v.pipe(v.number(), v.safeInteger(), v.minValue(0))

// schemas/tour.schema.json repeats this check as a pattern; change both together.
export const FilePath = v.pipe(
  v.string(),
  v.nonEmpty(),
  v.check(
    (file) => !/^(?:[/\\]|[a-z]:)/i.test(file) && !file.split(/[/\\]/).includes('..') && !file.includes('\0'),
    'Expected a file path inside the workspace',
  ),
)
