const vscode = acquireVsCodeApi()

const sections = [...document.querySelectorAll('section')]

const indexOf = (section) => Number(section.dataset.index)

// The extension remembers which steps are open, so a new tour starts with them all closed.
const opened = new Set(document.body.dataset.opened.split(' ').filter(Boolean).map(Number))

for (const section of sections) section.classList.toggle('open', opened.has(indexOf(section)))

function setOpen(section, open) {
  section.classList.toggle('open', open)

  if (open === opened.has(indexOf(section))) return

  if (open) opened.add(indexOf(section))
  else opened.delete(indexOf(section))
  vscode.postMessage({ opened: [...opened] })
}

document.addEventListener('click', (event) => {
  const section = event.target.closest('section')
  const more = event.target.closest('.more')

  if (more) {
    more.textContent = section.classList.toggle('expanded') ? 'Show less' : 'Show more'

    return
  }

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

  if (event.target.closest('.file') && section.classList.contains('open')) {
    vscode.postMessage({ go: indexOf(section) })

    return
  }

  const current = section.classList.contains('current')

  if (event.target.closest('.collapse')) {
    setOpen(section, false)

    if (current) vscode.postMessage({ unfocus: true })

    return
  }

  // Clicks inside the focused step don't focus it again, so reading never pulls the editor back.
  if (!current) {
    setOpen(section, true)
    vscode.postMessage({ go: indexOf(section) })
  }
})

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

if (typeof mermaid !== 'undefined') {
  const theme = document.body.classList.contains('vscode-light') ? 'neutral' : 'dark'
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
  mermaid.run().catch(() => {})
}

vscode.postMessage({ ready: true })
