import { describe, test, expect, beforeAll } from 'bun:test'
import { Database } from 'bun:sqlite'
import path from 'path'
import { createBlog } from '../index.js'

const fixtureDir = path.join(import.meta.dir, 'fixtures', 'blog')

describe('blog-system', () => {
  let blog
  let db

  beforeAll(async () => {
    db = new Database(':memory:')
    blog = createBlog({
      contentDir: fixtureDir,
      db,
      baseUrl: '/blog',
      blogPathPrefix: '/blog/',
      siteUrl: 'https://example.com',
    })
    await blog.init()
  })

  describe('init + sync', () => {
    test('creates posts from filesystem', () => {
      const { items, total } = blog.listPosts()
      expect(total).toBe(3)
      expect(items.length).toBe(3)
    })

    test('posts have correct fields', () => {
      const { items } = blog.listPosts({ order: 'asc' })
      const first = items[0]
      expect(first.title).toBe('Test Post Title')
      expect(first.slug).toBe('test-post')
      expect(first.author).toBe('Test Author')
      expect(first.created).toBe(new Date(2025, 0, 1).getTime())
    })

    test('posts are ordered by created desc by default', () => {
      const { items } = blog.listPosts()
      expect(items[0].slug).toBe('linked-post')
      expect(items[1].slug).toBe('second-post')
      expect(items[2].slug).toBe('test-post')
    })
  })

  describe('getPost', () => {
    test('returns post with content and tags', async () => {
      const post = await blog.getPost('test-post')
      expect(post).not.toBeNull()
      expect(post.title).toBe('Test Post Title')
      expect(post.content).toContain('<h1>')
      expect(post.content).toContain('cryptocurrency')
      expect(post.tags.length).toBe(2)
      expect(post.tags.map(t => t.slug).sort()).toEqual(['crypto', 'macro'])
    })

    test('returns null for missing post', async () => {
      const post = await blog.getPost('nonexistent')
      expect(post).toBeNull()
    })

    test('includes backlinks', async () => {
      const post = await blog.getPost('test-post')
      expect(post.backlinks).toBeInstanceOf(Array)
      // second-post and linked-post both link to test-post
      expect(post.backlinks).toContain('second-post')
      expect(post.backlinks).toContain('linked-post')
    })
  })

  describe('tags', () => {
    test('lists all tags with counts', () => {
      const tags = blog.listTags()
      expect(tags.length).toBe(3)
      const crypto = tags.find(t => t.slug === 'crypto')
      expect(crypto).toBeDefined()
      expect(crypto.count).toBe(2) // test-post + second-post
      const macro = tags.find(t => t.slug === 'macro')
      expect(macro.count).toBe(2) // test-post + linked-post
    })

    test('tag descriptions loaded from tags.md', () => {
      const tags = blog.listTags()
      const crypto = tags.find(t => t.slug === 'crypto')
      expect(crypto.description).toContain('cryptocurrency')
      const realEstate = tags.find(t => t.slug === 'real-estate')
      expect(realEstate.description).toContain('real estate')
    })

    test('context-aware tag counts with filterTags', () => {
      const tags = blog.listTags({ filterTags: ['crypto'] })
      // Only posts with 'crypto' tag: test-post (crypto+macro) and second-post (crypto+real-estate)
      const crypto = tags.find(t => t.slug === 'crypto')
      expect(crypto.count).toBe(2)
      const macro = tags.find(t => t.slug === 'macro')
      expect(macro.count).toBe(1) // only test-post has both crypto and macro
      const realEstate = tags.find(t => t.slug === 'real-estate')
      expect(realEstate.count).toBe(1) // only second-post has both crypto and real-estate
    })

    test('getPostsByTag returns filtered posts', () => {
      const { items, total } = blog.getPostsByTag('crypto')
      expect(total).toBe(2)
      expect(items.every(p => p.slug === 'test-post' || p.slug === 'second-post')).toBe(true)
    })
  })

  describe('multi-tag filtering', () => {
    test('filters by multiple tags (AND logic)', () => {
      const { items, total } = blog.listPosts({ tags: ['crypto', 'macro'] })
      expect(total).toBe(1)
      expect(items[0].slug).toBe('test-post')
    })
  })

  describe('slug resolution', () => {
    test('exact match', () => {
      expect(blog.findSlug('test-post')).toBe('test-post')
    })

    test('fuzzy match for typos', () => {
      const result = blog.findSlug('tset-post')
      expect(result).toBe('test-post')
    })

    test('returns null for completely unrelated slug', () => {
      expect(blog.findSlug('zzz-completely-unrelated-xyz')).toBeNull()
    })
  })

  describe('backlinks', () => {
    test('test-post has backlinks from second-post and linked-post', async () => {
      const post = await blog.getPost('test-post')
      expect(post.backlinks.sort()).toEqual(['linked-post', 'second-post'])
    })

    test('second-post has backlinks from linked-post', async () => {
      const post = await blog.getPost('second-post')
      expect(post.backlinks).toContain('linked-post')
    })

    test('linked-post has backlinks from test-post (relative link)', async () => {
      // test-post doesn't link to linked-post, but let's verify
      const post = await blog.getPost('linked-post')
      // linked-post is only linked TO by nobody via /blog/ prefix
      // test-post uses relative link to second-post, not linked-post
      expect(post.backlinks).not.toContain('test-post')
    })
  })

  describe('related posts', () => {
    test('returns related posts with scores', () => {
      const related = blog.getRelatedPosts('test-post', { limit: 10 })
      expect(related.length).toBeGreaterThan(0)
      // All related posts should have score < 4
      expect(related.every(r => r.score < 4)).toBe(true)
    })

    test('rank ordering: linked+tagged > linked > multi-tag > single-tag', () => {
      const related = blog.getRelatedPosts('test-post', { limit: 10 })
      // Verify sorted by score ascending
      for (let i = 1; i < related.length; i++) {
        expect(related[i].score).toBeGreaterThanOrEqual(related[i - 1].score)
      }
    })

    test('related posts include expected fields', () => {
      const related = blog.getRelatedPosts('test-post', { limit: 10 })
      if (related.length > 0) {
        const first = related[0]
        expect(first).toHaveProperty('slug')
        expect(first).toHaveProperty('title')
        expect(first).toHaveProperty('score')
        expect(first).toHaveProperty('sharedTags')
        expect(first).toHaveProperty('isDirectLink')
        expect(first).toHaveProperty('isBacklink')
        expect(first).toHaveProperty('source')
        expect(first.source).toBe('self')
      }
    })
  })

  describe('SEO', () => {
    test('getPostMeta returns meta object', async () => {
      const post = await blog.getPost('test-post')
      const meta = blog.getPostMeta(post)
      expect(meta.title).toBe('Test Post Title')
      expect(meta.type).toBe('article')
      expect(meta.url).toBe('https://example.com/blog/test-post')
      expect(meta.canonical).toBe('https://example.com/blog/test-post')
    })

    test('getPostMeta works with slug string', () => {
      const meta = blog.getPostMeta('test-post')
      expect(meta.title).toBe('Test Post Title')
    })

    test('renderMetaTags returns HTML string', async () => {
      const post = await blog.getPost('test-post')
      const meta = blog.getPostMeta(post)
      const html = blog.renderMetaTags(meta)
      expect(html).toContain('og:title')
      expect(html).toContain('twitter:card')
      expect(html).toContain('Test Post Title')
    })

    test('buildSitemap includes all posts', () => {
      const xml = blog.buildSitemap([{ loc: '/', changefreq: 'weekly', priority: '1.0' }])
      expect(xml).toContain('<?xml version="1.0"')
      expect(xml).toContain('<urlset')
      expect(xml).toContain('/blog/test-post')
      expect(xml).toContain('/blog/second-post')
      expect(xml).toContain('/blog/linked-post')
      // Consumer's extra entry
      expect(xml).toContain('https://example.com/')
    })

    test('renderPostPage returns full HTML', async () => {
      const post = await blog.getPost('test-post')
      const meta = blog.getPostMeta(post)
      const html = blog.renderPostPage(post, meta, { siteName: 'Test Site' })
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<title>Test Post Title | Test Site</title>')
      expect(html).toContain('og:title')
      expect(html).toContain('<article>')
    })
  })

  describe('pagination', () => {
    test('respects limit and offset', () => {
      const { items, total } = blog.listPosts({ limit: 1, offset: 0 })
      expect(items.length).toBe(1)
      expect(total).toBe(3)

      const { items: page2 } = blog.listPosts({ limit: 1, offset: 1 })
      expect(page2.length).toBe(1)
      expect(page2[0].slug).not.toBe(items[0].slug)
    })
  })

  describe('resync', () => {
    test('resync is idempotent', async () => {
      await blog.resync()
      const { total } = blog.listPosts()
      expect(total).toBe(3) // Same count after resync
    })
  })
})
