import { Marked } from 'marked'
import markedAlert from 'marked-alert'

const instance = new Marked()
instance.use(markedAlert())
instance.use({
  renderer: {
    image(token) {
      const { href, title, text } = token
      const titleAttr = title ? ` title="${title}"` : ''
      return `<img src="${href}" alt="${text || ''}"${titleAttr} loading="lazy">`
    }
  }
})

export function renderMarkdown(text) {
  return instance.parse(text)
}
