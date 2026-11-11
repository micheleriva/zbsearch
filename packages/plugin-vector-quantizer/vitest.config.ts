import { defineConfig, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared.mjs'

export default mergeConfig(shared, defineConfig({}))
