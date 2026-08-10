import { describe, expect, it } from 'vitest'
import {
  ZBSearchPlugin,
  create,
  search,
  insert,
  insertMultiple,
  remove,
  update,
  removeMultiple,
  updateMultiple
} from '../src/index.js'
import { getAllPluginsByHook } from '../src/components/plugins.js'

describe('getAllPluginsByHook', () => {
  it('should return all the plugins that includes a given hook name', async () => {
    function plugin1() {
      return {
        name: 'plugin1',
        beforeInsert: async () => {},
        afterInsert: async () => {},
        beforeSearch: async () => {},
        afterSearch: async () => {}
      }
    }

    function plugin2() {
      return {
        name: 'plugin2',
        beforeInsert: async () => {},
        afterInsert: async () => {},
        beforeSearch: async () => {},
        afterSearch: async () => {}
      }
    }

    function plugin3() {
      return {
        name: 'plugin3',
        beforeInsert: async () => {},
        beforeSearch: async () => {}
      }
    }

    const db = create({
      schema: {
        name: 'string'
      } as const,
      plugins: [plugin1(), plugin2(), plugin3()]
    })

    const beforeInsertPlugins = getAllPluginsByHook(db, 'beforeInsert')
    const afterSearchPlugins = getAllPluginsByHook(db, 'afterSearch')

    expect(beforeInsertPlugins.length).toBe(3)
    expect(afterSearchPlugins.length).toBe(2)
  })
})

describe('plugin', () => {
  const data: string[] = []

  function loggerPlugin(): ZBSearchPlugin {
    return {
      name: 'Logger',
      beforeInsert: async (zbsearch, id, doc) => {
        data.push(`[Logger] beforeInsert - ${JSON.stringify(doc)}`)
      },
      afterInsert: async (zbsearch, id, doc) => {
        data.push(`[Logger] afterInsert - ${JSON.stringify(doc)}`)
      },
      beforeSearch: async (zbsearch, query) => {
        data.push(`[Logger] beforeSearch: ${JSON.stringify(query)}`)
      },
      afterSearch: async (zbsearch, query, result) => {
        data.push(`[Logger] afterSearch: ${JSON.stringify(query)} - ${JSON.stringify(result)}`)
      },
      beforeInsertMultiple: async (zbsearch, docs) => {
        data.push(`[Logger] beforeInsertMultiple: ${JSON.stringify(docs)}`)
      },
      afterInsertMultiple: async (zbsearch, docs) => {
        data.push(`[Logger] afterInsertMultiple: ${JSON.stringify(docs)}`)
      },
      beforeRemove: async () => {
        data.push(`[Logger] beforeRemove`)
      },
      afterRemove: async () => {
        data.push(`[Logger] afterRemove`)
      },
      beforeUpdate() {
        data.push(`[Logger] beforeUpdate`)
      },
      afterUpdate() {
        data.push(`[Logger] afterUpdate`)
      },
      beforeRemoveMultiple() {
        data.push(`[Logger] beforeRemoveMultiple`)
      },
      afterRemoveMultiple() {
        data.push(`[Logger] afterRemoveMultiple`)
      },
      beforeUpdateMultiple() {
        data.push(`[Logger] beforeUpdateMultiple`)
      },
      afterUpdateMultiple() {
        data.push(`[Logger] afterUpdateMultiple`)
      },
      afterCreate() {
        data.push(`[Logger] afterCreate called`)
      }
    }
  }

  it('should run all the hooks of a plugin', async () => {
    const db = create({
      id: 'zbsearch-1',
      schema: {
        id: 'string',
        name: 'string'
      } as const,
      plugins: [loggerPlugin()]
    })

    await insert(db, {
      id: '1',
      name: 'John Doe'
    })

    await search(db, { term: 'john' })

    await insertMultiple(db, [
      {
        id: '2',
        name: 'Jane Doe'
      },
      {
        id: '3',
        name: 'Jim Doe'
      }
    ])

    await remove(db, '1')
    await update(db, '2', { name: 'Jasmine Doe' })

    await removeMultiple(db, ['2', '3'])

    await insertMultiple(db, [
      { id: '4', name: 'Foo Bar' },
      { id: '5', name: 'Bar Baz' }
    ])

    await updateMultiple(db, ['4', '5'], [{ name: 'Foo Bar Baz' }, { name: 'Bar Baz Foo' }])

    const log = [
      '[Logger] afterCreate called',
      '[Logger] beforeInsert - {"id":"1","name":"John Doe"}',
      '[Logger] afterInsert - {"id":"1","name":"John Doe"}',
      '[Logger] beforeSearch: {"term":"john"}',
      '[Logger] afterSearch: {"term":"john"} - undefined',
      '[Logger] beforeInsert - {"id":"2","name":"Jane Doe"}',
      '[Logger] afterInsert - {"id":"2","name":"Jane Doe"}',
      '[Logger] beforeInsert - {"id":"3","name":"Jim Doe"}',
      '[Logger] afterInsert - {"id":"3","name":"Jim Doe"}',
      '[Logger] afterInsertMultiple: [{"id":"2","name":"Jane Doe"},{"id":"3","name":"Jim Doe"}]',
      '[Logger] beforeRemove',
      '[Logger] afterRemove',
      '[Logger] beforeUpdate',
      '[Logger] beforeRemove',
      '[Logger] afterRemove',
      '[Logger] beforeInsert - {"name":"Jasmine Doe"}',
      '[Logger] afterInsert - {"name":"Jasmine Doe"}',
      '[Logger] afterUpdate',
      '[Logger] beforeRemoveMultiple',
      '[Logger] beforeRemove',
      '[Logger] afterRemove',
      '[Logger] afterRemoveMultiple',
      '[Logger] beforeInsert - {"id":"4","name":"Foo Bar"}',
      '[Logger] afterInsert - {"id":"4","name":"Foo Bar"}',
      '[Logger] beforeInsert - {"id":"5","name":"Bar Baz"}',
      '[Logger] afterInsert - {"id":"5","name":"Bar Baz"}',
      '[Logger] afterInsertMultiple: [{"id":"4","name":"Foo Bar"},{"id":"5","name":"Bar Baz"}]',
      '[Logger] beforeUpdateMultiple',
      '[Logger] beforeRemoveMultiple',
      '[Logger] beforeRemove',
      '[Logger] afterRemove',
      '[Logger] beforeRemove',
      '[Logger] afterRemove',
      '[Logger] afterRemoveMultiple',
      '[Logger] beforeInsert - {"name":"Foo Bar Baz"}',
      '[Logger] afterInsert - {"name":"Foo Bar Baz"}',
      '[Logger] beforeInsert - {"name":"Bar Baz Foo"}',
      '[Logger] afterInsert - {"name":"Bar Baz Foo"}',
      '[Logger] afterInsertMultiple: [{"name":"Foo Bar Baz"},{"name":"Bar Baz Foo"}]',
      '[Logger] afterUpdateMultiple'
    ]

    for (let i = 0; i < log.length; i++) {
      expect(data[i]).toBe(log[i])
    }

    expect(data.length).toBe(40)
  })
})
