export { buildIndex } from './build.js'
export {
  DEFAULT_INLINE_LIMIT_BYTES,
  buildIndexAuto,
  shardBuiltPayload,
  type AutoIndexOptions,
  type AutoIndexResult
} from './static.js'
export {
  dialectOf,
  type MarkdownDialect,
  type MarkdownSection,
  type ParsedMarkdown,
  type ParseMarkdownOptions,
  parseMarkdown,
  stripInlineMarkup
} from './markdown.js'
