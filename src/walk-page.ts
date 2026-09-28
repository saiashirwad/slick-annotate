import * as vscode from 'vscode'
import type { Step } from './walk-data.ts'

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

// Walks are rendered by VS Code's built-in Markdown extension, whose mermaid support turns diagram fences into `.mermaid` elements.
async function renderMarkdown(text: string) {
  try {
    return await vscode.commands.executeCommand<string>('markdown.api.render', text)
  } catch (cause) {
    throw new Error("walks need VS Code's built-in Markdown extension, which isn't available", { cause })
  }
}

export async function renderStep(step: Step, index: number, check?: string, compare = false) {
  const places = step.places
    .map(
      (place, index) =>
        `<div class="place" data-place="${index}"><button class="place-link" title="${escape(place.file)}" disabled>${escape(place.label ?? place.file)}</button><span class="place-status"></span>${compare ? '<span class="comparison">Preparing comparison…</span><button class="open-diff" hidden>Open diff</button>' : ''}</div>`,
    )
    .join('')

  const [body, rendered] = await Promise.all([renderMarkdown(step.body), step.details && renderMarkdown(step.details)])

  const details = rendered ? `<div class="details">${rendered}</div>` : ''
  const more = details && '<button class="more">Show more</button>'
  const checkbox = check === undefined ? '' : `<label class="check"><input type="checkbox">${escape(check)}</label>`

  return `<section data-id="${escape(step.id)}">
  <div class="head">
    <button class="collapse" title="Collapse"></button><h2><span class="number">${index + 1}</span>${escape(step.title)}</h2>
    <div class="meta"><span class="check-mark" title="Checked">✓</span><span class="note-mark" title="You wrote a note">✎</span></div>
  </div>
  <div class="body">${body}<div class="places">${places}</div>${compare && places ? '<p class="comparison-help">Counts refresh when the walk reloads. Open diff shows the full files.</p>' : ''}${details}${more}
  <div class="review"><textarea class="note" rows="1" placeholder="Write a note…" aria-label="Your note"></textarea>${checkbox}</div></div>
</section>`
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
