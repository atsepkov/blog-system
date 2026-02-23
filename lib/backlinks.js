export function createBacklinks(blogPathPrefix = '/blog/') {
  let backlinksMap = {} // { targetSlug: [sourceSlug, ...] }

  // Escape prefix for use in regex
  const escapedPrefix = blogPathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const absoluteRegex = new RegExp(`href=["']${escapedPrefix}([a-z0-9-]+)`, 'gi')

  function extractInternalLinks(htmlContent) {
    const links = []

    // Absolute links: /blog/slug-here (or whatever prefix)
    let match
    absoluteRegex.lastIndex = 0
    while ((match = absoluteRegex.exec(htmlContent)) !== null) {
      links.push(match[1])
    }

    // Relative links: bare slug (no path separators, no extension)
    const relativeRegex = /href=["']([a-z][a-z0-9-]+)["']/gi
    while ((match = relativeRegex.exec(htmlContent)) !== null) {
      links.push(match[1])
    }

    return [...new Set(links)]
  }

  function build(postContents) {
    // postContents: [{ slug, content (HTML) }, ...]
    const forwardLinks = {}
    for (const { slug, content } of postContents) {
      forwardLinks[slug] = extractInternalLinks(content)
    }

    // Invert to get backlinks
    backlinksMap = {}
    for (const [source, targets] of Object.entries(forwardLinks)) {
      for (const target of targets) {
        if (!backlinksMap[target]) backlinksMap[target] = []
        if (!backlinksMap[target].includes(source)) {
          backlinksMap[target].push(source)
        }
      }
    }
  }

  function get(slug) {
    return backlinksMap[slug] || []
  }

  return { extractInternalLinks, build, get }
}
