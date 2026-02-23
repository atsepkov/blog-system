import Fuse from 'fuse.js'

function normalizeSlug(slug) {
  return slug
    .toLowerCase()
    .replace(/[''"\u2018\u2019\u201C\u201D\u2011\u2013\u2014]/g, '')
    .replace(/[^\w-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function createSlugMatcher() {
  let slugIndex = null
  let slugList = []

  function build(slugs) {
    slugList = slugs.map(slug => ({
      slug,
      normalized: normalizeSlug(slug),
    }))
    slugIndex = new Fuse(slugList, {
      keys: ['slug', 'normalized'],
      threshold: 0.4,
      includeScore: true,
    })
  }

  function find(requestedSlug) {
    if (!slugIndex) return null
    const normalized = normalizeSlug(requestedSlug)

    // Tier 1: Exact normalized match (handles apostrophe/dash variations)
    const exactMatch = slugList.find(p => p.normalized === normalized)
    if (exactMatch) return exactMatch.slug

    // Tier 2: Fuse.js fuzzy match for typos
    const results = slugIndex.search(requestedSlug)
    if (results.length && results[0].score < 0.3) {
      return results[0].item.slug
    }

    // Tier 3: Jaccard word overlap for renamed posts
    const requestedWords = new Set(normalized.split('-'))
    let bestOverlap = null
    let bestOverlapRatio = 0
    for (const entry of slugList) {
      const entryWords = new Set(entry.normalized.split('-'))
      const intersection = [...requestedWords].filter(w => entryWords.has(w))
      const union = new Set([...requestedWords, ...entryWords])
      const ratio = intersection.length / union.size
      if (ratio > bestOverlapRatio) {
        bestOverlapRatio = ratio
        bestOverlap = entry.slug
      }
    }
    if (bestOverlap && bestOverlapRatio >= 0.8) {
      return bestOverlap
    }

    return null
  }

  return { build, find }
}
