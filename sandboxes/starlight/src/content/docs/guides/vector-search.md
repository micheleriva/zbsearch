---
title: Vector Search
description: Find documents by meaning rather than by wording.
---

Vector search finds documents whose meaning is close to the query, even when
they share no words with it.

## Embeddings

An embedding is a list of numbers describing a piece of text. Two texts about
the same subject end up close together in that space, which is what makes
semantic retrieval possible.

## Cosine similarity

ZBSearch compares embeddings with cosine similarity: it measures the angle
between two vectors and ignores their magnitude.

### Choosing a threshold

A threshold that is too low floods the results with loosely related documents.
Start around `0.8` and tighten it until the tail stops being useful.

## Storage cost

Vectors are the heaviest part of an index. Reducing the number of dimensions is
usually the cheapest way to shrink one.
