// 글 목록(posts/index.json)과 글 파일(posts/*.md)을 불러온다.
import { parseFrontMatter } from './frontmatter.js';

const SLUG_RE = /^[a-z0-9-]+$/;

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}을(를) 불러오지 못했습니다. (HTTP ${res.status})`);
  return res.text();
}

function toPost(slug, text) {
  const { meta, body } = parseFrontMatter(text);
  const tags = Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [];
  return {
    slug,
    title: meta.title || slug,
    date: meta.date || '',
    description: meta.description || '',
    tags,
    body,
  };
}

export async function getPostList() {
  const res = await fetch('posts/index.json');
  if (!res.ok) throw new Error(`글 목록을 불러오지 못했습니다. (HTTP ${res.status})`);
  const files = await res.json();
  if (!Array.isArray(files)) throw new Error('posts/index.json은 파일 이름 배열이어야 합니다.');

  const posts = await Promise.all(
    files
      .filter((file) => typeof file === 'string' && file.endsWith('.md'))
      .map(async (file) => {
        const slug = file.slice(0, -3);
        if (!SLUG_RE.test(slug)) {
          console.warn(`잘못된 파일 이름이라 건너뜀: ${file}`);
          return null;
        }
        try {
          return toPost(slug, await fetchText(`posts/${file}`));
        } catch (err) {
          console.warn(err);
          return null;
        }
      }),
  );

  // 날짜 최신순, 같은 날짜면 index.json에 나중에 추가한 글이 먼저
  return posts
    .map((post, order) => post && { ...post, order })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order);
}

export async function getPost(slug) {
  if (!slug || !SLUG_RE.test(slug)) throw new Error('잘못된 글 주소입니다.');
  const res = await fetch(`posts/${slug}.md`);
  if (res.status === 404) throw new Error('요청한 글을 찾을 수 없습니다.');
  if (!res.ok) throw new Error(`글을 불러오지 못했습니다. (HTTP ${res.status})`);
  return toPost(slug, await res.text());
}

// 'YYYY-MM-DD' → '2026년 9월 28일' (시간대 영향을 받지 않도록 직접 파싱)
export function formatDate(date) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
  if (!m) return date;
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}
