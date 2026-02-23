import fs from 'fs'
import path from 'path'
import { slugify, parseDateValue, generateId } from './utils.js'
import { listBlogEntries, parseBlogPost } from './filesystem.js'

/**
 * Parse tags.md for tag descriptions.
 * Format: ## tag-slug\nDescription paragraph(s)\n
 */
export function parseTagDescriptions(content) {
  const descriptions = {}
  const sections = content.split(/^## /m).slice(1)
  for (const section of sections) {
    const lines = section.split('\n')
    const slug = lines[0].trim()
    const desc = lines.slice(1).join('\n').trim()
    if (slug && desc) {
      descriptions[slug] = desc
    }
  }
  return descriptions
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
      const { frontmatter, title, summary } = await parseBlogPost(entry.indexPath, entryBaseUrl)

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

  // Sync tag descriptions from tags.md
  const tagsPath = path.join(contentDir, 'tags.md')
  try {
    const tagsContent = await fs.promises.readFile(tagsPath, 'utf8')
    const descriptions = parseTagDescriptions(tagsContent)
    for (const [slug, description] of Object.entries(descriptions)) {
      database.updateTagDescription(slug, description)
    }
  } catch {
    // tags.md is optional
  }

  return changed
}
