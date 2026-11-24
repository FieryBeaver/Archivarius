/*
 * Markdown <-> editor JSON (ProseMirror / TipTap) for the scripting API (API.md).
 *
 * Pure functions, no DOM and no imports, so they run unchanged in the browser and in Node.
 * The JSON they build is exactly what DocEditor stores in pages.content / tabs[].content:
 *   doc > paragraph | heading{level} | bulletList | orderedList{start} > listItem | blockquote
 *       | codeBlock | horizontalRule, inline: text{marks: bold|italic|strike|code|link} | hardBreak
 *       | mention{id,label} (page links, see mentionExtension.ts).
 *
 * Supported Markdown: paragraphs (a single newline is a line break), # .. ###### headings,
 * **bold**, *italic* / _italic_, ~~strike~~, `code`, - / * / + and 1. lists (nested by
 * indentation), > quotes, ``` fences, --- rules, [text](https://…) links (http/https/mailto
 * only) and [[Page Title]] page links. Backslash escapes any ASCII punctuation.
 */

export interface JsonMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  marks?: JsonMark[]
  text?: string
}

/** A page a [[Title]] link resolved to. */
export interface PageRef {
  id: string
  title: string
}

export interface ParseOptions {
  /** Resolves [[Title]]; null leaves the literal text "[[Title]]" (never a broken link). */
  resolvePage?: (title: string) => PageRef | null
  /**
   * Block nodes kept aside by docToMarkdown({ embeds }) — their placeholder lines
   * (`<!--embed:N-->`) are turned back into the original nodes.
   */
  embeds?: JsonNode[]
}

export interface SerializeOptions {
  /** Current title of a page id (mention labels can be stale after a rename). */
  pageTitle?: (id: string) => string | undefined
  /**
   * When given, blocks outside the Markdown subset (images, plugins, callouts, secret
   * blocks, …) are pushed here and rendered as `<!--embed:N-->` placeholder lines, so a
   * markdown edit (replace) can put them back untouched. Without it they are rendered
   * readably: their text content, or `![image]` / `![plugin]` for embeds.
   */
  embeds?: JsonNode[]
}

// ---------- shared ----------

