import fs from 'fs'
import path from 'path'
import { slugify, parseDateValue, generateId } from './utils.js'
import { listBlogEntries, parseBlogPost } from './filesystem.js'

/**
 * Parse tags.md for tag descriptions and themes.
 * Format:
 *   ## tag-slug
 *   theme: software
 *   Description paragraph(s)
 *
 * Tags without a theme: line default to 'shared'.
 */
export function parseTagDescriptions(content) {
  const tags = {}
  const sections = content.split(/^## /m).slice(1)
  for (const section of sections) {
    const lines = section.split('\n')
    const slug = lines[0].trim()
    if (!slug) continue

    let theme = 'shared'
    let descStart = 1
    // Check if the first non-empty line after the slug is a theme directive
    const firstLine = (lines[1] || '').trim()
    const themeMatch = firstLine.match(/^theme:\s*(.+)$/i)
    if (themeMatch) {
      theme = themeMatch[1].trim()
      descStart = 2
    }
    const desc = lines.slice(descStart).join('\n').trim()
    tags[slug] = { description: desc || null, theme }
  }
  return tags
}

/**
 * Sync filesystem blog entries to the database.
 * Creates missing posts, removes stale ones, cleans orphan tags.
 */
export async function syncFilesystem(contentDir, baseUrl, database) {
  const entries = await listBlogEntries(contentDir)
  const existingSlugs = new Set(database.getAllSlugs())
  let changed = false

  // Add missing entries
  for (const entry of entries) {
    const entrySlug = slugify(entry.slug)
    if (existingSlugs.has(entrySlug)) continue

    try {
      const entryBaseUrl = `${baseUrl}/${entry.year}/${entry.dirName}`
      const { frontmatter, title, summary } = await parseBlogPost(entry.indexPath, entryBaseUrl, baseUrl)

      const parsedDate = parseDateValue(frontmatter.date)
      if (!parsedDate) {
        console.warn(`Skipping ${entry.indexPath}: invalid date "${frontmatter.date}"`)
        continue
      }

      const tags = Array.isArray(frontmatter.blog_tags)
        ? frontmatter.blog_tags
        : (typeof frontmatter.blog_tags === 'string'
          ? frontmatter.blog_tags.split(',').map(t => t.trim()).filter(Boolean)
          : [])

      const postId = generateId()
      database.insertPost({
        id: postId,
        title,
        slug: entrySlug,
        summary,
        author: frontmatter.author || null,
        media: `${entryBaseUrl}/thumb.webp`,
        thumbnail: `${entryBaseUrl}/thumb.webp`,
        created: parsedDate.getTime(),
        dirPath: entry.dirPath,
      })

      for (const tagName of tags) {
        const tagSlug = slugify(tagName)
        const tag = database.getOrCreateTag(tagSlug, tagName)
        database.linkPostTag(postId, tag.id)
      }

      existingSlugs.add(entrySlug)
      changed = true
    } catch (err) {
      console.warn(`Failed to index ${entry.indexPath}:`, err.message)
    }
  }

  // Remove stale entries (in DB but not on filesystem)
  const fsSlugs = new Set(entries.map(e => slugify(e.slug)))
  const allPosts = database.getAllPosts()
  for (const post of allPosts) {
    if (!fsSlugs.has(slugify(post.slug))) {
      database.deletePost(post.id)
      changed = true
    }
  }

  // Clean orphan tags
  database.deleteOrphanTags()

  // Sync tag descriptions and themes from tags.md
  const tagsPath = path.join(contentDir, 'tags.md')
  try {
    const tagsContent = await fs.promises.readFile(tagsPath, 'utf8')
    const tagDefs = parseTagDescriptions(tagsContent)
    for (const [rawSlug, { description, theme }] of Object.entries(tagDefs)) {
      const slug = slugify(rawSlug)
      if (description) database.updateTagDescription(slug, description)
      database.updateTagTheme(slug, theme)
    }
  } catch {
    // tags.md is optional
  }

  return changed
}
