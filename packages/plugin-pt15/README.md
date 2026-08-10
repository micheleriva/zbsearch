# ZBSearch Plugin PT15

Fast ranking algorithm based on token position.

## Installation

To get started with **ZBSearch Plugin PT15**, just install it with npm:

```sh
npm i @zbsearch/plugin-pt15
```

## Usage

```js
import { create } from 'zbsearch'
import { pluginPT15 } from '@zbsearch/plugin-pt15'

const db = await create({
  schema: {
    description: 'string'
  },
  plugins: [pluginPT15()]
})
```

# License

[Apache 2.0](/LICENSE.md)