/** Same rule as linkUi.tsx isAllowedHref: http(s) and mailto only. */
export function isAllowedHref(href: unknown): boolean {
  if (typeof href !== 'string') return false
  // Browsers ignore embedded whitespace/control chars in schemes ("java\nscript:").
  const clean = href.replace(/[\s\u0000-\u001f\u007f]/g, '')
  if (!/^(https?:\/\/|mailto:)/i.test(clean)) return false
  try {
    const url = new URL(clean)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

/** The link mark exactly as the editor's configured Link extension writes it. */
function linkMark(href: string): JsonMark {
  return { type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'doc-link' } }
}

export const EMPTY_DOC: JsonNode = { type: 'doc', content: [{ type: 'paragraph' }] }

const EMBED_LINE = /^<!--embed:(\d+)-->$/
const FENCE = /^(`{3,}|~{3,})(.*)$/
const HEADING = /^(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/
const QUOTE = /^ {0,3}>/

// ---------- Markdown -> JSON ----------

/** Parses Markdown into a `{ type: 'doc' }` node (always at least one block). */
export function markdownToDoc(md: string, opts: ParseOptions = {}): JsonNode {
  const blocks = markdownToBlocks(md, opts)
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}

/** Parses Markdown into a list of block nodes (empty for blank input). */
export function markdownToBlocks(md: string, opts: ParseOptions = {}): JsonNode[] {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n').map(expandTabs)
  return parseBlocks(lines, opts)
}

function expandTabs(line: string): string {
  const m = /^[ \t]+/.exec(line)
  if (!m || !m[0].includes('\t')) return line
  let width = 0
  for (const ch of m[0]) width = ch === '\t' ? width + 4 - (width % 4) : width + 1
  return ' '.repeat(width) + line.slice(m[0].length)
}

const isBlank = (l: string) => l.trim() === ''
const indentOf = (l: string) => /^ */.exec(l)![0].length

interface ListMarker { indent: number; ordered: boolean; start: number; contentIndent: number; rest: string }

function listMarker(line: string): ListMarker | null {
  const m = LIST_ITEM.exec(line)
  if (!m) return null
  if (m[3] === undefined && m[4] === undefined) {
    // "-" / "1." alone on a line is an empty item; "---" etc. never reach here (RULE first).
    if (RULE.test(line)) return null
  }
  const indent = m[1].length
  const ordered = /\d/.test(m[2])
  const gap = m[3]?.length ?? 1
  return {
    indent, ordered, start: ordered ? parseInt(m[2], 10) : 1,
    contentIndent: indent + m[2].length + (gap > 4 ? 1 : gap),
    rest: gap > 4 ? ' '.repeat(gap - 1) + (m[4] ?? '') : m[4] ?? '',
  }
}

/** Would this line start a block other than a paragraph? (ends a paragraph) */
function startsBlock(line: string, opts: ParseOptions): boolean {
  if (indentOf(line) > 3) return false
  const t = line.trimStart()
  return FENCE.test(t) || HEADING.test(t) || RULE.test(line) || QUOTE.test(line)
    || (listMarker(line) !== null && listMarker(line)!.rest.trim() !== '')
    || (!!opts.embeds && EMBED_LINE.test(t))
}

function parseBlocks(lines: string[], opts: ParseOptions): JsonNode[] {
  const out: JsonNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) { i++; continue }
    const t = line.trimStart()
    const shallow = indentOf(line) <= 3

    // embed placeholder (replace round-trips)
    const em = shallow && opts.embeds ? EMBED_LINE.exec(t) : null
    if (em) {
      const node = opts.embeds![Number(em[1])]
      if (node) out.push(node)
      i++
      continue
    }

    // fenced code
    const fence = shallow ? FENCE.exec(t) : null
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      const marker = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length) {
        const ct = lines[i].trimStart()
        if (ct.startsWith(marker) && ct.slice(marker.length).trim() === '' && ct[0] === marker[0]) { i++; break }
        body.push(lines[i])
        i++
      }
      const lang = fence[2].trim()
      const text = body.join('\n')
      out.push({
        type: 'codeBlock', attrs: { language: lang || null },
        ...(text ? { content: [{ type: 'text', text }] } : {}),
      })
      continue
    }

    // heading
    const h = shallow ? HEADING.exec(t) : null
    if (h) {
      const content = parseInline((h[2] ?? '').trim(), opts)
      out.push({ type: 'heading', attrs: { level: h[1].length }, ...(content.length ? { content } : {}) })
      i++
      continue
    }

    // horizontal rule
    if (RULE.test(line)) {
      out.push({ type: 'horizontalRule' })
      i++
      continue
    }

    // blockquote
    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ''))
        i++
      }
      const content = parseBlocks(inner, opts)
      out.push({ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] })
      continue
    }

    // list
    const lm = listMarker(line)
    if (lm && lm.indent <= 3) {
      i = parseList(lines, i, lm, opts, out)
      continue
    }

    // paragraph: consecutive lines until a blank line or another block starts
    const para: string[] = [line.trim()]
    i++
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], opts)) {
      para.push(lines[i].trim())
      i++
    }
    const content = parseInline(para.join('\n'), opts)
    out.push(content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
  }
  return out
}

/** Parses a list starting at lines[start]; pushes it to `out` and returns the next line index. */
function parseList(lines: string[], start: number, first: ListMarker, opts: ParseOptions, out: JsonNode[]): number {
  const items: JsonNode[] = []
  let i = start
  let marker: ListMarker | null = first
  while (marker) {
    const body: string[] = [marker.rest]
    const ci = marker.contentIndent
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (isBlank(l)) {
        let j = i + 1
        while (j < lines.length && isBlank(lines[j])) j++
        if (j < lines.length && indentOf(lines[j]) >= ci) {
          for (; i < j; i++) body.push('')
          continue
        }
        break
      }
      const ind = indentOf(l)
      if (ind >= ci) { body.push(l.slice(ci)); i++; continue }
      const nested = listMarker(l)
      if (nested && ind > first.indent) { body.push(l.slice(ind)); i++; continue }
      if (!startsBlock(l, opts) && !nested) { body.push(l.trim()); i++; continue } // lazy continuation
      break
    }
    const content = parseBlocks(body, opts)
    if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' })
    items.push({ type: 'listItem', content })

    // next sibling item (a blank line between items keeps the list going)
    let j = i
    while (j < lines.length && isBlank(lines[j])) j++
    const next = j < lines.length ? listMarker(lines[j]) : null
    if (next && next.indent === first.indent && next.ordered === first.ordered && !RULE.test(lines[j])) {
      i = j
      marker = next
    } else {
      marker = null
    }
  }
  out.push(first.ordered
    ? { type: 'orderedList', attrs: { start: first.start, type: null }, content: items }
    : { type: 'bulletList', content: items })
  return i
}

// ----- inline -----

const PUNCT = /[!-/:-@[-`{-~]/
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c)
const isPunct = (c: string | undefined) => c !== undefined && /[\p{P}\p{S}]/u.test(c)
const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

interface InlineResult { nodes: JsonNode[]; end: number; closed: boolean }

/** Parses inline Markdown (with "\n" = hard break) into text / hardBreak / mention nodes. */
export function parseInline(src: string, opts: ParseOptions = {}): JsonNode[] {
  return mergeText(parseSpan(src, 0, '', [], opts).nodes)
}

function hasMark(marks: JsonMark[], type: string) {
  return marks.some((m) => m.type === type)
}

/**
 * Parses from `pos` until `closer` (an emphasis delimiter like "**", or "" = end of input).
 * A delimiter that never finds its closer is kept as literal text.
 */
function parseSpan(src: string, pos: number, closer: string, marks: JsonMark[], opts: ParseOptions): InlineResult {
  const nodes: JsonNode[] = []
  let buf = ''
  const flush = () => {
    if (buf) nodes.push(textNode(buf, marks))
    buf = ''
  }
  let i = pos
  while (i < src.length) {
    const c = src[i]

    if (c === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }

    if (c === '\n') {
      flush()
      nodes.push({ type: 'hardBreak' })
      i++
      continue
    }

    if (c === '`') {
      const run = /^`+/.exec(src.slice(i))![0]
      const close = src.indexOf(run, i + run.length)
      if (close > -1 && src[close + run.length] !== '`') {
        let code = src.slice(i + run.length, close)
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1)
        flush()
        if (code) nodes.push({ type: 'text', text: code, marks: [{ type: 'code' }] })
        i = close + run.length
        continue
      }
      buf += run
      i += run.length
      continue
    }

    if (c === '[' && src[i + 1] === '[') {
      const close = src.indexOf(']]', i + 2)
      const title = close > -1 ? src.slice(i + 2, close) : ''
      if (close > -1 && title.trim() && !title.includes('\n') && !title.includes('[')) {
        const ref = opts.resolvePage?.(title.trim()) ?? null
        if (ref) {
          flush()
          nodes.push({ type: 'mention', attrs: { id: ref.id, label: ref.title, mentionSuggestionChar: '@' } })
        } else {
          buf += `[[${title}]]`
        }
        i = close + 2
        continue
      }
    }

    if (c === '[' && !hasMark(marks, 'link')) {
      const link = matchLink(src, i)
      if (link) {
        flush()
        if (isAllowedHref(link.href)) {
          nodes.push(...parseSpan(link.label, 0, '', [...marks, linkMark(link.href)], opts).nodes)
        } else {
          nodes.push(...parseSpan(link.label, 0, '', marks, opts).nodes)
        }
        i = link.end
        continue
      }
    }

    if (c === '*' || c === '_' || c === '~') {
      const run = new RegExp(`^\\${c}+`).exec(src.slice(i))![0]
      const before = src[i - 1]
      const after = src[i + run.length]
      // Lenient: a delimiter opens before non-space and closes after non-space (so text
      // next to punctuation still round-trips). CommonMark's flanking rules only break ties.
      let canOpen = !isWs(after)
      let canClose = i > 0 && !isWs(before)
      if (c === '_') {
        canOpen = canOpen && !isAlnum(before)
        canClose = canClose && !isAlnum(after)
      }
      const left = !isWs(after) && (!isPunct(after) || isWs(before) || isPunct(before))
      const right = !isWs(before) && (!isPunct(before) || isWs(after) || isPunct(after))
      const preferClose = canOpen && canClose
        ? (right && !left) || (right === left && run.length === closer.length)
        : canClose
      const usable = c === '~' ? run.length >= 2 : true

      // close the current span?
      const closable = usable && !!closer && closer[0] === c && canClose && run.length >= closer.length
      if (closable && preferClose) {
        flush()
        return { nodes, end: i + closer.length, closed: true }
      }
      // open a new span
      if (usable && canOpen) {
        // "***" may be bold-then-italic or italic-then-bold: try both
        const delims = c === '~' ? ['~~'] : run.length >= 2 ? [c + c, c] : [c]
        let opened = false
        for (const delim of delims) {
          const type = c === '~' ? 'strike' : delim.length === 2 ? 'bold' : 'italic'
          if (hasMark(marks, type)) continue
          const inner = parseSpan(src, i + delim.length, delim, [...marks, { type }], opts)
          if (inner.closed && inner.nodes.length) {
            flush()
            nodes.push(...inner.nodes)
            i = inner.end
            opened = true
            break
          }
        }
        if (opened) continue
      }
      if (closable) {
        flush()
        return { nodes, end: i + closer.length, closed: true }
      }
      // literal
      buf += c === '~' ? run : c
      i += c === '~' ? run.length : 1
      continue
    }

    buf += c
    i++
  }
  flush()
  return { nodes, end: i, closed: closer === '' }
}

