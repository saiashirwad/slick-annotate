// The tour document in the sidebar: clicking a step goes to it, and the extension says which step is current.
const vscode = acquireVsCodeApi()

document.addEventListener('click', (event) => {
  const section = event.target.closest('section')

  if (!section || event.target.closest('a') || String(getSelection())) return
  vscode.postMessage({ go: Number(section.dataset.index) })
})

// The step that opens stays where it was on screen; the page only scrolls when the step doesn't fit.
// `jump` (after a reload) puts it at the top straight away instead.
window.addEventListener('message', ({ data }) => {
  const sections = [...document.querySelectorAll('section')]
  const target = sections.find((section) => Number(section.dataset.index) === data.current)
  const before = target?.getBoundingClientRect().top

  for (const section of sections) section.classList.toggle('current', section === target)

  if (!target) return

  if (data.jump) return target.scrollIntoView({ block: 'start' })
  window.scrollBy(0, target.getBoundingClientRect().top - before)
  const { top, bottom, height } = target.getBoundingClientRect()

  if (top < 0 || height > innerHeight) target.scrollIntoView({ block: 'start', behavior: 'smooth' })
  else if (bottom > innerHeight) window.scrollBy({ top: bottom - innerHeight + 8, behavior: 'smooth' })
})

// VS Code's built-in mermaid extension renders diagram fences as `.mermaid` elements; mermaid is only loaded when there are any.
if (typeof mermaid !== 'undefined') {
  const theme = document.body.classList.contains('vscode-light') ? 'neutral' : 'dark'
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
  mermaid.run().catch(() => {})
}

vscode.postMessage({ ready: true })
