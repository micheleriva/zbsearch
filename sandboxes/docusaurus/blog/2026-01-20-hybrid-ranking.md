---
title: Ranking, revisited
authors: [zbsearch]
tags: [ranking]
date: 2026-01-20
---

We spent the last release cycle rewriting how ZBSearch merges results, and the
change is worth explaining in full.

<!-- truncate -->

## The old behaviour

Scores coming out of the text engine and the vector engine lived on different
scales, so normalising them was always guesswork.

## What changed

Merging now happens by rank. A document that finishes first in either engine
starts ahead of one that finishes third in both, which matches what people
expect when they read a result list.