/** `[label](href)` at src[i], with nested brackets in the label. */
function matchLink(src: string, i: number): { label: string; href: string; end: number } | null {
  let depth = 0
  let j = i
  for (; j < src.length; j++) {
    const ch = src[j]
    if (ch === '\\') { j++; continue }
    if (ch === '\n') return null
    if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) break }
  }
  if (depth !== 0 || src[j + 1] !== '(') return null
  const m = /^\(\s*<?([^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)>?(?:\s+"[^"]*")?\s*\)/.exec(src.slice(j + 1))
  if (!m) return null
  return { label: src.slice(i + 1, j), href: m[1], end: j + 1 + m[0].length }
}

function textNode(text: string, marks: JsonMark[]): JsonNode {
  return marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text }
}

function sameMarks(a: JsonMark[] = [], b: JsonMark[] = []): boolean {
  return a.length === b.length && a.every((m) => b.some((n) => n.type === m.type
    && JSON.stringify(n.attrs ?? null) === JSON.stringify(m.attrs ?? null)))
}

function mergeText(nodes: JsonNode[]): JsonNode[] {
  const out: JsonNode[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (n.type === 'text' && !n.text) continue
    if (prev && prev.type === 'text' && n.type === 'text' && sameMarks(prev.marks, n.marks)) {
      out[out.length - 1] = { ...prev, text: prev.text! + n.text! }
    } else out.push(n)
  }
  return out
}

