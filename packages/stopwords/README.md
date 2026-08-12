# ZBSearch Stop-words

<!-- LANGUAGES:START -->
This package provides support for stop-words removal in 34 languages:

- Arabic
- Armenian
- Bulgarian
- Chinese (Mandarin)
- Czech
- Danish
- Dutch
- English
- Finnish
- French
- German
- Greek
- Hindi
- Hungarian
- Indonesian
- Irish
- Italian
- Japanese
- Lithuanian
- Nepali
- Norwegian
- Portuguese
- Romanian
- Russian
- Sanskrit
- Serbian
- Slovak
- Slovenian
- Spanish
- Swedish
- Tamil
- Turkish
- Ukrainian
- Vietnamese
<!-- LANGUAGES:END -->

```js
import { create } from 'zbsearch'
import { stopwords as italianStopwords } from '@zbsearch/stopwords/italian'

const db = create({
  schema: {
  components: {
    tokenizer: {
      stopwords: italianStopwords
    }
  }
})
```

Read more in the official docs: [https://docs.zbsearch.com/docs/zbsearch-js/text-analysis/stop-words](https://docs.zbsearch.com/docs/zbsearch-js/text-analysis/stop-words).

# License

[Apache 2.0](/LICENSE.md)
