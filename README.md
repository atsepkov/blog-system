# blog-system

A reusable blog engine that reads markdown from disk, indexes it in SQLite, and handles all the tedious stuff -- fuzzy URL resolution, backlinks, related posts, SEO tags, sitemaps.

Extracted from [investomation.com](https://investomation.com) (a real estate analytics platform) where it's been running in production. I needed the same blog engine for another project (host-horse) and didn't want to copy-paste ~500 lines of blog logic. So I pulled it out into a standalone package.

Both projects reference it via `file:../blog-system` in their `package.json`. No npm publish, no version drama. Just a shared local dependency.

## What it does

- Reads markdown posts from a `YYYY/MMDD-slug/` directory tree
- Indexes metadata in SQLite for fast queries (content always loaded from disk)
- Resolves fuzzy URLs so old links survive post renames and typos
- Tracks backlinks between posts and scores related posts
- Generates OG tags, Twitter cards, sitemap XML, and minimal SSR pages
- Works with both `bun:sqlite` and `better-sqlite3` -- you provide the DB instance

## What it doesn't do

- No HTTP framework opinions. You wire up your own routes.
- No content stored in the database. Markdown files are the source of truth.
- No build step, no bundling, no CLI. It's a library.

## Quick start

```js
import { createBlog } from 'blog-system'

const blog = createBlog({
  contentDir: './blog',             // path to your YYYY/MMDD-slug/ tree
  db: sqliteInstance,               // bun:sqlite or better-sqlite3
  baseUrl: '/blog',                 // URL prefix for asset paths
  blogPathPrefix: '/blog/',         // prefix for detecting internal links
  siteUrl: 'https://example.com',   // for canonical URLs and sitemap
})

await blog.init()
```

`init()` creates three tables (`blog_post`, `blog_tag`, `blog_post_tag`) alongside whatever else is in your database, then syncs all posts from disk.

## API

### Posts

```js
blog.listPosts({ limit: 12, offset: 0, tags: ['crypto'], order: 'desc' })
// => { items: [...], total: 45 }

await blog.getPost('proximity-analysis')
// => { id, slug, title, summary, content (HTML), created, author, tags, backlinks }
```

### Fuzzy slug resolution

```js
blog.findSlug('proximity-analisys')
// => 'proximity-analysis'
```

This is one of the more useful features. Three tiers of matching:

1. **Exact normalized match** -- strips apostrophes, dashes, smart quotes, then compares. Handles `don't` vs `dont` and similar variations.
2. **Fuse.js fuzzy match** -- catches typos. `proximty-anlaysis` still finds the right post.
3. **Jaccard word overlap** -- handles renamed posts. If you change `my-first-analysis` to `initial-proximity-analysis`, links using the old slug still resolve (as long as word overlap is >= 80%).

Old links don't break. That's the whole point.

### Tags

```js
blog.listTags()
// => [{ slug, name, description, count }, ...]

blog.listTags({ filterTags: ['crypto'] })
// => counts scoped to posts matching ALL selected tags

blog.getPostsByTag('crypto', { limit: 12 })
```

The `filterTags` behavior is worth explaining: when you pass existing tag filters, the counts on each tag reflect "how many posts would remain if you also added this tag." This enables a drill-down filter UI where users can see which tags are worth clicking next.

### Related posts

```js
blog.getRelatedPosts('my-post', { limit: 6 })
```

Related posts are scored using a 4-tier system:

| Rank | Relationship | Example |
|------|-------------|---------|
| 0 | Direct link or backlink AND shared tags | Strongest signal -- the posts reference each other and share topics |
| 1 | Direct link or backlink only | Connected but different topics |
| 2 | Multiple shared tags (2+) | Topically related |
| 3 | Single shared tag | Loosely related |

Within each rank, posts are sorted by shared tag count (descending), then by date (newest first).

### SEO

```js
const meta = blog.getPostMeta('my-post')    // OG/Twitter meta object
const html = blog.renderMetaTags(meta)       // HTML string of meta tags
const xml = blog.buildSitemap([extraEntries]) // sitemap XML
const page = blog.renderPostPage(post, meta)  // full HTML page for SSR
```

`renderPostPage` produces a minimal but valid HTML document. Good enough for crawlers and link previews. If you have your own templating, use `getPostMeta` and `renderMetaTags` instead.

### Maintenance

```js
await blog.resync()
```

Re-reads all posts from disk, rebuilds the slug index and backlink graph. Call this after adding or editing posts. It's fast -- the heavy work is just reading markdown files and parsing frontmatter.

## Content format

Posts live in a directory tree organized by year:

```
blog/
  tags.md                          # optional tag descriptions
  2025/
    0101-my-first-post/
      index.md
      thumb.webp
      chart.png
    0215-another-post/
      index.md
```

The directory name pattern is `MMDD-slug`. Each post gets its own folder so images and assets live next to the markdown.

### Frontmatter

```markdown
---
date: 1/1/25
author: Alex
blog_tags:
  - crypto
  - macro
---
# My Post Title

Content here. Regular markdown.
```

The first `#` heading becomes the post title. The first paragraph of body text becomes the summary.

### Supported syntax

- Standard GitHub-flavored markdown
- GitHub-style alerts (`> [!NOTE]`, `> [!WARNING]`, etc.)
- Obsidian image embeds (`![[image.png]]`)
- All images are rendered with `loading="lazy"`

### Tag descriptions

Create a `tags.md` file in your content root:

```markdown
## crypto

Posts about cryptocurrency markets, Bitcoin analysis, and DeFi protocols.

## macro

Macroeconomic analysis and how it affects real estate and investment markets.
```

Each `## tag-slug` heading followed by paragraph text becomes that tag's description.

## Integration examples

### Bun

```js
import { Database } from "bun:sqlite"
import { createBlog } from "blog-system"

const db = new Database("data/blog.sqlite")
const blog = createBlog({
  contentDir: './blog',
  db,
  baseUrl: '/blog',
  siteUrl: 'https://mysite.com',
})
await blog.init()

// In your fetch handler:
if (url.pathname === '/api/posts') {
  return Response.json(blog.listPosts({ limit: 12 }))
}

if (url.pathname.startsWith('/blog/')) {
  const slug = blog.findSlug(url.pathname.slice(6))
  if (slug) {
    const post = await blog.getPost(slug)
    const meta = blog.getPostMeta(post)
    return new Response(blog.renderPostPage(post, meta), {
      headers: { 'Content-Type': 'text/html' },
    })
  }
}
```

### Node.js / Express

```js
const Database = require('better-sqlite3')
const { createBlog } = require('blog-system')

const db = new Database('data/blog.sqlite')
const blog = createBlog({ contentDir: './blog', db, baseUrl: '/blog' })
await blog.init()

app.get('/api/posts', (req, res) => {
  res.json(blog.listPosts({
    limit: 12,
    tags: req.query.tags?.split(','),
  }))
})
```

### Using as a local dependency

In your project's `package.json`:

```json
{
  "dependencies": {
    "blog-system": "file:../blog-system"
  }
}
```

No publishing required. Both `npm install` and `bun install` handle `file:` references.

## Dependencies

Three runtime dependencies. That's it.

- **[marked](https://github.com/markedjs/marked)** -- markdown to HTML
- **[marked-alert](https://github.com/bent10/marked-extensions/tree/main/packages/alert)** -- GitHub-style alert blocks
- **[fuse.js](https://www.fusejs.io/)** -- fuzzy search for slug resolution

No SQLite dependency -- the consumer provides the database instance, so it works with whatever SQLite binding your runtime already has.

## Database schema

The library creates three tables in your database:

- `blog_post` -- metadata only (title, slug, summary, author, thumbnail, created date, directory path). No content column.
- `blog_tag` -- tag slug, display name, optional description.
- `blog_post_tag` -- junction table with cascading deletes.

These sit alongside whatever other tables you have. The library doesn't touch anything it didn't create.

## Architecture

The codebase is split into focused modules:

```
index.js              # createBlog() factory -- the public API
lib/
  database.js         # SQLite schema + prepared statements
  filesystem.js       # reads YYYY/MMDD-slug/ tree, parses frontmatter
  markdown.js         # marked configuration + Obsidian syntax support
  slugs.js            # three-tier fuzzy slug matcher
  backlinks.js        # extracts and indexes internal links between posts
  related.js          # 4-tier related post scoring
  seo.js              # OG tags, Twitter cards, sitemap, SSR page renderer
  sync.js             # diffing disk vs DB for incremental sync
  utils.js            # slugify, ID generation, date formatting
```

`createBlog()` is a factory that returns a plain object with methods -- no classes, no inheritance, no `this` binding surprises. Each internal module is independently testable.

## Why not [existing solution]?

I looked at a few options before extracting this. Most blog engines want to own the whole stack -- they want to be your framework, your router, your build tool. I just needed a library that:

- Reads markdown from a directory I control
- Gives me query methods I can wire into any HTTP handler
- Handles the annoying stuff (fuzzy URLs, backlinks, SEO tags)
- Works with an existing SQLite database without taking it over

If that's what you need, this might save you some time. If you want a full static site generator or a CMS, this isn't that.

## License

MIT
