import fetch from './fetch.js';
import jsdom from 'jsdom';
const { JSDOM } = jsdom;
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────── 配置 / 路径 ─────────────────────────

/**
 * 得到当前日期
 * @returns 当前日期, 格式如: 20220929
 */
const getDate = () => {
	const add0 = num => num < 10 ? ('0' + num) : num;
	const date = new Date();
	return '' + date.getFullYear() + add0(date.getMonth() + 1) + add0(date.getDate());
}

/**
 * 从命令行解析日期参数, 支持:
 *   node index.js                -> 今天
 *   node index.js 20260622       -> 指定日期
 *   node index.js --date 20260622
 *   node index.js --date=20260622
 * @returns {string} YYYYMMDD
 */
const parseDateArg = () => {
	const argv = process.argv.slice(2);
	if (argv.length === 0) return getDate();
	// 支持 --date=XXX / --date XXX 两种写法
	const idx = argv.indexOf('--date');
	if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
	for (const a of argv) {
		if (a.startsWith('--date=')) return a.slice('--date='.length);
	}
	// 否则把第一个非 flag 参数当日期
	const positional = argv.find(a => !a.startsWith('-'));
	return positional || getDate();
};

// 校验日期格式 (YYYYMMDD), 防止误传导致拼接出错误 URL
const validateDate = d => /^\d{8}$/.test(d);

// 当前日期
const DATE = parseDateArg();
if (!validateDate(DATE)) {
	console.error(`日期格式错误: "${DATE}", 应为 YYYYMMDD (如 20260622)`);
	process.exit(1);
}

// /news 目录
const NEWS_PATH = path.join(__dirname, 'news');
// /news/xxxxxxxx.md 文件
const NEWS_MD_PATH = path.join(NEWS_PATH, DATE + '.md');
// /README.md 文件
const README_PATH = path.join(__dirname, 'README.md');
// /news/catalogue.json 文件
const CATALOGUE_JSON_PATH = path.join(NEWS_PATH, 'catalogue.json');
// 打印调试信息
console.log('DATE:', DATE);
console.log('NEWS_PATH:', NEWS_PATH);
console.log('README_PATH:', README_PATH);
console.log('CATALOGUE_JSON_PATH:', CATALOGUE_JSON_PATH);

// ───────────────────────── 文件工具 ─────────────────────────

const readFile = path => {
	return new Promise((resolve, reject) => {
		fs.readFile(path, {}, (err, data) => {
			if (err) reject(err);
			resolve(data);
		});
	});
};

const writeFile = (path, data) => {
	return new Promise((resolve, reject) => {
		fs.writeFile(path, data, err => {
			if (err) reject(err);
			resolve(true);
		});
	});
};

const textOf = el => (el?.textContent || '').trim();

// ───────────────────────── 抓取 ─────────────────────────

/**
 * 判断 HTML 是否为央视的 ERROR 页
 * (旧 UA 被拦截时会返回该页, 链接列表页也可能返回它)
 */
const isErrorPage = html => /CCTV\.com - ERROR|对不起，可能是网络原因或无此页面/.test(html);

/**
 * 获取新闻列表
 * @param {string} date 当前日期 YYYYMMDD
 * @returns {Promise<{abstract: string, news: string[]}>} abstract 为简介链接, news 为新闻链接数组
 */
const getNewsList = async date => {
	const HTML = await fetch(`http://tv.cctv.com/lm/xwlb/day/${date}.shtml`);
	if (isErrorPage(HTML)) {
		throw new Error(`日期 ${date} 的列表页不可用 (央视返回 ERROR 页, 可能当天节目尚未播出或已被限制)`);
	}
	const fullHTML = `<!DOCTYPE html><html><head></head><body>${HTML}</body></html>`;
	const dom = new JSDOM(fullHTML);
	const nodes = dom.window.document.querySelectorAll('a');
	const links = [];
	nodes.forEach(node => {
		// 从 dom 节点获得 href 中的链接, 规范化为绝对地址
		let link = node.href;
		// 央视列表页常把相邻日期的新闻混排, 过滤掉非目标日期的链接
		if (!link) return;
		// 跳过样式表等非内容链接
		if (/(\.css|\.js|style\/|javascript:)/i.test(link)) return;
		// 只要当天的视频详情页 (含 /YYYY/MM/DD/ 且 shtml 结尾)
		const y = date.slice(0, 4), m = date.slice(4, 6), d = date.slice(6, 8);
		const re = new RegExp(`/${y}/${m}/${d}/.*\\.shtml`, 'i');
		if (!re.test(link)) return;
		// 去重
		if (!links.includes(link)) links.push(link);
	});
	if (links.length === 0) {
		throw new Error(`日期 ${date} 未解析到任何新闻链接`);
	}
	// 列表第一条通常是"主要内容/简介"页 (标题为 "[新闻联播]主要内容")
	const abstract = links.shift();
	console.log(`成功获取新闻列表 (共 ${links.length} 则详情 + 1 则简介)`);
	return {
		abstract,
		news: links
	}
}

/**
 * 获取新闻摘要 (简介)
 * @param {string} link 简介的链接
 * @returns {Promise<string>} 简介内容
 */
