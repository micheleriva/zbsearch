export const highlightStrategy = {
  WHOLE_WORD_MATCH: 'wholeWordMatch',
  PARTIAL_MATCH: 'partialMatch',
  PARTIAL_MATCH_FULL_WORD: 'partialMatchFullWord'
} as const

export type HighlightStrategy = (typeof highlightStrategy)[keyof typeof highlightStrategy]

export interface HighlightOptions {
  caseSensitive?: boolean
  strategy?: HighlightStrategy
  HTMLTag?: string
  CSSClass?: string
}

export type Position = { start: number; end: number }

type Positions = Position[]

const defaultOptions: Required<HighlightOptions> = {
  caseSensitive: false,
  strategy: highlightStrategy.PARTIAL_MATCH,
  HTMLTag: 'mark',
  CSSClass: 'zbsearch-highlight'
}

export class Highlight {
  private readonly options: HighlightOptions
  private _positions: Positions = []
  private _HTML: string = ''
  private _searchTerm: string = ''
  private _originalText: string = ''

  constructor(options: HighlightOptions = defaultOptions) {
    this.options = { ...defaultOptions, ...options }
  }

  public highlight(text: string, searchTerm: string): Highlight {
    this._searchTerm = searchTerm ?? ''
    this._originalText = text ?? ''

    const HTMLTag = this.options.HTMLTag ?? defaultOptions.HTMLTag
    const CSSClass = this.options.CSSClass ?? defaultOptions.CSSClass
    const caseSensitive = this.options.caseSensitive ?? defaultOptions.caseSensitive
    const strategy = this.options.strategy ?? defaultOptions.strategy

    const terms = this.escapeRegExp(caseSensitive ? this._searchTerm : this._searchTerm.toLowerCase())
      .trim()
      .split(/\s+/)
      .filter(Boolean)

    if (!this._searchTerm || !this._originalText || terms.length === 0) {
      this._positions = []
      this._HTML = this._originalText
      return this
    }

    const regexFlags = caseSensitive ? 'g' : 'gi'
    const searchTerms = terms.join('|')

    let regex: RegExp

    if (strategy === highlightStrategy.WHOLE_WORD_MATCH) {
      regex = new RegExp(`\\b(?:${searchTerms})\\b`, regexFlags)
    } else if (strategy === highlightStrategy.PARTIAL_MATCH) {
      regex = new RegExp(searchTerms, regexFlags)
    } else if (strategy === highlightStrategy.PARTIAL_MATCH_FULL_WORD) {
      regex = new RegExp(`\\b[^\\s]*(${searchTerms})[^\\s]*\\b`, regexFlags)
    } else {
      throw new Error('Invalid highlighter strategy')
    }

    const positions: Positions = []
    const highlightedParts: string[] = []

    let match: RegExpExecArray | null
    let lastEnd = 0
    let previousLastIndex = -1

    while ((match = regex.exec(this._originalText)) !== null) {
      if (regex.lastIndex === previousLastIndex) {
        break
      }

      previousLastIndex = regex.lastIndex

      const start = match.index
      const end = start + match[0].length - 1

      positions.push({ start, end })

      highlightedParts.push(this._originalText.slice(lastEnd, start))
      highlightedParts.push(`<${HTMLTag} class="${CSSClass}">${match[0]}</${HTMLTag}>`)

      lastEnd = end + 1
    }

    highlightedParts.push(this._originalText.slice(lastEnd))

    this._positions = positions
    this._HTML = highlightedParts.join('')

    return this
  }

  public trim(trimLength: number, ellipsis: boolean = true): string {
    if (this._originalText.length <= trimLength) {
      return this._HTML
    }

    if (this._positions.length === 0) {
      return `${this._HTML.substring(0, trimLength)}${ellipsis ? '...' : ''}`
    }

    const firstMatch = this._positions[0].start
    const start = Math.max(firstMatch - Math.floor(trimLength / 2), 0)
    const end = Math.min(start + trimLength, this._originalText.length)
    const trimmedContent = `${start === 0 || !ellipsis ? '' : '...'}${this._originalText.slice(start, end)}${
      end < this._originalText.length && ellipsis ? '...' : ''
    }`

    this.highlight(trimmedContent, this._searchTerm)

    return this._HTML
  }

  get positions(): Positions {
    return this._positions
  }

  get HTML(): string {
    return this._HTML
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