// ---------- JSON -> Markdown ----------

const KNOWN_BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule'])

/** Renders a doc (or any node / node array) as Markdown. Unknown nodes degrade gracefully. */
export function docToMarkdown(doc: unknown, opts: SerializeOptions = {}): string {
  const node = asNode(doc)
  if (!node) return ''
  const blocks = Array.isArray(doc) ? (doc as unknown[]).map(asNode).filter((n): n is JsonNode => !!n)
    : node.type === 'doc' ? node.content ?? [] : [node]
  return renderBlocks(blocks, opts).replace(/\n{3,}/g, '\n\n').trim()
}

function asNode(v: unknown): JsonNode | null {
  if (Array.isArray(v)) return { type: 'doc', content: v as JsonNode[] }
  if (!v || typeof v !== 'object' || typeof (v as JsonNode).type !== 'string') return null
  return v as JsonNode
}

function renderBlocks(blocks: JsonNode[], opts: SerializeOptions): string {
  const parts: string[] = []
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    const s = renderBlock(b, opts)
    if (s !== null) parts.push(s)
  }
  return parts.join('\n\n')
}

function prefixLines(s: string, first: string, rest: string): string {
  return s.split('\n').map((l, k) => (k === 0 ? first : l ? rest : rest.trimEnd()) + l).join('\n')
}

