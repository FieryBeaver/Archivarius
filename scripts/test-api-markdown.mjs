// Tests for src/api/markdown.ts (the scripting API's Markdown <-> editor JSON converters).
// Run: node scripts/test-api-markdown.mjs   (Node >= 22.18: .ts type stripping is built in)
import assert from 'node:assert/strict'
import { docToMarkdown, markdownToDoc } from '../src/api/markdown.ts'

const PAGES = [{ id: 'p-town', title: 'Old Town' }, { id: 'p-ravi', title: 'Ravi' }]
const resolvePage = (t) => PAGES.find((p) => p.title === t) ?? null
const pageTitle = (id) => PAGES.find((p) => p.id === id)?.title
const toJson = (md, extra = {}) => markdownToDoc(md, { resolvePage, ...extra })
const toMd = (doc, extra = {}) => docToMarkdown(doc, { pageTitle, ...extra })

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (e) {
    console.error(`FAIL ${name}\n`, e.message)
    process.exitCode = 1
  }
}
// mark order inside a node is not meaningful (ProseMirror re-sorts by schema rank)
const sortMarks = (n) => JSON.parse(JSON.stringify(n), (k, v) =>
  k === 'marks' && Array.isArray(v) ? [...v].sort((a, b) => a.type.localeCompare(b.type)) : v)
const blocks = (md) => toJson(md).content
const LINK = (href) => ({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'doc-link' } })

test('headings # .. ###', () => {
  assert.deepEqual(blocks('# One\n## Two\n### Three'), [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Two' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Three' }] },
  ])
  assert.equal(blocks('#hashtag')[0].type, 'paragraph')
  assert.deepEqual(blocks('# C#')[0].content, [{ type: 'text', text: 'C#' }])
})

test('bold / italic / nested', () => {
  assert.deepEqual(blocks('a **b** *c* _d_ ***e***')[0].content, [
    { type: 'text', text: 'a ' },
    { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'd', marks: [{ type: 'italic' }] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'e', marks: [{ type: 'bold' }, { type: 'italic' }] },
  ])
  assert.deepEqual(blocks('snake_case and 2 * 3')[0].content, [{ type: 'text', text: 'snake_case and 2 * 3' }])
  assert.deepEqual(blocks('**unclosed')[0].content, [{ type: 'text', text: '**unclosed' }])
})

test('paragraphs and line breaks', () => {
  assert.deepEqual(blocks('one\ntwo\n\nthree'), [
    { type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
  ])
  assert.deepEqual(toJson(''), { type: 'doc', content: [{ type: 'paragraph' }] })
})

test('bullet / ordered / nested lists', () => {
  assert.deepEqual(blocks('- a\n- b\n  - c\n\n3. x\n4. y'), [
    {
      type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        {
          type: 'listItem', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] }] },
          ],
        },
      ],
    },
    {
      type: 'orderedList', attrs: { start: 3, type: null }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'y' }] }] },
      ],
    },
  ])
})

test('blockquote', () => {
  assert.deepEqual(blocks('> quoted **text**\n> - item'), [{
    type: 'blockquote', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'quoted ' }, { type: 'text', text: 'text', marks: [{ type: 'bold' }] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] },
    ],
  }])
})

test('links: http/https/mailto only', () => {
  assert.deepEqual(blocks('[site](https://example.com) [mail](mailto:a@b.c)')[0].content, [
    { type: 'text', text: 'site', marks: [LINK('https://example.com')] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'mail', marks: [LINK('mailto:a@b.c')] },
  ])
  // disallowed scheme: the label stays, the link does not
  assert.deepEqual(blocks('[x](javascript:alert(1))')[0].content, [{ type: 'text', text: 'x' }])
  assert.deepEqual(blocks('[**b**](http://x.io)')[0].content, [{ type: 'text', text: 'b', marks: [LINK('http://x.io'), { type: 'bold' }] }])
})

