import {
  BeforeSearch,
  AfterSearch,
  AnyZBSearch,
  MultipleCallbackComponent,
  Results,
  SearchParams,
  SingleCallbackComponent,
  TypedDocument,
  AfterCreate
} from '../types.js'
import { isAsyncFunction } from '../utils.js'

export const OBJECT_COMPONENTS = ['tokenizer', 'index', 'documentsStore', 'sorter', 'pinning']

export const FUNCTION_COMPONENTS = [
  'validateSchema',
  'getDocumentIndexId',
  'getDocumentProperties',
  'formatElapsedTime'
]

export const SINGLE_OR_ARRAY_COMPONENTS = [
  /* deprecated with v2.0.0-beta.5 */
]

export function runSingleHook<T extends AnyZBSearch, ResultDocument extends TypedDocument<T>>(
  hooks: SingleCallbackComponent<T>[],
  zbsearch: T,
  id: string,
  doc?: ResultDocument
): Promise<void> | void {
  if (!hooks.length) {
    return
  }

  const needAsync = hooks.some(isAsyncFunction)

  if (needAsync) {
    return (async () => {
      for (const hook of hooks) {
        await hook(zbsearch, id, doc)
      }
    })()
  } else {
    for (const hook of hooks) {
      hook(zbsearch, id, doc)
    }
  }
}

export function runMultipleHook<T extends AnyZBSearch, ResultDocument extends TypedDocument<T>>(
  hooks: MultipleCallbackComponent<T>[],
  zbsearch: T,
  docsOrIds: ResultDocument[] | string[]
): Promise<void> | void {
  if (!hooks.length) {
    return
  }

  const needAsync = hooks.some(isAsyncFunction)

  if (needAsync) {
    return (async () => {
      for (const hook of hooks) {
        await hook(zbsearch, docsOrIds)
      }
    })()
  } else {
    for (const hook of hooks) {
      hook(zbsearch, docsOrIds)
    }
  }
}
export function runAfterSearch<T extends AnyZBSearch, ResultDocument extends TypedDocument<T>>(
  hooks: AfterSearch<T, ResultDocument>[],
  db: T,
  params: SearchParams<T, ResultDocument>,
  language: string | undefined,
  results: Results<ResultDocument>
): Promise<void> | void {
  const needAsync = hooks.some(isAsyncFunction)

  if (needAsync) {
    return (async () => {
      for (const hook of hooks) {
        await hook(db, params, language, results)
      }
    })()
  } else {
    for (const hook of hooks) {
      hook(db, params, language, results)
    }
  }
}

export function runBeforeSearch<T extends AnyZBSearch>(
  hooks: BeforeSearch<T>[],
  db: T,
  params: SearchParams<T, TypedDocument<any>>,
  language: string | undefined
): Promise<void> | void {
  const needAsync = hooks.some(isAsyncFunction)
  if (needAsync) {
    return (async () => {
      for (const hook of hooks) {
        await hook(db, params, language)
      }
    })()
  } else {
    for (const hook of hooks) {
      hook(db, params, language)
    }
  }
}

export function runAfterCreate<T extends AnyZBSearch>(hooks: AfterCreate<T>[], db: T): Promise<void> | void {
  const needAsync = hooks.some(isAsyncFunction)

  if (needAsync) {
    return (async () => {
      for (const hook of hooks) {
        await hook(db)
      }
    })()
  } else {
    for (const hook of hooks) {
      hook(db)
    }
  }
}
