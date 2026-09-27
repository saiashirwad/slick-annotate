// The tour document in the sidebar: clicking a step goes to it, and the extension says which step is current.
const vscode = acquireVsCodeApi()

document.addEventListener('click', (event) => {
  const section = event.target.closest('section')
  const more = event.target.closest('.more')

  // "Show more" opens the step's longer explanation, without leaving the step.
  if (more) {
    more.textContent = section.classList.toggle('expanded') ? 'Show less' : 'Show more'

    return
  }

  // Links to code, `path/to/file` or `path/to/file#quoted code`, open it in the editor. Web links behave as usual.
  const anchor = event.target.closest('a')
  const href = anchor?.getAttribute('data-href') ?? anchor?.getAttribute('href')

  if (href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    event.preventDefault()
    const [file, quote] = href.split(/#(.*)/s)
    vscode.postMessage({
      open: quote === undefined ? decodeURI(file) : `${decodeURI(file)}#${decodeURIComponent(quote)}`,
    })

    return
  }

  if (!section || anchor || String(getSelection())) return

  // A collapsed step opens when clicked anywhere. The open one only goes back to its code from its file name,
  // so clicking around while reading doesn't pull the editor back.
  if (section.classList.contains('current') && !event.target.closest('.file')) return
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
