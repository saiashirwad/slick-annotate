// @ts-check
/** @typedef {import('../src/walk-messages.ts').FromPage} FromPage */
/** @typedef {import('../src/walk-messages.ts').ToPage} ToPage */

const vscode = acquireVsCodeApi()

const documentId = Number(document.body.dataset.documentId)

const sections = [...document.querySelectorAll('section')]

/** @param {HTMLElement} section */
const idOf = (section) => section.dataset.id ?? ''

/** @param {FromPage['action']} action */
const send = (action) => vscode.postMessage({ documentId, action })

// The extension owns which steps are open; this is only the first paint, before its first message.
/** @type {string[]} */
const initiallyOpened = JSON.parse(document.body.dataset.opened ?? '[]')

for (const section of sections) section.classList.toggle('open', initiallyOpened.includes(idOf(section)))

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

  const row = event.target.closest('.place')

  if (row instanceof HTMLElement && section) {
    const place = Number(row.dataset.place)

    if (event.target.closest('.open-diff')) return send({ type: 'openDiff', id: idOf(section), place })

    if (event.target.closest('.place-link')) return send({ type: 'openPlace', id: idOf(section), place })

    return
  }

  // The checkbox reports itself through 'change'; clicking it shouldn't also move the editor.
  if (event.target.closest('.review')) return

  const anchor = event.target.closest('a')
  const href = anchor?.getAttribute('data-href') ?? anchor?.getAttribute('href')

  if (href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    event.preventDefault()
    const link = codeLink(href)

    if (link) send({ type: 'openCode', ...link })

    return
  }

  if (!section || anchor || String(getSelection())) return
  const id = idOf(section)

  if (event.target.closest('.collapse') && section.classList.contains('open')) return send({ type: 'collapseStep', id })

  // Clicks inside the focused step don't focus it again, so reading never pulls the editor back.
  if (!section.classList.contains('current')) send({ type: 'focusStep', id })
})

document.addEventListener('change', ({ target }) => {
  const section = target instanceof HTMLInputElement && target.closest('section')

  if (section) send({ type: 'setCheck', id: idOf(section), ok: target.checked })
})

document.addEventListener('input', ({ target }) => {
  if (!(target instanceof HTMLTextAreaElement)) return
  const section = target.closest('section')

  if (section) send({ type: 'setText', id: idOf(section), text: target.value })
})

window.addEventListener('message', (/** @type {MessageEvent<ToPage>} */ { data }) => {
  const target = sections.find((section) => idOf(section) === data.focusedStep)
  const before = target?.getBoundingClientRect().top ?? 0
  const opened = new Set(data.opened)
  const places = new Map(data.places.map(({ id, items }) => [id, items]))

  for (const section of sections) {
    const id = idOf(section)
    const input = section.querySelector('textarea')
    const checkbox = section.querySelector('.check input')
    const note = Object.hasOwn(data.notes, id) ? data.notes[id] : { ok: false, text: '' }
    const { text, ok } = note
    section.classList.toggle('current', section === target)
    section.classList.toggle('open', opened.has(id))
    section.classList.toggle('checked', ok)
    section.classList.toggle('noted', text.trim() !== '')
    section.querySelector('.body')?.toggleAttribute('inert', !opened.has(id))

    // What you're typing is newer than what the extension last saved.
    if (input && input !== document.activeElement) input.value = text

    if (checkbox instanceof HTMLInputElement) checkbox.checked = ok

    for (const [index, row] of [...section.querySelectorAll('.place')].entries()) {
      const state = places.get(id)?.[index]
      const link = row.querySelector('.place-link')
      const status = row.querySelector('.place-status')
      const stats = row.querySelector('.comparison')
      const diff = row.querySelector('.open-diff')

      if (link instanceof HTMLButtonElement) link.disabled = !state?.ready

      if (status) status.textContent = state?.reason ?? ''
      const comparison = state?.comparison

      if (stats)
        stats.textContent =
          !comparison || comparison.status === 'pending'
            ? 'Preparing comparison…'
            : comparison.status === 'available'
              ? `+${comparison.added}/−${comparison.removed}`
              : `Comparison unavailable: ${comparison.reason}`

      if (diff instanceof HTMLButtonElement)
        diff.hidden = !comparison || comparison.status === 'pending' || !comparison.openable
    }
  }

  if (!target || data.scroll === 'none') return

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
