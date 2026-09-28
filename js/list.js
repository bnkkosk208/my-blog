// index.html: 글 목록을 그린다.
import { getPostList, formatDate } from './posts.js';
import { escapeHtml } from './markdown.js';
import { initThemeToggle } from './theme.js';

function renderCard(post) {
  const url = `post.html?slug=${encodeURIComponent(post.slug)}`;
  const date = post.date
    ? `<time datetime="${escapeHtml(post.date)}">${escapeHtml(formatDate(post.date))}</time>`
    : '';
  const desc = post.description ? `<p class="post-card-desc">${escapeHtml(post.description)}</p>` : '';
  const tags = post.tags.length
    ? `<ul class="tags">${post.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
    : '';

  return `
    <li class="post-card">
      <article>
        <h2 class="post-card-title"><a href="${url}">${escapeHtml(post.title)}</a></h2>
        <div class="post-meta">${date}</div>
        ${desc}
        ${tags}
      </article>
    </li>`;
}

async function main() {
  initThemeToggle(document.querySelector('.theme-toggle'));
  const listEl = document.getElementById('post-list');

  try {
    const posts = await getPostList();
    listEl.innerHTML = posts.length
      ? posts.map(renderCard).join('')
      : '<li class="status">아직 작성된 글이 없습니다.</li>';
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<li class="status status-error">${escapeHtml(err.message)}</li>`;
  }
}

main();
