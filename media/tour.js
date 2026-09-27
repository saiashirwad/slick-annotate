// The tour document in the sidebar. Any number of steps can be open; one of them, at most, is focused (its code is
// highlighted). The extension decides which step is focused and tells this page.
const vscode = acquireVsCodeApi()
const sections = [...document.querySelectorAll('section')]
const indexOf = (section) => Number(section.dataset.index)

// Which steps are open survives the view being hidden and redrawn.
const opened = new Set(vscode.getState()?.opened ?? [])
for (const section of sections) section.classList.toggle('open', opened.has(indexOf(section)))

function setOpen(section, open) {
  section.classList.toggle('open', open)

  if (open) opened.add(indexOf(section))
  else opened.delete(indexOf(section))
  vscode.setState({ opened: [...opened] })
}

document.addEventListener('click', (event) => {
  const section = event.target.closest('section')
  const more = event.target.closest('.more')

  // "Show more" unfolds the step's longer explanation.
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

  // An open step's file name focuses it.
  if (event.target.closest('.file') && section.classList.contains('open')) {
    vscode.postMessage({ go: indexOf(section) })

    return
  }

  const current = section.classList.contains('current')

  // The collapse button closes a step, dropping focus if it had it.
  if (event.target.closest('.collapse')) {
    setOpen(section, false)

    if (current) vscode.postMessage({ unfocus: true })

    return
  }

  // Any other click focuses the step (opening it if closed), except in the step that's already focused, so reading
  // never pulls the editor back.
  if (!current) {
    setOpen(section, true)
    vscode.postMessage({ go: indexOf(section) })
  }
})

// The focused step opens and stays where it was on screen; the page only scrolls when it doesn't fit.
// `jump` (after a reload) puts it at the top straight away instead.
window.addEventListener('message', ({ data }) => {
  const target = sections.find((section) => indexOf(section) === data.current)
  const before = target?.getBoundingClientRect().top

  for (const section of sections) section.classList.toggle('current', section === target)

  if (!target) return
  setOpen(target, true)

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
