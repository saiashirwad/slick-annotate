import * as v from 'valibot'

export const Index = v.pipe(v.number(), v.safeInteger(), v.minValue(0))

export const FilePath = v.pipe(
  v.string(),
  v.nonEmpty(),
  v.check(
    (file) => !/^(?:[/\\]|[a-z]:)/i.test(file) && !file.split(/[/\\]/).includes('..') && !file.includes('\0'),
    'Expected a file path inside the workspace',
  ),
)

export function errorMessage(cause: unknown) {
  if (v.isValiError(cause)) {
    return cause.issues.map((issue) => `${v.getDotPath(issue) ?? 'value'}: ${issue.message}`).join('; ')
  }

  return cause instanceof Error ? cause.message : String(cause)
}
