// @ts-check
/** @typedef {import('../src/tour-messages.ts').FromPage} FromPage */
/** @typedef {import('../src/tour-messages.ts').ToPage} ToPage */

const vscode = acquireVsCodeApi()

const documentId = Number(document.body.dataset.documentId)

const sections = [...document.querySelectorAll('section')]

/** @param {HTMLElement} section */
const indexOf = (section) => Number(section.dataset.index)

/** @param {FromPage['action']} action */
const send = (action) => vscode.postMessage({ documentId, action })

// The extension owns which steps are open; this is only the first paint, before its first message.
const initiallyOpened = new Set((document.body.dataset.opened ?? '').split(' ').filter(Boolean).map(Number))

for (const section of sections) section.classList.toggle('open', initiallyOpened.has(indexOf(section)))

/** @param {string} href */
function codeLink(href) {
  const [file = '', quote] = href.split(/#(.*)/s)

  try {
    return { file: decodeURI(file), quote: quote === undefined ? undefined : decodeURIComponent(quote) }
  } catch {
    return undefined
  }
}

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return
  const section = event.target.closest('section')
  const more = event.target.closest('.more')

  if (more && section) {
    more.textContent = section.classList.toggle('expanded') ? 'Show less' : 'Show more'

    return
  }

  const anchor = event.target.closest('a')
  const href = anchor?.getAttribute('data-href') ?? anchor?.getAttribute('href')

  if (href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    event.preventDefault()
    const link = codeLink(href)

    if (link) send({ type: 'openCode', ...link })

    return
  }

  if (!section || anchor || String(getSelection())) return

  if (event.target.closest('.file') && section.classList.contains('open')) {
    return send({ type: 'focusStep', index: indexOf(section) })
  }

  if (event.target.closest('.collapse')) return send({ type: 'collapseStep', index: indexOf(section) })

  // Clicks inside the focused step don't focus it again, so reading never pulls the editor back.
  if (!section.classList.contains('current')) send({ type: 'focusStep', index: indexOf(section) })
})

window.addEventListener('message', (/** @type {MessageEvent<ToPage>} */ { data }) => {
  const target = sections.find((section) => indexOf(section) === data.focusedStep)
  const before = target?.getBoundingClientRect().top ?? 0
  const opened = new Set(data.opened)

  for (const section of sections) {
    section.classList.toggle('current', section === target)
    section.classList.toggle('open', opened.has(indexOf(section)))
  }

  if (!target) return

  if (data.scroll === 'reveal') return target.scrollIntoView({ block: 'start' })
  window.scrollBy(0, target.getBoundingClientRect().top - before)
  const { top, bottom, height } = target.getBoundingClientRect()

  if (top < 0 || height > innerHeight) target.scrollIntoView({ block: 'start', behavior: 'smooth' })
  else if (bottom > innerHeight) window.scrollBy({ top: bottom - innerHeight + 8, behavior: 'smooth' })
})

/** @param {string} message */
function reportProblem(message) {
  const notice = document.createElement('p')
  notice.className = 'problem'
  notice.textContent = message
  document.body.prepend(notice)
}

// Mermaid is large, so it's loaded only when the rendered Markdown contains a diagram.
if (document.querySelector('.mermaid')) {
  const script = document.createElement('script')
  script.src = document.body.dataset.mermaid ?? ''
  script.onerror = () => reportProblem("Can't load mermaid, so diagrams show as text.")

  script.onload = () => {
    const theme = document.body.classList.contains('vscode-light') ? 'neutral' : 'dark'
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
    mermaid
      .run()
      .catch((error) => reportProblem(`Can't draw a diagram: ${error instanceof Error ? error.message : error}`))
  }

  document.body.append(script)
}

send({ type: 'ready' })
