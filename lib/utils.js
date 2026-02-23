import { randomBytes } from 'crypto'

export function slugify(value = '') {
  return value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'post'
}

export function formatMonthDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}${day}`
}

export function parseDateValue(dateValue) {
  if (!dateValue) return null
  const match = String(dateValue).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!match) return null
  const month = Number(match[1])
  const day = Number(match[2])
  let year = Number(match[3])
  if (year < 100) year += 2000
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export function resolveAssetPath(value, baseUrl) {
  if (!value) return value
  const trimmed = value.trim()
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed
  const cleaned = trimmed.replace(/^\.\/?/, '')
  return `${baseUrl}/${cleaned}`
}

export function normalizeMarkdownAssets(markdown, baseUrl) {
  // Convert Obsidian ![[]] syntax to standard markdown
  let updated = markdown.replace(/!\[\[([^\]]+)\]\]/g, (_match, inner) => {
    const cleaned = inner.split('|')[0].trim()
    const resolved = resolveAssetPath(cleaned, baseUrl)
    return `![](${resolved})`
  })
  // Resolve relative paths in standard markdown images
  updated = updated.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    const resolved = resolveAssetPath(url, baseUrl)
    return `![${alt}](${resolved})`
  })
  return updated
}

export function generateId() {
  return randomBytes(12).toString('hex')
}