function renderBlock(node: JsonNode, opts: SerializeOptions): string | null {
  const kids = Array.isArray(node.content) ? node.content : []
  switch (node.type) {
    case 'paragraph':
      return escapeLineStarts(renderInline(kids, opts))
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      return `${'#'.repeat(level)} ${renderInline(kids, opts).replace(/\n/g, ' ')}`.trimEnd()
    }
    case 'blockquote': {
      const inner = renderBlocks(kids, opts) || ''
      return inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')
    }
    case 'bulletList':
    case 'orderedList': {
      const ordered = node.type === 'orderedList'
      let n = Number(node.attrs?.start ?? 1)
      if (!Number.isFinite(n) || n < 0) n = 1
      return kids.map((item) => {
        const marker = ordered ? `${n++}. ` : '- '
        const body = renderListItem(item, opts)
        return prefixLines(body, marker, ' '.repeat(marker.length))
      }).join('\n')
    }
    case 'listItem':
      return renderListItem(node, opts)
    case 'codeBlock': {
      const text = plainText(node)
      const fence = text.includes('```') ? '````' : '```'
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return `${fence}${lang}\n${text}\n${fence}`
    }
    case 'horizontalRule':
      return '---'
    default:
      if (KNOWN_BLOCKS.has(node.type)) return null
      if (opts.embeds) {
        opts.embeds.push(node)
        return `<!--embed:${opts.embeds.length - 1}-->`
      }
      if (node.type === 'imageBlock') {
        const caption = typeof node.attrs?.caption === 'string' && node.attrs.caption ? node.attrs.caption : 'image'
        return `![${caption.replace(/[[\]]/g, '')}]`
      }
      if (node.type === 'pluginBlock') return '![plugin]'
      // callouts, secret blocks, anything else: their content
      if (kids.length) {
        const blockish = kids.some((k) => k && typeof k === 'object' && k.type !== 'text' && k.type !== 'hardBreak' && k.type !== 'mention')
        return blockish ? renderBlocks(kids, opts) : escapeLineStarts(renderInline(kids, opts))
      }
      return typeof node.text === 'string' ? escapeText(node.text) : null
  }
}

function renderListItem(item: JsonNode, opts: SerializeOptions): string {
  const kids = Array.isArray(item.content) ? item.content : []
  let out = ''
  kids.forEach((k, idx) => {
    const s = renderBlock(k, opts)
    if (s === null) return
    if (idx > 0) out += k.type === 'bulletList' || k.type === 'orderedList' ? '\n' : '\n\n'
    out += s
  })
  return out
}

function plainText(node: JsonNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(plainText).join('')
}

// ----- inline -----

/** Escapes characters that would otherwise be read as inline Markdown. */
function escapeText(text: string): string {
  let out = ''
  for (let k = 0; k < text.length; k++) {
    const ch = text[k]
    if (ch === '\\' || ch === '*' || ch === '`') out += '\\' + ch
    else if (ch === '~') out += '\\~'
    else if (ch === '_' && (!isAlnum(text[k - 1]) || !isAlnum(text[k + 1]))) out += '\\_'
    else if (ch === '[' && /^\[[^\]]*\]\(/.test(text.slice(k)) && text[k - 1] !== '[') out += '\\['
    else out += ch
  }
  return out
}

