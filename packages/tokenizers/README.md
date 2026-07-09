# ZBSearch Tokenizers

This package provides support for additional tokenizers for the ZBSearch Search Engine.

Available tokenizers:

- Chinese (Mandarin, experimental)
- Japanese (experimental)
- Korean (experimental)

Usage:

```js
import { create } from "zbsearch";
import { createTokenizer } from "@zbsearch/tokenizers/mandarin";

const db = await create({
  schema: {
    myProperty: "string",
    anotherProperty: "number",
  },
  components: {
    tokenizer: await createTokenizer(),
  },
});
```

# License

[Apache 2.0](/LICENSE.md)
