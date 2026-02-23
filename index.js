import path from 'path'
import { createDatabase } from './lib/database.js'
import { createSlugMatcher } from './lib/slugs.js'
import { createBacklinks } from './lib/backlinks.js'
import { syncFilesystem } from './lib/sync.js'
import { resolveBlogEntryForPost, parseBlogPost } from './lib/filesystem.js'
import { getRelatedPosts as computeRelated } from './lib/related.js'
import { getPostMeta as buildPostMeta, renderMetaTags as renderMeta, buildSitemap as buildSitemapXml, renderPostPage as renderPage } from './lib/seo.js'

export { computeScore } from './lib/related.js'
export { getPostMeta, renderMetaTags, buildSitemap, renderPostPage } from './lib/seo.js'

export function createBlog(config) {
  const {
    contentDir,
    db,
    baseUrl = '/blog',
    blogPathPrefix = '/blog/',
    siteUrl = '',
  } = config

  const database = createDatabase(db)
  const slugMatcher = createSlugMatcher()
  const backlinks = createBacklinks(blogPathPrefix)

  async function init() {
    database.initSchema()
    await resync()
  }

  async function resync() {
    await syncFilesystem(contentDir, baseUrl, database)
    // Rebuild slug index
    slugMatcher.build(database.getAllSlugs())
    // Rebuild backlinks (requires loading content for all posts)
    await rebuildBacklinks()
  }

  async function rebuildBacklinks() {
    const posts = database.getAllPosts()
    const postContents = []
    for (const post of posts) {
      try {
        const fullPost = database.getPostBySlug(post.slug)
        if (!fullPost) continue
        const entry = await resolveBlogEntryForPost(contentDir, fullPost)
        if (!entry) continue
        const entryBaseUrl = `${baseUrl}/${entry.year}/${entry.dirName}`
        const { content } = await parseBlogPost(entry.indexPath, entryBaseUrl)
        postContents.push({ slug: post.slug, content })
      } catch {
        // Skip posts that can't be loaded
      }
    }
    backlinks.build(postContents)
  }

  function listPosts(opts) {
    const result = database.listPosts(opts)
    // Attach tags to each post
    result.items = result.items.map(item => ({
      ...item,
      tags: database.getTagsForPost(item.id),
    }))
    return result
  }

  async function getPost(slug) {
    const post = database.getPostBySlug(slug)
    if (!post) return null

    const entry = await resolveBlogEntryForPost(contentDir, post)
    if (!entry) return { ...post, content: null, tags: database.getTagsForPost(post.id), backlinks: backlinks.get(slug) }

    const entryBaseUrl = `${baseUrl}/${entry.year}/${entry.dirName}`
    const { content } = await parseBlogPost(entry.indexPath, entryBaseUrl)
    const tags = database.getTagsForPost(post.id)

    return {
      ...post,
      content,
      tags,
      backlinks: backlinks.get(slug),
    }
  }

  function findSlug(slug) {
    // First check exact DB match
    const exact = database.getPostBySlug(slug)
    if (exact) return exact.slug
    // Then fuzzy
    return slugMatcher.find(slug)
  }

  function listTags(opts) {
    return database.listTags(opts)
  }

  function getPostsByTag(tagSlug, opts = {}) {
    return database.listPosts({ ...opts, tags: [tagSlug] })
  }

  function getRelatedPosts(slug, opts = {}) {
    // Load content for scoring forward links
    const post = database.getPostBySlug(slug)
    if (!post) return []

    // Attach cached content hint for related scoring
    // The related module needs to extract forward links from HTML
    // We pass a lightweight proxy with _content set
    return computeRelated(slug, opts, { database, backlinks })
  }

  function getPostMeta(postOrSlug) {
    const post = typeof postOrSlug === 'string'
      ? database.getPostBySlug(postOrSlug)
      : postOrSlug
    if (!post) return null
    return buildPostMeta({ ...post, _baseUrl: baseUrl }, siteUrl)
  }

  function renderMetaTags(meta) {
    return renderMeta(meta)
  }

  function buildSitemap(extraEntries = []) {
    const { items } = database.listPosts({ limit: 10000 })
    return buildSitemapXml(items, siteUrl, baseUrl, extraEntries)
  }

  function renderPostPage(post, meta, options) {
    return renderPage(post, meta, options)
  }

  return {
    init,
    resync,
    listPosts,
    getPost,
    findSlug,
    listTags,
    getPostsByTag,
    getRelatedPosts,
    getPostMeta,
    renderMetaTags,
    buildSitemap,
    renderPostPage,
  }
}
