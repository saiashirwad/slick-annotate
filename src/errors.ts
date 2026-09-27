import * as v from 'valibot'

export function errorMessage(cause: unknown) {
  if (v.isValiError(cause)) {
    return cause.issues.map((issue) => `${v.getDotPath(issue) ?? 'value'}: ${issue.message}`).join('; ')
  }

  return cause instanceof Error ? cause.message : String(cause)
}
