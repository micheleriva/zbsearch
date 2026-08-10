#!/usr/bin/env node
import { bundle, readConfig } from './lib/rolldown.mjs'

await bundle(readConfig())
