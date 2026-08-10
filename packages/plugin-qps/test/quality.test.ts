import { describe, expect, it } from 'vitest'
import { AnyZBSearch, create, insertMultiple, search } from 'zbsearch'
import { bitmask_20, calculateTokenQuantum, count, numberOfOnes } from '../src/algorithm.js'
import { pluginQPS } from '../src/index.js'

async function createNew(docs: { description: string }[]) {
  const db = await create({
    schema: {
      description: 'string'
    } as const,
    components: {
      tokenizer: {
        stopWords: ['the', 'is', 'on', 'under']
      }
    },
    plugins: [pluginQPS()]
  })
  await insertMultiple(
    db,
    docs.map((d) => ({ ...d }))
  )
  return db
}
async function searchNew(db: AnyZBSearch, { term }: { term: string }) {
  const searchResult = await search(db, {
    mode: 'fulltext',
    term
  })
  return searchResult.hits
}

describe('order of the results', async () => {
  const docs = [
    { id: '0', description: 'The pen is on the table. The cat is under the table. The dog is near the table' },
    { id: '1', description: 'The pen is on the table' },
    { id: '2', description: 'The cat is under the table' },
    { id: '3', description: 'The dog is near the table' }
  ]
  const s = await createNew(docs)

  it('if the document more words, it should be the first result', async () => {
    const results = await searchNew(s, {
      term: 'table'
    })

    console.log(s.data.index)

    expect(results.length).toBe(4)
    expect(results[0].id).toBe('0')
    const score = results[0].score

    for (let i = 1; i < results.length; i++) {
      expect(results[i].score < score, 'Score should be less than the first result').toBeTruthy()
    }
  })

  it('every doc permutation has the correct order', async () => {
    const docs = permutator([
      { id: '0', description: 'The pen is on the table. The cat is under the table. The dog is near the table' },
      { id: '1', description: 'The pen is on the table' },
      { id: '2', description: 'The cat is under the table' },
      { id: '3', description: 'The dog is near the table' }
    ])
    for (const d of docs) {
      const s = await createNew(d)
      const results = await searchNew(s, {
        term: 'table'
      })

      expect(results.length).toBe(4)
      expect(results[0].id).toBe('0')
      const score = results[0].score

      for (let i = 1; i < results.length; i++) {
        expect(results[i].score < score, 'Score should be less than the first result').toBeTruthy()
      }
    }
  })

  it('multiple words increments score', async () => {
    const results = await searchNew(s, {
      term: 'table pen'
    })
    expect(results.length).toBe(4)
    expect(results[0].id).toBe('0')
    const score = results[0].score

    for (let i = 1; i < results.length; i++) {
      expect(results[i].score < score, 'Score should be less than the first result').toBeTruthy()
    }

    const score2 = results[1].score
    for (let i = 2; i < results.length; i++) {
      expect(results[i].score < score2, 'Score should be less than the second result').toBeTruthy()
    }
  })

  it('same matches + same length, same score', async () => {
    const results = await searchNew(s, {
      term: 'table pen cat'
    })
    expect(results.length).toBe(4)
    expect(results[0].id).toBe('0')
    expect(results[1].id).toBe('1')
    expect(results[2].id).toBe('2')
    expect(results[3].id).toBe('3')
    expect(results[1].score).toBe(results[2].score)
  })

  it('shorter, more score', async () => {
    const results = await searchNew(s, {
      term: 'table pen dog'
    })
    expect(results.length).toBe(4)
    expect(results[0].id).toBe('0')
    expect(results[1].id).toBe('1')
    expect(results[2].id).toBe('3')
    expect(results[3].id).toBe('2')
  })

  it('matching word score is higher than prefixed word', async () => {
    const docs = [
      { id: '0', description: 'table' },
      { id: '1', description: 'tab' }
    ]
    const s = await createNew(docs)

    const results = await searchNew(s, {
      term: 'tab'
    })
    expect(results[0].id).toBe('1')
    expect(results[1].id).toBe('0')
    expect(results[1].score < results[0].score).toBeTruthy()
  })

  it("prefix score doesn't depend on matched word lenght", async () => {
    const docs = [{ description: 'table' }, { description: 'tab' }]
    const s = await createNew(docs)

    const results = await searchNew(s, {
      term: 't'
    })
    expect(results[0].score).toBe(results[1].score)
  })
})

it('calculateTokenQuantum', async () => {
  let n = 0
  n = calculateTokenQuantum(n, 0)
  expect(n, 'set the 0th bit and the 20th bit').toBe(1 + (1 << 20))
  n = calculateTokenQuantum(n, 0)
  expect(n, 'increment the counter').toBe(1 + (2 << 20))
  n = calculateTokenQuantum(n, 1)
  expect(n, ' 1 + 2 + (3 count)').toBe(3 + (3 << 20))
  n = calculateTokenQuantum(n, 2)
  expect(n, ' 1 + 2 + 4 + (4 count)').toBe(7 + (4 << 20))

  expect(bitmask_20(n)).toBe(7)
  expect(count(n)).toBe(4)
})

