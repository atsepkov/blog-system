import fs from 'fs'
import path from 'path'
import { slugify, formatMonthDay, normalizeMarkdownAssets } from './utils.js'
import { renderMarkdown } from './markdown.js'

export function parseFrontmatter(lines) {
  const data = {}
  if (!lines.length || lines[0].trim() !== '---') {
    return { data, bodyLines: lines }
  }
  let i = 1
  let currentKey = null
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '---') { i += 1; break }
    if (!line.trim()) continue
    const listMatch = line.match(/^\s*-\s+(.+)$/)
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = []
      data[currentKey].push(listMatch[1].trim())
      continue
    }
    const kvMatch = line.match(/^([^:]+):\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1].trim()
      const value = kvMatch[2].trim()
      if (value) {
        data[key] = value
        currentKey = null
      } else {
        data[key] = []
        currentKey = key
      }
    }
  }
  return { data, bodyLines: lines.slice(i) }
}

export async function parseBlogPost(indexPath, baseUrl) {
  const raw = await fs.promises.readFile(indexPath, 'utf8')
  const lines = raw.split(/\r?\n/)
  const { data: frontmatter, bodyLines } = parseFrontmatter(lines)
  const body = normalizeMarkdownAssets(bodyLines.join('\n'), baseUrl)
  const bodyLineList = body.split(/\r?\n/)
  const contentLines = []
  let title = null
  let summary = ''

  for (const line of bodyLineList) {
    contentLines.push(line)
    if (!title && /^#+\s+/.test(line)) {
      title = line.replace(/^#+\s+/, '').trim()
    }
    if (
      line.trim().length &&
      !/^#+\s+/.test(line) &&
      !/^!\[/.test(line) &&
      !/^!\[\[/.test(line) &&
      summary.length < 1000
    ) {
      summary += line + ' '
    }
  }

  if (!title) throw new Error(`Missing title heading in ${indexPath}`)

  summary = summary.trim().replace(/\s+/g, ' ')
  if (summary && summary.slice(-1) !== '.') summary += '...'
  if (summary) {
    summary = renderMarkdown(summary).replace(/^<p>|<\/p>\n?$/g, '')
  }

  const content = renderMarkdown(contentLines.join('\n'))

  return { frontmatter, title, summary, content }
}

export async function listBlogEntries(contentDir) {
  let yearEntries = []
  try {
    yearEntries = await fs.promises.readdir(contentDir, { withFileTypes: true })
  } catch {
    return []
  }
  const years = yearEntries
    .filter(entry => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map(entry => entry.name)

  const entries = []
  for (const year of years) {
    const yearDir = path.join(contentDir, year)
    const posts = await fs.promises.readdir(yearDir, { withFileTypes: true })
    posts
      .filter(entry => entry.isDirectory())
      .forEach(entry => {
        const match = entry.name.match(/^(\d{4})-(.+)$/)
        if (!match) return
        const [, monthDay, slug] = match
        entries.push({
          year,
          monthDay,
          slug,
          dirName: entry.name,
          dirPath: path.join(yearDir, entry.name),
          indexPath: path.join(yearDir, entry.name, 'index.md'),
        })
      })
  }
  return entries
}

export async function findEntryBySlug(contentDir, slug) {
  const entries = await listBlogEntries(contentDir)
  return entries.find(entry => entry.slug === slug || slugify(entry.slug) === slug)
}

export async function resolveBlogEntryForPost(contentDir, post) {
  const createdDate = new Date(post.created)
  if (Number.isNaN(createdDate.getTime())) {
    return findEntryBySlug(contentDir, post.slug)
  }
  const year = String(createdDate.getFullYear())
  const monthDay = formatMonthDay(createdDate)
  const dirName = `${monthDay}-${post.slug}`
  const dirPath = path.join(contentDir, year, dirName)
  const indexPath = path.join(dirPath, 'index.md')
  try {
    await fs.promises.access(indexPath)
    return { year, monthDay, slug: post.slug, dirName, dirPath, indexPath }
  } catch {
    return findEntryBySlug(contentDir, post.slug)
  }
}
