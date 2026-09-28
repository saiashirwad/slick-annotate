import * as vscode from 'vscode'
import { join } from 'node:path'
import { errorMessage } from './errors.ts'
import { locate, type LineRange, type Located } from './locate.ts'
import { wholeLines } from './lines.ts'
import {
  diskText,
  prepareComparison,
  scopeComparison,
  scopedHunks,
  type FileComparison,
  type Version,
} from './walk-compare.ts'
import type { ComparisonState } from './walk-messages.ts'
import type { Walk } from './walk-data.ts'

export const revisionScheme = 'tandem-diff'

export type ResolvedPlace = {
  uri?: vscode.Uri
  range?: LineRange
  reason?: string
  comparison?: ComparisonState
  before?: vscode.Uri
  after?: vscode.Uri
  reveal?: LineRange
  beforeRange?: LineRange
}

export function versionUri(version: Version) {
  if (version.exists && 'disk' in version.endpoint) return vscode.Uri.file(version.endpoint.disk)
  const endpoint = version.endpoint
  const query = 'disk' in endpoint ? { empty: 'true' } : { ...endpoint, empty: String(!version.exists) }

  return vscode.Uri.from({
    scheme: revisionScheme,
    path: 'disk' in endpoint ? endpoint.disk : `/${endpoint.file}`,
    query: new URLSearchParams(query).toString(),
  })
}

export function documentRange(document: vscode.TextDocument, range?: LineRange) {
  if (!range) return
  const start = Math.min(range.start - 1, document.lineCount - 1)
  const end = Math.min(range.end - 1, document.lineCount - 1)

  return wholeLines(document, new vscode.Range(start, 0, end, document.lineAt(end).range.end.character))
}

export async function preparePlaces(root: string, walk: Walk) {
  const files = [...new Set(walk.steps.flatMap((step) => step.places.map((place) => place.file)))]
  let comparisons: Map<string, FileComparison> | undefined
  let comparisonProblem: string | undefined

  if (walk.compare) {
    try {
      comparisons = await prepareComparison(root, walk.compare, files)
    } catch (error) {
      comparisonProblem = errorMessage(error)
    }
  }

  const disk = new Map<string, string | undefined>()
  const problems = new Map<string, string>()

  if (!walk.compare || (comparisonProblem && walk.compare.head === undefined)) {
    await Promise.all(
      files.map(async (file) => {
        try {
          disk.set(file, await diskText(root, file))
        } catch (error) {
          problems.set(file, errorMessage(error))
        }
      }),
    )
  }

  const contents = new Map<string, string>()
  const matches = new Map<string, Map<string, Located>>()

  const found = (uri: vscode.Uri, text: string, quote: string | undefined) => {
    contents.set(uri.toString(), text)

    if (quote === undefined) return
    const key = uri.toString()

    if (!matches.has(key)) matches.set(key, new Map())
    const quotes = matches.get(key)!

    if (!quotes.has(quote)) quotes.set(quote, locate(text, quote))

    return quotes.get(quote)!
  }

  const places = new Map<string, ResolvedPlace[]>()

  for (const step of walk.steps) {
    places.set(
      step.id,
      step.places.map((place): ResolvedPlace => {
        const result = comparisons?.get(place.file)

        if (result?.file) {
          const file = result.file
          const before = versionUri(file.before)
          const after = versionUri(file.after)
          const oldQuote = found(before, file.before.text, place.quote)
          const newQuote = found(after, file.after.text, place.quote)
          const target = file.after.exists ? newQuote : oldQuote
          const changed = scopedHunks(file, oldQuote, newQuote)[0]
          const changedLine = changed && Math.max(1, changed.newStart)

          return {
            uri: file.after.exists ? after : before,
            range: target?.range,
            reason: quoteProblem(target),
            comparison: scopeComparison(file, oldQuote, newQuote),
            before,
            after,
            reveal: newQuote?.range ?? (changedLine ? { start: changedLine, end: changedLine } : undefined),
            beforeRange: oldQuote?.range,
          }
        }

        const text = disk.get(place.file)
        const uri = text === undefined ? undefined : vscode.Uri.file(join(root, place.file))
        const target = uri && text !== undefined ? found(uri, text, place.quote) : undefined
        const reason = result?.reason ?? comparisonProblem

        return {
          uri,
          range: target?.range,
          reason: uri ? quoteProblem(target) : (reason ?? problems.get(place.file) ?? 'File not found'),
          comparison: walk.compare
            ? { status: 'unavailable', reason: reason ?? 'Comparison unavailable', openable: false }
            : undefined,
        }
      }),
    )
  }

  return { places, contents }
}

function quoteProblem(found?: Located) {
  return found && !found.range ? (found.count ? `Quote matches ${found.count} places` : 'Quote not found') : undefined
}
