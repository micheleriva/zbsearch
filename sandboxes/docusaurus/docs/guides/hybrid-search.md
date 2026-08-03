---
title: Hybrid Search
sidebar_position: 2
---

Hybrid search runs a full-text query and a vector query together, then merges
the two result sets into one ranking.

## When to use it

Reach for hybrid search when your users mix precise terms, such as an error code
or an API name, with vague descriptions of what they are trying to do.

## Weighting the two halves

The `hybridWeights` option decides how much each half contributes. Leaning on
the text side favours exact matches; leaning on the vector side favours
paraphrases.

## Reciprocal rank fusion

Scores from the two engines are not comparable on their own, so ZBSearch merges
them by rank rather than by raw score.
