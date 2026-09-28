// post.html: ?slug= 로 지정한 글 하나를 그린다.
import { getPost, formatDate } from './posts.js';
import { escapeHtml, parseMarkdown } from './markdown.js';
import { initThemeToggle } from './theme.js';

const SITE_NAME = 'My Blog';

function renderPost(post) {
  const date = post.date
    ? `<time datetime="${escapeHtml(post.date)}">${escapeHtml(formatDate(post.date))}</time>`
    : '';
  const tags = post.tags.length
    ? `<ul class="tags">${post.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : '';

  return `
    <header class="post-header">
      <h1>${escapeHtml(post.title)}</h1>
      <div class="post-meta">${date}</div>
      ${tags}
    </header>
    <div class="prose">${parseMarkdown(post.body)}</div>`;
}

async function main() {
  initThemeToggle(document.querySelector('.theme-toggle'));
  const articleEl = document.getElementById('post');
  const slug = new URLSearchParams(window.location.search).get('slug');

  try {
    const post = await getPost(slug);
    document.title = `${post.title} · ${SITE_NAME}`;
    if (post.description) {
      document.querySelector('meta[name="description"]')?.setAttribute('content', post.description);
    }
    articleEl.innerHTML = renderPost(post);

    // 주소에 #제목-id가 있으면 렌더링 후 해당 위치로 이동
    if (window.location.hash) {
      document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
    }
  } catch (err) {
    console.error(err);
    document.title = `글을 찾을 수 없음 · ${SITE_NAME}`;
    articleEl.innerHTML = `
      <div class="status status-error">
        <h1>글을 표시할 수 없습니다</h1>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
  }
}

main();
