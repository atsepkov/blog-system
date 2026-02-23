/**
 * Compute a numeric score for ranking related posts.
 * 4-tier system matching investomation's existing logic:
 *   Rank 0: Direct link or backlink WITH shared tags (strongest)
 *   Rank 1: Direct link or backlink only
 *   Rank 2: Multiple shared tags (2+)
 *   Rank 3: Single shared tag
 *   Rank 4: No relationship (excluded)
 */
export function computeScore({ sharedTagCount = 0, isDirectLink = false, isBacklink = false }) {
  const linked = isDirectLink || isBacklink
  if (linked && sharedTagCount > 0) return 0
  if (linked) return 1
  if (sharedTagCount > 1) return 2
  if (sharedTagCount === 1) return 3
  return 4
}

/**
 * Get related posts for a given post slug.
 *
 * @param {string} slug - The slug of the current post
 * @param {object} options
 * @param {number} options.limit - Max results (default 6)
 * @param {object} deps - Injected dependencies
 * @param {object} deps.database - Database module instance
 * @param {object} deps.backlinks - Backlinks module instance
 * @returns {Array} Scored and ranked related posts
 */
export function getRelatedPosts(slug, { limit = 6 } = {}, { database, backlinks }) {
  const post = database.getPostBySlug(slug)
  if (!post) return []

  const postTags = database.getTagsForPost(post.id)
  const tagSet = new Set(postTags.map(t => t.slug))

  // Get forward links from this post's content
  const forwardLinkSlugs = backlinks.extractInternalLinks(
    // We need the post's HTML content — load it on demand
    // The caller should have already loaded content; if not, use empty
    post._content || ''
  )

  // Get backlinks pointing to this post
  const backlinkSlugs = new Set(backlinks.get(slug))

  // Collect candidate posts from tags
  const candidates = new Map() // slug -> post data

  // Posts sharing tags
  if (tagSet.size > 0) {
    const tagSlugs = [...tagSet]
    // Get all posts that share at least one tag
    for (const tagSlug of tagSlugs) {
      const { items } = database.listPosts({ tags: [tagSlug], limit: 100, offset: 0 })
      for (const item of items) {
        if (item.slug !== slug && !candidates.has(item.slug)) {
          candidates.set(item.slug, item)
        }
      }
    }
  }

  // Posts that are forward-linked
  for (const linkedSlug of forwardLinkSlugs) {
    if (linkedSlug !== slug && !candidates.has(linkedSlug)) {
      const linkedPost = database.getPostBySlug(linkedSlug)
      if (linkedPost) candidates.set(linkedSlug, linkedPost)
    }
  }

  // Posts that backlink to this one
  for (const blSlug of backlinkSlugs) {
    if (blSlug !== slug && !candidates.has(blSlug)) {
      const blPost = database.getPostBySlug(blSlug)
      if (blPost) candidates.set(blSlug, blPost)
    }
  }

  // Score each candidate
  const scored = []
  for (const [candidateSlug, candidatePost] of candidates) {
    const candidateTags = database.getTagsForPost(candidatePost.id)
    const sharedTagCount = candidateTags.filter(t => tagSet.has(t.slug)).length
    const isDirectLink = forwardLinkSlugs.includes(candidateSlug)
    const isBacklink = backlinkSlugs.has(candidateSlug)
    const score = computeScore({ sharedTagCount, isDirectLink, isBacklink })

    if (score >= 4) continue // No relationship

    scored.push({
      slug: candidateSlug,
      title: candidatePost.title,
      thumbnail: candidatePost.thumbnail,
      created: candidatePost.created,
      sharedTags: candidateTags.filter(t => tagSet.has(t.slug)).map(t => t.slug),
      isDirectLink,
      isBacklink,
      score,
      source: 'self',
    })
  }

  // Sort: rank asc, then shared tag count desc, then created desc
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (b.sharedTags.length !== a.sharedTags.length) return b.sharedTags.length - a.sharedTags.length
    return b.created - a.created
  })

  return scored.slice(0, limit)
}
