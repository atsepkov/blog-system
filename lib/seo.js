/**
 * Build a meta object from a post for OG/Twitter tags.
 */
export function getPostMeta(post, siteUrl) {
  const description = post.summary
    ? post.summary.replace(/<[^>]*>/g, '').slice(0, 160)
    : ''
  const published = post.created
    ? new Date(post.created).toISOString().split('T')[0]
    : undefined

  return {
    title: post.title,
    description,
    type: 'article',
    url: `${siteUrl}${post._baseUrl || '/blog'}/${post.slug}`,
    image: post.thumbnail || post.media
      ? (post.thumbnail || post.media).startsWith('http')
        ? post.thumbnail || post.media
        : `${siteUrl}${post.thumbnail || post.media}`
      : undefined,
    canonical: `${siteUrl}${post._baseUrl || '/blog'}/${post.slug}`,
    published,
  }
}

function esc(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Render OG + Twitter meta tags as an HTML string.
 */
export function renderMetaTags(meta) {
  const tags = []
  if (meta.title) {
    tags.push(`<meta property="og:title" content="${esc(meta.title)}">`)
    tags.push(`<meta name="twitter:title" content="${esc(meta.title)}">`)
  }
  if (meta.description) {
    tags.push(`<meta property="og:description" content="${esc(meta.description)}">`)
    tags.push(`<meta name="twitter:description" content="${esc(meta.description)}">`)
  }
  if (meta.type) {
    tags.push(`<meta property="og:type" content="${esc(meta.type)}">`)
  }
  if (meta.url) {
    tags.push(`<meta property="og:url" content="${esc(meta.url)}">`)
  }
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${esc(meta.image)}">`)
    tags.push(`<meta name="twitter:image" content="${esc(meta.image)}">`)
  }
  tags.push(`<meta name="twitter:card" content="summary_large_image">`)
  if (meta.canonical) {
    tags.push(`<link rel="canonical" href="${esc(meta.canonical)}">`)
  }
  if (meta.published) {
    tags.push(`<meta property="article:published_time" content="${esc(meta.published)}">`)
  }
  return tags.join('\n    ')
}

/**
 * Build a sitemap XML string.
 * @param {Array} posts - Blog posts from database (need slug, created)
 * @param {string} siteUrl - Full site URL (e.g. https://example.com)
 * @param {string} baseUrl - Blog URL prefix (e.g. /blog)
 * @param {Array} extraEntries - Consumer's additional sitemap entries [{loc, changefreq, priority, lastmod}]
 */
export function buildSitemap(posts, siteUrl, baseUrl, extraEntries = []) {
  const entries = [...extraEntries]

  for (const post of posts) {
    entries.push({
      loc: `${baseUrl}/${post.slug}`,
      lastmod: post.created
        ? new Date(post.created).toISOString().split('T')[0]
        : undefined,
      changefreq: 'monthly',
      priority: '0.8',
    })
  }

  const urls = entries.map(e => {
    const lastmod = e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ''
    return `  <url>
    <loc>${esc(siteUrl)}${esc(e.loc)}</loc>${lastmod}
    <changefreq>${e.changefreq || 'monthly'}</changefreq>
    <priority>${e.priority || '0.5'}</priority>
  </url>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

/**
 * Render a minimal HTML page for a blog post.
 * For consumers without their own SSR/templating (like host-horse).
 */
export function renderPostPage(post, meta, options = {}) {
  const { siteName = '', extraHead = '', extraBody = '' } = options
  const titleSuffix = siteName ? ` | ${esc(siteName)}` : ''
  const metaTags = renderMetaTags(meta)

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(post.title)}${titleSuffix}</title>
    <meta name="description" content="${esc(meta.description)}">
    ${metaTags}
    ${extraHead}
</head>
<body>
    <article>
        <h1>${esc(post.title)}</h1>
        ${post.content || ''}
    </article>
    ${extraBody}
</body>
</html>`
}
