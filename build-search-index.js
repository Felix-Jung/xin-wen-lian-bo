// 构建"全文搜索分片": 扫描 news/*.md -> search/YYYY.json
// 每期 { d: 日期, t: 标题+摘要+正文合并的纯文本(小写化交给前端) }
// 前端内容搜索时逐年 fetch 检索, 无需后端
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWS_DIR = path.join(__dirname, 'news');
const OUT_DIR = path.join(__dirname, 'search');

// md -> 纯文本: 去标题符号/链接语法/分隔线/多余空白
const mdToText = md =>
	md
		.replace(/^#+\s*/gm, '')            // 标题符号
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [文本](链接) -> 文本
		.replace(/^\s*---\s*$/gm, ' ')      // 分隔线
		.replace(/[*_`>#]+/g, ' ')          // 强调等 markdown 符号
		.replace(/\s+/g, ' ')               // 压缩空白
		.trim();

fs.mkdirSync(OUT_DIR, { recursive: true });

// 按年分组
const byYear = {};
for (const f of fs.readdirSync(NEWS_DIR)) {
	const m = /^(\d{8})\.md$/.exec(f);
	if (!m) continue;
	const date = m[1];
	const year = date.slice(0, 4);
	const md = fs.readFileSync(path.join(NEWS_DIR, f), 'utf-8');
	(byYear[year] ||= []).push({ d: date, t: mdToText(md) });
}

let total = 0;
for (const [year, items] of Object.entries(byYear)) {
	// 日期降序, 与页面列表一致
	items.sort((a, b) => (a.d < b.d ? 1 : -1));
	const out = path.join(OUT_DIR, `${year}.json`);
	fs.writeFileSync(out, JSON.stringify(items));
	total += items.length;
	console.log(`${year}.json: ${items.length} 期, ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`完成: ${total} 期, ${Object.keys(byYear).length} 个年份分片`);
