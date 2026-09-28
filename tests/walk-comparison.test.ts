import { afterEach, mock, spyOn, test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { join, win32 } from 'node:path'
import * as fs from 'node:fs/promises'
import * as v from 'valibot'
import { tmpdir } from 'node:os'
import { prepareComparison, scopeComparison } from '../src/walk-compare.ts'
import { locate } from '../src/locate.ts'
import { FilePath } from '../src/validation.ts'

class Uri {
  scheme: string
  path: string
  query: string
  constructor(scheme: string, path: string, query = '') {
    this.scheme = scheme
    this.path = path
    this.query = query
  }
  static file(path: string) {
    return new Uri('file', path)
  }
  static from(value: { scheme: string; path: string; query: string }) {
    return new Uri(value.scheme, value.path, value.query)
  }
  toString() {
    return `${this.scheme}:${this.path}?${this.query}`
  }
}

class Range {
  start: { line: number; character: number }
  end: { line: number; character: number }
  constructor(start: number, character: number, end: number, endCharacter: number) {
    this.start = { line: start, character }
    this.end = { line: end, character: endCharacter }
  }
}

mock.module('vscode', () => ({ Uri, Range }))
const { preparePlaces, documentRange } = await import('../src/walk-places.ts')
const roots: string[] = []

afterEach(() => {
  mock.restore()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tandem-regression-'))
  roots.push(root)
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const put = (file: string, text: string | Buffer) => writeFileSync(join(root, file), text)
  git('init', '-b', 'main')
  git('config', 'user.name', 'Tandem regression')
  git('config', 'user.email', 'test@example.invalid')
  put('service.ts', 'service anchor\nstable\n')
  return {
    root,
    git,
    put,
    commit: () => {
      git('add', '.')
      git('commit', '-m', 'fixture')
    },
  }
}

const step = (file: string, quote?: string) => ({ id: 'step', title: 'Step', body: '', places: [{ file, quote }] })

test('1: both directions of type change leave unrelated comparisons available', async () => {
  const { root, git, put, commit } = fixture()
  symlinkSync('service.ts', join(root, 'link'))
  put('regular', 'regular\n')
  commit()
  const base = git('rev-parse', 'HEAD')
  rmSync(join(root, 'link'))
  put('link', 'now regular\n')
  rmSync(join(root, 'regular'))
  symlinkSync('service.ts', join(root, 'regular'))
  put('service.ts', 'changed service\nstable\n')
  commit()
  for (const head of [undefined, 'HEAD']) {
    const files = await prepareComparison(root, { base, head }, ['service.ts', 'link', 'regular'])
    expect(scopeComparison(files.get('service.ts')!.file!)).toMatchObject({ added: 1, removed: 1 })
    expect(files.get('link')!.reason).toBeDefined()
    expect(files.get('regular')!.reason).toBeDefined()
    expect((await prepareComparison(root, { base, head }, ['service.ts'])).get('service.ts')!.file).toBeDefined()
  }
})

test('2: index removals use disk contents for both counts and endpoints without changing the index', async () => {
  const { root, git, put, commit } = fixture()
  commit()
  git('rm', '--cached', 'service.ts')
  const index = readFileSync(join(root, '.git/index'))
  for (const changed of [false, true]) {
    if (changed) put('service.ts', 'changed anchor\nstable\n')
    const status = git('status', '--porcelain')
    const result = (await prepareComparison(root, { base: 'HEAD' }, ['service.ts'])).get('service.ts')!.file!
    expect(result.after.text).toBe(readFileSync(join(root, 'service.ts'), 'utf8'))
    expect(scopeComparison(result)).toMatchObject({ added: changed ? 1 : 0, removed: changed ? 1 : 0 })
    expect(readFileSync(join(root, '.git/index'))).toEqual(index)
    expect(git('status', '--porcelain')).toBe(status)
  }
  const previous = process.env.GIT_INDEX_FILE
  process.env.GIT_INDEX_FILE = join(root, 'nonexistent-index')
  try {
    const result = (await prepareComparison(root, { base: 'HEAD' }, ['service.ts'])).get('service.ts')!.file!
    expect(scopeComparison(result)).toMatchObject({ added: 1, removed: 1 })
    expect(() => readFileSync(process.env.GIT_INDEX_FILE!)).toThrow()
  } finally {
    if (previous === undefined) delete process.env.GIT_INDEX_FILE
    else process.env.GIT_INDEX_FILE = previous
  }
})

test('streamed working-tree comparisons preserve the base encoding BOM', async () => {
  const { root, put, commit } = fixture()
  put('service.ts', '\uFEFFfirst\nold\nlast\n')
  commit()
  put('service.ts', '\uFEFFfirst\nnew\nlast\n')
  const result = (await prepareComparison(root, { base: 'HEAD' }, ['service.ts'])).get('service.ts')!.file!
  expect(result.hunks).toEqual([{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 }])
  expect(scopeComparison(result)).toMatchObject({ added: 1, removed: 1 })
})

test('3: unstaged renames, including edited files and subdirectory workspaces, retain the base endpoint', async () => {
  const { root, git, put, commit } = fixture()
  mkdirSync(join(root, 'sub'))
  const original = 'old anchor\none\ntwo\nthree\nfour\nfive\nsix\n'
  put('sub/old name.ts', original)
  commit()
  renameSync(join(root, 'sub/old name.ts'), join(root, 'sub/new name.ts'))
  for (const changed of [false, true]) {
    if (changed) put('sub/new name.ts', original.replace('old anchor', 'new anchor'))
    const index = readFileSync(join(root, '.git/index'))
    const status = git('status', '--porcelain')
    const result = (await prepareComparison(join(root, 'sub'), { base: 'HEAD' }, ['new name.ts'])).get(
      'new name.ts',
    )!.file!
    expect(result.before.endpoint).toMatchObject({ file: 'sub/old name.ts' })
    expect(result.before.text).toBe(original)
    expect(
      scopeComparison(result, locate(original, 'old anchor'), locate(result.after.text, 'old anchor')),
    ).toMatchObject({ added: changed ? 1 : 0, removed: changed ? 1 : 0 })
    expect(readFileSync(join(root, '.git/index'))).toEqual(index)
    expect(git('status', '--porcelain')).toBe(status)
  }
})

test('4: readable disk and explicit-head navigation survive an unreadable binary base', async () => {
  const { root, git, put, commit } = fixture()
  put('binary.ts', Buffer.from([0, 1, 2]))
  commit()
  const base = git('rev-parse', 'HEAD')
  put('binary.ts', 'readable anchor\n')
  commit()
  for (const head of [undefined, 'HEAD']) {
    const prepared = await preparePlaces(root, {
      title: 'Navigation',
      compare: { base, head },
      steps: [step('binary.ts', 'readable anchor')],
    })
    const place = prepared.places.get('step')![0]
    expect(place.comparison).toMatchObject({ status: 'unavailable', openable: false })
    expect(place.uri?.scheme).toBe(head ? 'tandem-diff' : 'file')
    expect(place.range).toEqual({ start: 1, end: 1 })
    expect(prepared.contents.get(place.uri!.toString())).toBe('readable anchor\n')
  }
})

test('4: a missing base blob does not disable a readable head or another place', async () => {
  const { root, git, put, commit } = fixture()
  put('broken.ts', 'old broken content\n')
  commit()
  const base = git('rev-parse', 'HEAD')
  const blob = git('rev-parse', `${base}:broken.ts`)
  put('broken.ts', 'readable replacement\n')
  put('service.ts', 'changed service\nstable\n')
  commit()
  rmSync(join(root, '.git/objects', blob.slice(0, 2), blob.slice(2)))
  for (const head of [undefined, 'HEAD']) {
    const compared = await prepareComparison(root, { base, head }, ['broken.ts', 'service.ts'])
    expect(compared.get('broken.ts')!.reason).toBeDefined()
    expect(compared.get('broken.ts')!.target?.text).toBe('readable replacement\n')
    expect(scopeComparison(compared.get('service.ts')!.file!)).toMatchObject({ added: 1, removed: 1 })
  }
})

test('5: plain in-workspace symlinks navigate; symlink comparisons remain unavailable but navigable', async () => {
  const { root, commit } = fixture()
  symlinkSync('service.ts', join(root, 'link.ts'))
  commit()
  for (const compare of [undefined, { base: 'HEAD' }]) {
    const prepared = await preparePlaces(root, {
      title: 'Symlink',
      compare,
      steps: [step('link.ts', 'service anchor')],
    })
    const place = prepared.places.get('step')![0]
    expect(place.uri?.scheme).toBe('file')
    expect(place.range).toEqual({ start: 1, end: 1 })
    expect(place.comparison?.status).toBe(compare ? 'unavailable' : undefined)
  }
})

test('6: inclusive locator bounds retain a final quoted blank line', () => {
  for (const text of ['one\n\nthree\n', 'one\r\n\r\nthree\r\n']) {
    const lines = text.split(/\r?\n/)
    const quote = text.slice(0, text.indexOf('three'))
    const located = locate(text, quote)
    const document = {
      lineCount: lines.length,
      lineAt: (line: number) => ({ range: { end: { character: lines[line].length } } }),
    }
    // SAFETY: the adapter uses only lineCount and lineAt, both supplied by this document stub.
    const range = documentRange(document as Parameters<typeof documentRange>[0], located.range)
    expect(located.range).toEqual({ start: 1, end: 2 })
    expect(range?.end).toEqual({ line: 1, character: 0 })
  }
})

test('case-distinct committed paths keep independent counts and revision contents without a checkout or writes', async () => {
  const { root, git, commit } = fixture()
  commit()
  const input = (text: string, ...args: string[]) =>
    execFileSync('git', args, { cwd: root, input: text, encoding: 'utf8' }).trim()
  const tree = (upper: string, lower: string) =>
    input(
      `100644 blob ${input(upper, 'hash-object', '-w', '--stdin')}\tThing.ts\n100644 blob ${input(lower, 'hash-object', '-w', '--stdin')}\tthing.ts\n`,
      'mktree',
    )
  const base = git('commit-tree', tree('old upper\n', 'old lower\n'), '-p', 'HEAD', '-m', 'case base')
  const head = git(
    'commit-tree',
    tree('upper one\nupper two\nupper three\n', 'lower one\n'),
    '-p',
    base,
    '-m',
    'case head',
  )
  const writes = spyOn(fs, 'writeFile')
  const temporary = spyOn(fs, 'mkdtemp')
  for (const paths of [
    ['Thing.ts', 'thing.ts'],
    ['thing.ts', 'Thing.ts'],
  ]) {
    const files = await prepareComparison(root, { base, head }, paths)
    expect(scopeComparison(files.get('Thing.ts')!.file!)).toMatchObject({ added: 3, removed: 1 })
    expect(scopeComparison(files.get('thing.ts')!.file!)).toMatchObject({ added: 1, removed: 1 })
    const prepared = await preparePlaces(root, {
      title: 'Case paths',
      compare: { base, head },
      steps: paths.map((file) => ({ ...step(file), id: file })),
    })
    expect(prepared.contents.get(prepared.places.get('Thing.ts')![0].uri!.toString())).toBe(
      'upper one\nupper two\nupper three\n',
    )
    expect(prepared.contents.get(prepared.places.get('thing.ts')![0].uri!.toString())).toBe('lower one\n')
  }
  expect(writes).not.toHaveBeenCalled()
  expect(temporary).not.toHaveBeenCalled()
  expect(git('status', '--porcelain')).toBe('')
})

test('ordinary places never scan unrelated base paths; an empty walk needs no Git or filesystem', async () => {
  const { root, put, commit } = fixture()
  for (let i = 0; i < 20; i++) put(`unrelated-${i}.ts`, 'unrelated\n')
  commit()
  put('service.ts', 'changed\n')
  const stat = spyOn(fs, 'lstat')
  await prepareComparison(root, { base: 'HEAD' }, ['service.ts'])
  expect(stat).toHaveBeenCalledTimes(1)
  stat.mockClear()
  expect((await prepareComparison('/does-not-exist', { base: 'missing' }, [])).size).toBe(0)
  expect(stat).not.toHaveBeenCalled()
})

test('the navigation containment boundary rejects Windows parent and cross-drive targets', () => {
  for (const target of ['C:\\outside\\file.ts', 'C:\\work', 'D:\\file.ts', '\\\\server\\share\\file.ts']) {
    expect(v.is(FilePath, win32.relative('C:\\work\\project', target))).toBe(false)
  }
  expect(v.is(FilePath, win32.relative('C:\\work\\project', 'C:\\work\\project\\src\\file.ts'))).toBe(true)
})

test('plain navigation rejects an actual symlink outside its workspace', async () => {
  const { root } = fixture()
  const other = fixture()
  symlinkSync(join(other.root, 'service.ts'), join(root, 'outside.ts'))
  const prepared = await preparePlaces(root, { title: 'Outside', steps: [step('outside.ts')] })
  expect(prepared.places.get('step')![0].uri).toBeUndefined()
  expect(prepared.places.get('step')![0].reason).toContain('outside the workspace')
})