/** Escapes line starts that would turn a paragraph line into a heading / list / quote / rule. */
function escapeLineStarts(s: string): string {
  return s.split('\n').map((line) => {
    // paragraph lines lose their indentation when parsed: drop it here so the checks see the real start
    const l = line.replace(/^[ \t]+/, '')
    if (/^(#{1,6}(\s|$)|>|<!--embed:)/.test(l)) return '\\' + l
    if (/^[-+](\s|$)/.test(l) || /^-{3,}\s*$/.test(l) || /^~{3,}/.test(l)) return '\\' + l
    const ord = /^(\d{1,9})([.)])(\s|$)/.exec(l)
    if (ord) return ord[1] + '\\' + l.slice(ord[1].length)
    return l
  }).join('\n')
}

const MARK_DELIM: Record<string, string> = { bold: '**', italic: '*', strike: '~~' }
const MARK_ORDER = ['link', 'bold', 'italic', 'strike']

interface Piece { kind: 'text' | 'code' | 'atom'; text: string; marks: JsonMark[]; edge?: 'lead' | 'trail' }

function markKey(m: JsonMark): string {
  return m.type === 'link' ? `link:${String(m.attrs?.href ?? '')}` : m.type
}

/** Inline nodes -> Markdown, opening/closing emphasis like prosemirror-markdown (a mark stack). */
function renderInline(nodes: JsonNode[], opts: SerializeOptions): string {
  // 1. flatten into pieces with only the marks we can express
  const pieces: Piece[] = []
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    const marks = (Array.isArray(n.marks) ? n.marks : [])
      .filter((m) => MARK_ORDER.includes(m.type) && (m.type !== 'link' || isAllowedHref(m.attrs?.href)))
    if (n.type === 'text' && typeof n.text === 'string' && n.text) {
      const isCode = (n.marks ?? []).some((m) => m.type === 'code')
      if (isCode) {
        pieces.push({ kind: 'code', text: n.text, marks: marks.filter((m) => m.type === 'link') })
        continue
      }
      // whitespace at the edges of a marked run goes outside the delimiters
      // (it keeps only the marks its neighbour shares, see below)
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(n.text)!
      if (m[1]) pieces.push({ kind: 'text', text: m[1], marks, edge: 'lead' })
      if (m[2]) pieces.push({ kind: 'text', text: m[2], marks })
      if (m[3]) pieces.push({ kind: 'text', text: m[3], marks, edge: 'trail' })
    } else if (n.type === 'hardBreak') {
      pieces.push({ kind: 'text', text: '\n', marks: [] })
    } else if (n.type === 'mention') {
      const id = typeof n.attrs?.id === 'string' ? n.attrs.id : ''
      const title = (id && opts.pageTitle?.(id)) || String(n.attrs?.label ?? 'Unknown page')
      pieces.push({ kind: 'atom', text: `[[${title.replace(/\]\]/g, '] ]')}]]`, marks: [] })
    } else if (Array.isArray(n.content)) {
      pieces.push({ kind: 'atom', text: renderInline(n.content, opts), marks: [] })
    } else if (typeof n.text === 'string') {
      pieces.push({ kind: 'text', text: n.text, marks: [] })
    }
  }

  pieces.forEach((p, k) => {
    if (!p.edge) return
    // whitespace at a run's edge keeps a mark only when the run continues on both sides
    const both = (m: JsonMark) => [pieces[k - 1], pieces[k + 1]].every((o) => o?.marks.some((x) => markKey(x) === markKey(m)))
    p.marks = p.marks.filter((m) => m.type === 'link' || both(m))
  })

  // 2. walk with a stack of open marks
  let out = ''
  const stack: { mark: JsonMark; delim: string }[] = []
  const close = (e: { mark: JsonMark; delim: string }) => {
    out += e.mark.type === 'link' ? `](${String(e.mark.attrs?.href)})` : e.delim
  }
  /** First character a piece renders as (for choosing delimiters). */
  const firstChar = (j: number) => {
    const p = pieces[j]
    if (!p) return undefined
    // a piece that opens emphasis of its own starts with a delimiter
    const before = new Set((pieces[j - 1]?.marks ?? []).map(markKey))
    if (p.marks.some((m) => m.type !== 'link' && !before.has(markKey(m)))) return '*'
    return p.kind === 'code' ? '`' : p.text[0]
  }
  const open = (m: JsonMark, k: number, span: number) => {
    let delim = m.type === 'link' ? '[' : MARK_DELIM[m.type]
    // Italic as _x_ keeps it apart from neighbouring ** runs; *x* only inside words.
    if (m.type === 'italic' && !isAlnum(out[out.length - 1]) && !isAlnum(firstChar(k + span))) delim = '_'
    out += delim
    stack.push({ mark: m, delim })
  }
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k]
    const keys = new Set(p.marks.map(markKey))
    // a link must be the outermost mark: switching links closes everything
    const link = p.marks.find((m) => m.type === 'link')
    const stackLink = stack.find((e) => e.mark.type === 'link')
    let keep = 0
    if (!(link && (!stackLink || markKey(stackLink.mark) !== markKey(link)))) {
      while (keep < stack.length && keys.has(markKey(stack[keep].mark))) keep++
    }
    while (stack.length > keep) close(stack.pop()!)
    const toOpen = p.marks.filter((m) => !stack.some((s) => markKey(s.mark) === markKey(m)))
    // links first; then the marks that last longest, so spans nest instead of overlapping
    const span = (m: JsonMark) => {
      let n = 0
      for (let j = k; j < pieces.length && pieces[j].marks.some((x) => markKey(x) === markKey(m)); j++) n++
      return n
    }
    toOpen.sort((a, b) => (a.type === 'link' ? -1 : b.type === 'link' ? 1 : span(b) - span(a)
      || MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type)))
    for (const m of toOpen) open(m, k, span(m))
    if (p.kind === 'code') {
      const ticks = p.text.includes('`') ? '``' : '`'
      const pad = p.text.startsWith('`') || p.text.endsWith('`') ? ' ' : ''
      out += ticks + pad + p.text + pad + ticks
    } else if (p.kind === 'atom') {
      out += p.text
    } else {
      out += escapeText(p.text)
    }
  }
  while (stack.length) close(stack.pop()!)
  return out
}