const getAbstract = async link => {
	const HTML = await fetch(link);
	if (isErrorPage(HTML)) {
		console.warn('简介页返回 ERROR, 摘要留空');
		return '';
	}
	const dom = new JSDOM(HTML);
	const doc = dom.window.document;
	// 多级兜底选择器: 原版超长绝对路径 -> class 兜底 -> 标签兜底
	const el =
		doc.querySelector('#page_body .nrjianjie_shadow li p') ||
		doc.querySelector('.nrjianjie_shadow p') ||
		doc.querySelector('.nrjianjie p') ||
		doc.querySelector('.content_brief') ||
		null;
	if (!el) {
		console.warn('未能定位简介节点, 摘要留空');
		return '';
	}
	const abstract = el.innerHTML
		.replaceAll('；', "；\n\n")
		.replaceAll('：', "：\n\n");
	console.log('成功获取新闻简介');
	return abstract;
}

/**
 * 获取新闻本体 (单条失败不影响其他条目)
 * @param {string[]} links 链接数组
 * @returns {Promise<Array<{title: string, content: string}>>}
 */
const getNews = async links => {
	const linksLength = links.length;
	console.log('共', linksLength, '则新闻, 开始获取');
	const news = [];
	for (let i = 0; i < linksLength; i++) {
		const url = links[i];
		try {
			const html = await fetch(url, { retries: 3 });
			if (isErrorPage(html)) {
				throw new Error('详情页返回 ERROR');
			}
			const dom = new JSDOM(html);
			const doc = dom.window.document;
			// 标题: 多级兜底
			const titleEl =
				doc.querySelector('#page_body .playingVideo .tit') ||
				doc.querySelector('.tit') ||
				doc.querySelector('h1, h2');
			let title = textOf(titleEl).replace(/^\[视频\]/, '').replace('[视频]', '').trim();
			// 正文: 多级兜底
			const contentEl =
				doc.querySelector('#content_area') ||
				doc.querySelector('.content_area') ||
				doc.querySelector('.cnt_bd') ||
				doc.querySelector('.text_area');
			let content = textOf(contentEl);
			if (!title && !content) {
				console.warn(`  第 ${i + 1} 则: 标题和正文均为空, 跳过`);
				continue;
			}
			news.push({ title: title || '(无标题)', content: content || '(无正文)', link: url });
			console.log(`  第 ${i + 1}/${linksLength} 则: ${title.slice(0, 30)}`);
		} catch (err) {
			// 单条失败不中断整体, 记录并继续
			console.warn(`  第 ${i + 1} 则抓取失败, 跳过: ${err.message} (${url})`);
		}
	}
	console.log(`成功获取 ${news.length}/${linksLength} 则新闻`);
	return news;
}

// ───────────────────────── 格式化 / 落盘 ─────────────────────────

/**
 * 将数据处理为 md 格式
 */
const newsToMarkdown = ({ date, abstract, news }) => {
	let mdNews = '';
	for (const { title, content, link } of news) {
		mdNews += `### ${title}\n\n${content}\n\n[查看原文](${link})\n\n`;
	}
	return `# 《新闻联播》 (${date})\n\n## 新闻摘要\n\n${abstract || '(暂无简介)'}\n\n## 详细新闻\n\n${mdNews}\n\n---\n\n(更新时间戳: ${new Date().getTime()})\n\n`;
}

const saveTextToFile = async (savePath, text) => {
	await writeFile(savePath, text);
}

const updateCatalogue = async ({ catalogueJsonPath, readmeMdPath, date, abstract }) => {
	// 更新 catalogue.json (若文件不存在则创建)
	let catalogueJson = [];
	try {
		const data = (await readFile(catalogueJsonPath)).toString();
		catalogueJson = JSON.parse(data || '[]');
	} catch (err) {
		if (err.code !== 'ENOENT') console.warn('读取 catalogue.json 失败, 将重建:', err.message);
	}
	// 避免同日期重复条目
	catalogueJson = catalogueJson.filter(item => item.date !== date);
	catalogueJson.unshift({
		date,
		abstract: (abstract || '').slice(0, 200),
	});
	await writeFile(catalogueJsonPath, JSON.stringify(catalogueJson, null, 2));
	console.log('更新 catalogue.json 完成');

	// 更新 README.md (不存在则用模板创建)
	let readmeText;
	try {
		readmeText = (await readFile(readmeMdPath)).toString();
	} catch (err) {
		if (err.code !== 'ENOENT') throw err;
		readmeText = '# 新闻联播文字稿\n\n<!-- INSERT -->\n';
	}
	if (!readmeText.includes('<!-- INSERT -->')) {
		readmeText += '\n<!-- INSERT -->\n';
	}
	// 避免同日期重复插入
	const entry = `- [${date}](./news/${date}.md)`;
	if (!readmeText.includes(entry)) {
		readmeText = readmeText.replace('<!-- INSERT -->', `<!-- INSERT -->\n${entry}`);
	}
	await writeFile(readmeMdPath, readmeText);
	console.log('更新 README.md 完成');
}

// ───────────────────────── 主流程 ─────────────────────────

const main = async () => {
	const newsList = await getNewsList(DATE);
	const abstract = await getAbstract(newsList.abstract);
	const news = await getNews(newsList.news);
	if (news.length === 0) {
		throw new Error(`日期 ${DATE} 未抓取到任何有效新闻, 终止写入`);
	}
	const md = newsToMarkdown({ date: DATE, abstract, news });
	await saveTextToFile(NEWS_MD_PATH, md);
	await updateCatalogue({
		catalogueJsonPath: CATALOGUE_JSON_PATH,
		readmeMdPath: README_PATH,
		date: DATE,
		abstract
	});
	console.log('全部成功, 程序结束');
}

main().catch(err => {
	// 统一错误出口: 以非 0 退出码结束, 便于 GitHub Actions 识别失败
	console.error('程序失败:', err.message || err);
	process.exit(1);
});
