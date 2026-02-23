import { generateId } from './utils.js'

export function createDatabase(db) {
  // Schema creation
  function initSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS blog_post (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        summary TEXT,
        author TEXT,
        media TEXT,
        thumbnail TEXT,
        created INTEGER NOT NULL,
        dir_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blog_tag (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT
      );
      CREATE TABLE IF NOT EXISTS blog_post_tag (
        post_id TEXT NOT NULL REFERENCES blog_post(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES blog_tag(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, tag_id)
      );
    `)
  }

  // Prepared statements (lazily created since db may not have tables yet)
  let _stmts = null
  function stmts() {
    if (!_stmts) {
      _stmts = {
        insertPost: db.prepare(`
          INSERT INTO blog_post (id, title, slug, summary, author, media, thumbnail, created, dir_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        getPostBySlug: db.prepare(`SELECT * FROM blog_post WHERE slug = ?`),
        getAllSlugs: db.prepare(`SELECT slug FROM blog_post`),
        getAllPosts: db.prepare(`SELECT id, slug, title FROM blog_post`),
        deletePostById: db.prepare(`DELETE FROM blog_post WHERE id = ?`),
        deletePostTagsByPostId: db.prepare(`DELETE FROM blog_post_tag WHERE post_id = ?`),

        getTagBySlug: db.prepare(`SELECT * FROM blog_tag WHERE slug = ?`),
        insertTag: db.prepare(`INSERT OR IGNORE INTO blog_tag (id, slug, name) VALUES (?, ?, ?)`),
        insertPostTag: db.prepare(`INSERT OR IGNORE INTO blog_post_tag (post_id, tag_id) VALUES (?, ?)`),

        listTags: db.prepare(`
          SELECT t.slug, t.name, t.description, COUNT(pt.post_id) as count
          FROM blog_tag t
          LEFT JOIN blog_post_tag pt ON t.id = pt.tag_id
          GROUP BY t.id ORDER BY count DESC
        `),

        updateTagDescription: db.prepare(`UPDATE blog_tag SET description = ? WHERE slug = ?`),

        deleteOrphanTags: db.prepare(`
          DELETE FROM blog_tag WHERE id NOT IN (
            SELECT DISTINCT tag_id FROM blog_post_tag
          )
        `),

        getTagsForPost: db.prepare(`
          SELECT t.slug, t.name FROM blog_tag t
          JOIN blog_post_tag pt ON t.id = pt.tag_id
          WHERE pt.post_id = ?
        `),

        countPosts: db.prepare(`SELECT COUNT(*) as total FROM blog_post`),
      }
    }
    return _stmts
  }

  function insertPost(post) {
    stmts().insertPost.run(
      post.id, post.title, post.slug, post.summary,
      post.author, post.media, post.thumbnail, post.created, post.dirPath
    )
  }

  function getPostBySlug(slug) {
    return stmts().getPostBySlug.get(slug) || null
  }

  function getAllSlugs() {
    return stmts().getAllSlugs.all().map(r => r.slug)
  }

  function getAllPosts() {
    return stmts().getAllPosts.all()
  }

  function deletePost(id) {
    stmts().deletePostTagsByPostId.run(id)
    stmts().deletePostById.run(id)
  }

  function getOrCreateTag(slug, name) {
    const existing = stmts().getTagBySlug.get(slug)
    if (existing) return existing
    const id = generateId()
    stmts().insertTag.run(id, slug, name)
    return { id, slug, name }
  }

  function linkPostTag(postId, tagId) {
    stmts().insertPostTag.run(postId, tagId)
  }

  function listTags({ filterTags = [] } = {}) {
    if (!filterTags.length) {
      return stmts().listTags.all()
    }
    const placeholders = filterTags.map(() => '?').join(', ')
    return db.prepare(`
      SELECT t.slug, t.name, t.description, COUNT(DISTINCT p2.id) as count
      FROM blog_tag t
      LEFT JOIN blog_post_tag pt2 ON t.id = pt2.tag_id
      LEFT JOIN blog_post p2 ON pt2.post_id = p2.id
      WHERE p2.id IN (
        SELECT p.id FROM blog_post p
        JOIN blog_post_tag pt ON p.id = pt.post_id
        JOIN blog_tag tf ON pt.tag_id = tf.id
        WHERE tf.slug IN (${placeholders})
        GROUP BY p.id HAVING COUNT(DISTINCT tf.slug) = ?
      )
      GROUP BY t.id ORDER BY count DESC
    `).all(...filterTags, filterTags.length)
  }

  function updateTagDescription(slug, description) {
    stmts().updateTagDescription.run(description, slug)
  }

  function deleteOrphanTags() {
    stmts().deleteOrphanTags.run()
  }

  function getTagsForPost(postId) {
    return stmts().getTagsForPost.all(postId)
  }

  function listPosts({ limit = 20, offset = 0, tags = [], order = 'desc' } = {}) {
    const dir = order === 'asc' ? 'ASC' : 'DESC'
    if (tags.length) {
      const placeholders = tags.map(() => '?').join(', ')
      const rows = db.prepare(`
        SELECT p.* FROM blog_post p
        JOIN blog_post_tag pt ON p.id = pt.post_id
        JOIN blog_tag t ON pt.tag_id = t.id
        WHERE t.slug IN (${placeholders})
        GROUP BY p.id
        HAVING COUNT(DISTINCT t.slug) = ?
        ORDER BY p.created ${dir}
        LIMIT ? OFFSET ?
      `).all(...tags, tags.length, limit, offset)

      const countResult = db.prepare(`
        SELECT COUNT(*) as total FROM (
          SELECT p.id FROM blog_post p
          JOIN blog_post_tag pt ON p.id = pt.post_id
          JOIN blog_tag t ON pt.tag_id = t.id
          WHERE t.slug IN (${placeholders})
          GROUP BY p.id
          HAVING COUNT(DISTINCT t.slug) = ?
        )
      `).get(...tags, tags.length)

      return { items: rows, total: countResult.total }
    }

    const rows = db.prepare(
      `SELECT * FROM blog_post ORDER BY created ${dir} LIMIT ? OFFSET ?`
    ).all(limit, offset)
    const countResult = stmts().countPosts.get()
    return { items: rows, total: countResult.total }
  }

  return {
    initSchema,
    insertPost,
    getPostBySlug,
    getAllSlugs,
    getAllPosts,
    deletePost,
    getOrCreateTag,
    linkPostTag,
    listTags,
    updateTagDescription,
    deleteOrphanTags,
    getTagsForPost,
    listPosts,
  }
}
