import * as vscode from 'vscode'
import type { Ref, Step } from './tour-data.ts'

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

// Tours are rendered by VS Code's built-in Markdown extension, whose mermaid support turns diagram fences into `.mermaid` elements.
async function renderMarkdown(text: string) {
  try {
    return await vscode.commands.executeCommand<string>('markdown.api.render', text)
  } catch (cause) {
    throw new Error("tours need VS Code's built-in Markdown extension, which isn't available", { cause })
  }
}

export async function renderStep(step: Step, index: number) {
  const file = step.file ? `<button class="file">${escape(step.file)}</button>` : ''
  const refs = step.refs?.length ? `<div class="refs">${step.refs.map(link).join('')}</div>` : ''
  const [body, rendered] = await Promise.all([renderMarkdown(step.body), step.details && renderMarkdown(step.details)])
  const details = rendered ? `<div class="details">${rendered}</div>` : ''
  const more = details && '<button class="more">Show more</button>'

  return `<section data-index="${index}">
  <div class="meta"><span class="number">${index + 1}</span>${file}<button class="collapse" title="Collapse"></button></div>
  <h2>${escape(step.title)}</h2>
  <div class="body">${body}${refs}${details}${more}</div>
</section>`
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
  opened: number[],
  problem: string | undefined,
) {
  const asset = (path: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, path))
  const notice = problem ? `<p class="problem">${escape(problem)}</p>` : ''
  const empty = problem ? '' : '<p class="empty">No tour yet. An agent writes one to .tandem/tour.json.</p>'
  const content = sections.length ? sections.join('\n') : empty
  // Mermaid draws its diagrams with inline styles, hence 'unsafe-inline' for styles only.
  const source = webview.cspSource
  const csp = `default-src 'none'; img-src ${source} data:; style-src ${source} 'unsafe-inline'; script-src ${source};`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${asset('media/tour.css')}">
</head>
<body data-document-id="${documentId}" data-opened="${opened.join(' ')}" data-mermaid="${asset('node_modules/mermaid/dist/mermaid.min.js')}">
${notice}
${content}
<script src="${asset('media/tour.js')}"></script>
</body>
</html>`
}
