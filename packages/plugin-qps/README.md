# ZBSearch Plugin Quantum Proximity Scoring

**ZBSearch Plugin Quantum Proximity Scoring** ranks search results based on the proximity of query tokens in the document.

## Installation

To get started with **ZBSearch Plugin QPS**, just install it with npm:

```sh
npm i @zbsearch/plugin-qps
```

## Usage

```js
import { create } from 'zbsearch'
import { pluginQPS } from '@zbsearch/plugin-qps'

const db = await create({
  schema: {
    description: 'string',
  },
  plugins: [ pluginQPS() ],
})
```

# License

[Apache 2.0](/LICENSE.md)