it('numberOfOnes', async () => {
  expect(0).toBe(numberOfOnes(0))
  expect(1).toBe(numberOfOnes(1))
  expect(1).toBe(numberOfOnes(2))
  expect(2).toBe(numberOfOnes(3))
  expect(1).toBe(numberOfOnes(4))
  expect(2).toBe(numberOfOnes(5))
  expect(2).toBe(numberOfOnes(6))
  expect(3).toBe(numberOfOnes(7))
  expect(1).toBe(numberOfOnes(8))
})

describe('matching criteria', async () => {
  const docs = [{ id: '0', description: 'Find your way!' }]
  const s = await createNew(docs)

  it('no match', async () => {
    const results = await searchNew(s, {
      term: 'unknown words'
    })
    expect(results.length).toBe(0)
  })

  it('match', async () => {
    const results = await searchNew(s, {
      term: 'way'
    })
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('0')
  })

  it('match with 2 words', async () => {
    const results = await searchNew(s, {
      term: 'way find'
    })
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('0')
  })

  it("the order of the words doesn't matter", async () => {
    const results1 = await searchNew(s, {
      term: 'way find'
    })
    expect(results1.length).toBe(1)
    expect(results1[0].id).toBe('0')
    const score = results1[0].score

    const results2 = await searchNew(s, {
      term: 'way find'
    })
    expect(results2.length).toBe(1)
    expect(results2[0].id).toBe('0')

    expect(results2[0].score).toBe(score)
  })

  it('empty string', async () => {
    const results = await searchNew(s, {
      term: ''
    })
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('0')
    expect(results[0].score).toBe(0)
  })

  it('prefix', async () => {
    const results = await searchNew(s, {
      term: 'w'
    })
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('0')
  })
})

it('long text', async () => {
  const docs = [
    { id: '0', description: 'The pen is on the table. '.repeat(100) },
    { id: '1', description: 'The pen is on the table' }
  ]
  const s = await createNew(docs)

  const results = await searchNew(s, {
    term: 'table'
  })
  expect(results.length).toBe(2)
  expect(results[0].id).toBe('0')
  expect(results[1].id).toBe('1')
  expect(results[0].score > results[1].score).toBeTruthy()
})

it('test', async () => {
  const docs = [
    {
      id: '0',
      description:
        'FLEXIBLE COMFORT.On your marks! The Nike Flex Plus is built for kiddos who want to move all day. With a flexible feel, supersoft cushioning and an easy slip-on design (no laces needed!), these running-inspired shoes are ready to zoom with little feet learning to crawl and walk.360 ComfortSupersoft foam cushioning feels plush with every move.Easy to WearThe slip-on design with 2 pull tabs gets little feet in easily. A stretchy strap with leather on the sides creates a secure feel.Super FlexibleFlexibility grooves under the forefoot help make every growing step feel natural.More BenefitsMesh fabric adds breathability where little feet need it.Reinforced toe tip brings extra durability for kids who drag their toes.Product DetailsNot intended for use as Personal Protective Equipment (PPE)Shown: Game Royal/Midnight Navy/White/Yellow OchreStyle: CW7430-405'
    },
    {
      id: '1',
      description:
        'no matter the distance. Easy, adjustable cuffs help you slide these on and off after your warmup or run.BenefitsNike Dri-FIT technology moves sweat away from your skin for quicker evaporation, helping you stay dry and comfortable.Soft knit fabric is lightweight and breathable.Zippered pockets help keep your things secure.Bungee cords at the hem make it easier to change them over your running shoes.Nike Track Club silicone oval logo is inspired by the shape of a track.Product DetailsElastic waistband with a drawcord100% polyesterMachine washImportedShown: Midnight Navy/Summit White/Summit WhiteStyle: FB5503-410'
    },
    {
      id: '2',
      description:
        'A NEW GENERATION OF MAX.Nodding to &apos;90s style, the Nike Air Max Axis honors the past while looking to the future. Subtle design lines and branding pay homage to icons like the Air Max 97 and 98, while sleek no-sew skins, airy mesh and its unique heel design keep your look fresh. Of course, Max Air cushions your journey.BenefitsOriginally designed for performance running, the visible Max Air unit provides lasting comfort.The design lines and details nod to the iconic &apos;90s running shoes you lovesuddenly they could see it. Since then, next-generation Air Max shoes have become a hit with athletes and collectors by offering striking color combinations and reliable, lightweight cushioning.'
    }
  ]
  const s = await createNew(docs)

  const results = await searchNew(s, {
    term: 'running shoes'
  })

  expect(results.length).toBe(3)
  // The 3° document has the most matches because it:
  // - contains running
  // - contains shoes twice
  // - contains running shoes in the same sentence
  expect(results[0].id).toBe('2')
  // The 2° document is the second because it:
  // - contains running
  // - contains shoes but only one
  // - contains running shoes in the same sentence
  expect(results[1].id).toBe('1')
  // The 1° document is the last because it:
  // - not contain running (it contains "running-inspired" but it's not the same in this case)
  // - contains shoes
  expect(results[2].id).toBe('0')
})

