---
title: API Reference
sidebar_position: 1
---

import Tabs from '@theme/Tabs'
import TabItem from '@theme/TabItem'

Every function below is exported from the package root.

## create

Builds an empty database. Pass a schema to declare which properties are indexed,
or leave it out and let ZBSearch infer one from the first documents.

:::tip

Declaring a schema up front keeps unrelated properties out of the index.

:::

## insert

Adds one document and returns its identifier. Use `insertMultiple` for bulk
loads: it batches the work and yields to the event loop between chunks.

## search {#searching}

Runs a query. The `boost` option multiplies the score of individual properties,
which is how a title match is made to outrank a body match.

| Option | Default | Description |
| --- | --- | --- |
| `limit` | `10` | Maximum number of hits returned |
| `tolerance` | `0` | Edit distance tolerated per term |

## save and load

`save` serializes a database into a plain object, and `load` restores one. This
sandbox relies on both: the index is built once at compile time and rehydrated
in the browser.
