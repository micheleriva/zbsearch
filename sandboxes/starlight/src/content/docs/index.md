---
title: Getting Started
description: Install ZBSearch and build your first index.
---

ZBSearch is a complete search engine that runs in the browser, on a server, or
at the edge. This sandbox exercises the Starlight plugin end to end.

## Installation

Install the package with your favourite package manager:

```sh
npm install zbsearch
```

The bundle weighs less than two kilobytes once compressed, so it is safe to ship
to a browser.

## Creating an index

Describe the shape of your documents, then insert them:

```js
import { create, insert } from 'zbsearch'

const db = create({ schema: { title: 'string' } })
```

Every property declared in the schema becomes searchable.

## Running a query

Call `search` with a term. Results come back sorted by relevance, with the
elapsed time attached so you can keep an eye on latency.
