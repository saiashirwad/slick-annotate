import * as vscode from 'vscode'
import { diffLines } from './walk-diff.ts'
import type { Ref, Step } from './walk-data.ts'

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

// Walks are rendered by VS Code's built-in Markdown extension, whose mermaid support turns diagram fences into `.mermaid` elements.
async function renderMarkdown(text: string) {
  try {
    return await vscode.commands.executeCommand<string>('markdown.api.render', text)
  } catch (cause) {
    throw new Error("walks need VS Code's built-in Markdown extension, which isn't available", { cause })
  }
}

export async function renderStep(step: Step, index: number) {
  const file = step.file ? `<button class="file">${escape(step.file)}</button>` : ''
  const tag = step.proposal ? '<span class="proposal">Proposal</span>' : ''
  const refs = step.refs?.length ? `<div class="refs">${step.refs.map(link).join('')}</div>` : ''

  const [body, rendered] = await Promise.all([renderMarkdown(step.body), step.details && renderMarkdown(step.details)])

  const details = rendered ? `<div class="details">${rendered}</div>` : ''
  const more = details && '<button class="more">Show more</button>'
  const approve = step.proposal ? '<label class="approve"><input type="checkbox">Approve this change</label>' : ''

  return `<section data-id="${escape(step.id)}">
  <div class="head">
    <button class="collapse" title="Collapse"></button><h2><span class="number">${index + 1}</span>${escape(step.title)}</h2>
    <div class="meta">${file}${tag}<span class="response-mark" title="You responded"></span></div>
  </div>
  <div class="body">${body}${step.diff ? renderDiff(step.diff) : ''}${refs}${details}${more}
  <div class="review"><textarea class="response" rows="1" placeholder="Respond…" aria-label="Your response"></textarea>${approve}</div></div>
</section>`
}

// Drawn here rather than by the Markdown engine, so it can look like VS Code's inline diff: tinted lines, plain text.
// The indentation the lines share is dropped, and the rest becomes padding, so a wrapped line hangs under its own start.
function renderDiff(diff: string) {
  const signs = { added: '+', removed: '-', context: '', hunk: '' }
  const lines = diffLines(diff).map((line) => ({ ...line, indent: indentOf(line.text) }))
  const code = lines.filter((line) => line.kind !== 'hunk' && line.text.trim())
  const shared = Math.min(...code.map((line) => line.indent))

  const rows = lines.map(({ kind, text, indent }) => {
    const pad = kind === 'hunk' || !text.trim() ? 0 : indent - shared

    return `<div class="${kind}"><span class="sign">${signs[kind]}</span><span style="--indent: ${pad}">${escape(text.trimStart())}</span></div>`
  })

  return `<div class="diff">${rows.join('')}</div><button class="ref open-diff">Open diff</button>`
}

// In columns, with a tab as two.
function indentOf(text: string) {
  const [leading = ''] = text.match(/^[ \t]*/) ?? []

  return leading.replaceAll('\t', '  ').length
}

function link({ file, quote, label }: Ref) {
  const href = quote ? `${file}#${encodeURIComponent(quote)}` : file

  return `<a class="ref" href="${escape(href)}">${escape(label ?? file)}</a>`
}

export function page(
  webview: vscode.Webview,
  root: vscode.Uri,
  documentId: number,
  sections: string[],
  opened: string[],
  problems: string[],
) {
  const asset = (path: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, path))
  const notice = problems.map((problem) => `<p class="problem">${escape(problem)}</p>`).join('\n')
  const empty = problems.length ? '' : '<p class="empty">No walk yet. An agent writes one to .tandem/walk.json.</p>'
  const content = sections.length ? sections.join('\n') : empty
  // Mermaid draws its diagrams with inline styles, hence 'unsafe-inline' for styles only.
  const source = webview.cspSource
  const csp = `default-src 'none'; img-src ${source} data:; style-src ${source} 'unsafe-inline'; script-src ${source};`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${asset('media/walk.css')}">
</head>
<body data-document-id="${documentId}" data-opened="${escape(JSON.stringify(opened))}" data-mermaid="${asset('dist/mermaid.min.js')}">
${notice}
${content}
<script src="${asset('media/walk.js')}"></script>
</body>
</html>`
}