describe('test #2', async () => {
  const texts = [
    // 0
    'The sun was setting behind the mountains, casting a golden hue over the landscape. Birds chirped as they flew across the sky, their silhouettes blending with the clouds. The air was cool and crisp, filled with the scent of pine trees.',
    'She opened the old book, its pages yellowed with time. The words inside told a story of adventure, of brave heroes and distant lands. As she read, the room around her seemed to fade away.',
    'The city buzzed with energy as people hurried along the streets. Tall buildings towered over them, casting long shadows. A street vendor called out, selling fresh fruit to passersby, while car horns blared in the distance.',
    'On a quiet night, the stars twinkled brightly in the clear sky. A gentle breeze rustled the leaves, and the sound of crickets filled the air. It was a peaceful moment, one that seemed to stretch on forever.',
    "The ocean waves crashed against the shore, their rhythm steady and unchanging. Seagulls circled overhead, calling out to one another. A lone figure stood at the water's edge, watching the horizon with a sense of calm.",
    // 5
    'In the heart of the forest, the trees stood tall and proud. Sunlight filtered through the leaves, casting dappled shadows on the ground. A deer cautiously stepped out into a clearing, its ears twitching as it listened for danger.',
    'The train pulled into the station with a loud screech. Passengers hurried to board, their footsteps echoing on the platform. Inside the train, the seats were worn but comfortable, and the soft hum of the engine filled the air.',
    'The storm raged outside, lightning flashing across the sky. Rain pounded against the windows, and the wind howled through the trees. Inside, the fire crackled in the fireplace, offering warmth and light against the storm’s fury.',
    'The classroom was filled with the sound of pencils scratching on paper. Students sat at their desks, focused on their assignments. The teacher moved quietly between the rows, offering guidance and encouragement.',
    // 9
    'At the edge of the desert, the sand dunes stretched as far as the eye could see. The heat was intense, and the sun beat down relentlessly. In the distance, a caravan made its way slowly across the barren landscape.'
  ]
  const docs = texts.map((text, i) => ({ id: i.toString(), description: text }))
  const s = await createNew(docs)

  it('"sun"', async () => {
    const results = await searchNew(s, {
      term: 'sun'
    })

    // only 3 documents contain the word "sun"
    expect(results.length).toBe(3)
    // This contains the word "sun".
    expect(results[0].id).toBe('9')
    // Also this, but the text is more length, so it has less score.
    expect(results[1].id).toBe('0')
    // This contains the word "Sunlight", so it match as prefix and not as a word.
    expect(results[2].id).toBe('5')
  })

  it('stormy night', async () => {
    const results = await searchNew(s, {
      term: 'storm night'
    })

    expect(results.length).toBe(2)
    // This mention the storm twice
    expect(results[0].id).toBe('7')
    // this mention night only once
    expect(results[1].id).toBe('3')
    // For this reason, the first document has more score
    expect(results[0].score > results[1].score).toBeTruthy()
  })

  it('trees casting sun', async () => {
    const results = await searchNew(s, {
      term: 'trees casting sun'
    })

    expect(results.length).toBe(5)

    // This contains the word "sun" and "trees" and "casting"
    // Also, "sun" & "casting" are in the same sentence.
    expect(results[0].id).toBe('0')

    // This contains "trees" and "sun" ("Sunlight") also "casting" but not in the same sentence.
    // This score is high because "Sunlight" (so "sun") and "casting" are in the same sentence.
    expect(results[1].id).toBe('5')

    // This contains only "trees"
    expect(results[2].id).toBe('7')

    // This contains only "sun".
    // This score is less (compared to the previous one) because the sentences are longer.
    expect(results[3].id).toBe('9')

    // This contains only "casting"
    // Again, the score is less because the sentences are longer.
    expect(results[4].id).toBe('2')
  })

  it('the sound of pencils scratching on paper', async () => {
    const results = await searchNew(s, {
      term: 'the sound of pencils scratching on paper'
    })

    console.log(results.length)

    expect(results.length).toBe(9)

    // This contains a lot of word in the same sentence.
    expect(results[0].id).toBe('8')
    // This contains 2 words in the same sentence.
    expect(results[1].id).toBe('3')

    // The remaining documents contain only "of" word.
    expect(results[2].id).toBe('6')
    expect(results[3].id).toBe('1')
    expect(results[4].id).toBe('4')
    expect(results[5].id).toBe('9')
    expect(results[6].id).toBe('5')
    expect(results[7].id).toBe('0')

    // This contains "of" in term of "offering", so it has less score.
    expect(results[8].id).toBe('7')
  })
})

function permutator<T>(inputArr: T[]): T[][] {
  const result: T[][] = []

  const permute = (arr, m = []) => {
    if (arr.length === 0) {
      result.push(m)
    } else {
      for (let i = 0; i < arr.length; i++) {
        const curr = arr.slice()
        const next = curr.splice(i, 1)
        permute(curr.slice(), m.concat(next))
      }
    }
  }

  permute(inputArr)

  return result
}
