import { extname } from 'node:path'
import type { Range, Session } from './session.ts'

export function formatSession(session: Session) {
  const printedThreads = new Set<string>()
  const blocks: string[] = []

  for (const annotation of session.annotations) {
    const parts = [`## ${annotation.file}${annotation.range ? `:${lines(annotation.range)}` : ''}`]

    if (annotation.range && !printedThreads.has(annotation.threadId)) {
      parts.push(fenced(annotation.snippet, extname(annotation.file).slice(1)))
    }

    parts.push(annotation.body)
    blocks.push(parts.filter(Boolean).join('\n\n'))
    printedThreads.add(annotation.threadId)
  }

  return blocks.join('\n\n')
}

function fenced(code: string, language: string) {
  if (!code) return ''
  let fence = '```'

  while (code.includes(fence)) fence += '`'

  return `${fence}${language}\n${code}${code.endsWith('\n') ? '' : '\n'}${fence}`
}

function lines({ start, end }: Range) {
  return start.line === end.line ? `${start.line + 1}` : `${start.line + 1}-${end.line + 1}`
}
