# ZBSearch Stemmers

ZBSearch can analyze the input and perform a `stemming` operation, which allows the engine to perform more optimized queries, as well as save indexing space.

<!-- LANGUAGES:START -->

Right now, ZBSearch supports 32 languages and stemmers out of the box:

- Arabic
- Armenian
- Bulgarian
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

Chinese (Mandarin) and Japanese are supported through dedicated tokenizers (`@zbsearch/tokenizers`) and stop-word removal (`@zbsearch/stopwords`), not through stemming.

```js
import { create } from 'zbsearch'
import { stemmer, language } from '@zbsearch/stemmers/italian'

const db = create({
  schema: {
  components: {
    tokenizer: {
      stemming: true,
      stemmer,
      language
    }
  }
})
```

Read more in the official docs: [https://docs.zbsearch.com/docs/zbsearch-js/text-analysis/stemming](https://docs.zbsearch.com/docs/zbsearch-js/text-analysis/stemming).

# License

[Apache 2.0](/LICENSE.md)