test('[[page links]] resolve or fall back to text', () => {
  assert.deepEqual(blocks('see [[Old Town]] and [[Nowhere]]')[0].content, [
    { type: 'text', text: 'see ' },
    { type: 'mention', attrs: { id: 'p-town', label: 'Old Town', mentionSuggestionChar: '@' } },
    { type: 'text', text: ' and [[Nowhere]]' },
  ])
  // without a resolver nothing becomes a mention
  assert.deepEqual(markdownToDoc('[[Old Town]]').content[0].content, [{ type: 'text', text: '[[Old Town]]' }])
  // serializer uses the live title (rename-safe), not the stored label
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'p-ravi', label: 'Old name' } }] }] }
  assert.equal(toMd(doc), '[[Ravi]]')
})

test('unknown nodes degrade gracefully', () => {
  const doc = {
    type: 'doc', content: [
      { type: 'imageBlock', attrs: { path: 'w/images/a.png', caption: '' } },
      { type: 'pluginBlock', attrs: { pluginId: 'x' } },
      { type: 'callout', attrs: { variant: 'info' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note this' }] }] },
      { type: 'paragraph', content: [{ type: 'weirdInline', content: [{ type: 'text', text: 'inner' }] }, { type: 'text', text: 'u', marks: [{ type: 'underline' }] }] },
      'garbage', null,
    ],
  }
  assert.equal(toMd(doc), '![image]\n\n![plugin]\n\nnote this\n\ninneru')
  assert.equal(toMd(null), '')
})

test('embeds survive a markdown edit (replace path)', () => {
  const img = { type: 'imageBlock', attrs: { path: 'w/images/a.png' } }
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }, img] }
  const embeds = []
  const md = toMd(doc, { embeds })
  assert.equal(md, 'before\n\n<!--embed:0-->')
  const back = toJson(md.replace('before', 'after'), { embeds })
  assert.deepEqual(back.content, [{ type: 'paragraph', content: [{ type: 'text', text: 'after' }] }, img])
})

test('escaping: literal markdown characters survive JSON -> md -> JSON', () => {
  const texts = ['# not a heading', '- not a list', '1. not ordered', '> not a quote', '*stars* and _under_ and `tick`',
    'a [b](https://c.d) lookalike', '---', 'back\\slash', 'x ~~y~~']
  for (const text of texts) {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
    assert.deepEqual(toJson(toMd(doc)), doc, `text: ${text} -> ${toMd(doc)}`)
  }
})

test('JSON -> md -> JSON keeps editor documents (subset)', () => {
  const doc = {
    type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'x', marks: [{ type: 'italic' }] },
          { type: 'text', text: 'y', marks: [{ type: 'bold' }, { type: 'italic' }] },
          { type: 'text', text: 'z', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'w', marks: [{ type: 'code' }] },
          { type: 'hardBreak' },
          { type: 'mention', attrs: { id: 'p-town', label: 'Old Town', mentionSuggestionChar: '@' } },
        ],
      },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'let a = 1\n**not bold**' }] },
      { type: 'horizontalRule' },
    ],
  }
  assert.deepEqual(sortMarks(toJson(toMd(doc))), sortMarks(doc), toMd(doc))
})

test('md -> JSON -> md is idempotent', () => {
  const samples = [
    '# Hello _world_',
    'Some **bold**, _italic_, **_both_**, **b _i_**, _x **y** z_, in*word*italic and `code`.',
    'Line one\nline two',
    '- one\n- two\n  - nested **bold**\n- three',
    '1. a\n2. b\n   1. c',
    '> quote\n>\n> - with list',
    'A [link](https://example.com/path?q=1) and [[Old Town]] and [[Missing Page]].',
    '```\ncode *here*\n```',
    '---',
    '- item\n\n  second paragraph',
    'Mixed: [**bold link**](https://x.io) after',
  ]
  for (const md of samples) {
    const once = toMd(toJson(md))
    assert.equal(once, md, `first pass changed:\n${md}\n=>\n${once}`)
    assert.equal(toMd(toJson(once)), once)
  }
  // non-canonical input normalizes after one pass, then stays put
  for (const md of ['* star bullet\n+ plus', '__strong__ *em*', '***both***', '**b *i***', '# Title ##', 'a  \n\n\n\nb']) {
    const once = toMd(toJson(md))
    assert.equal(toMd(toJson(once)), once, `not stable: ${md} -> ${once}`)
  }
})

console.log(`${passed} tests passed${process.exitCode ? ' (with failures above)' : ''}`)
