import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodeFetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────── 配置 ─────────────────────────

// 飞书自定义机器人 webhook (从环境变量 FEISHU_WEBHOOK 读取, 避免硬编码泄露)
const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK;
// 干跑模式: 设置 FEISHU_DRY_RUN=1 时只打印消息不发送, 用于本地调试
const DRY_RUN = process.env.FEISHU_DRY_RUN === '1';

// GitHub 仓库地址 (用于消息里的"查看全文"链接, 默认指向本 fork)
const REPO_URL =
	process.env.REPO_URL || 'https://github.com/Felix-Jung/xin-wen-lian-bo';

// catalogue.json 与 news 目录路径
const CATALOGUE_JSON_PATH = path.join(__dirname, 'news', 'catalogue.json');

// ───────────────────────── 工具 ─────────────────────────

// 把 YYYYMMDD 格式化为可读日期 20260622 -> 2026年6月22日
const formatDate = d => {
	if (!/^\d{8}$/.test(d)) return d;
	const y = d.slice(0, 4);
	const m = parseInt(d.slice(4, 6), 10);
	const day = parseInt(d.slice(6, 8), 10);
	return `${y}年${m}月${day}日`;
};

// 读取 catalogue.json 最新一条
const getLatest = () => {
	const data = fs.readFileSync(CATALOGUE_JSON_PATH, 'utf-8');
	const catalogue = JSON.parse(data || '[]');
	if (!Array.isArray(catalogue) || catalogue.length === 0) {
		throw new Error('catalogue.json 为空, 无可推送内容');
	}
	// catalogue 按 unshift 写入, 第一条即最新
	return catalogue[0];
};

// 组装飞书 interactive 消息卡片
const buildMessage = ({ date, abstract }) => {
	const url = `${REPO_URL}/blob/master/news/${date}.md`;
	const dateStr = formatDate(date);

	// 摘要可能为空 (简介抓取失败), 给个兜底
	// 央视原数据含大量 \n\n\n, 压缩为单个换行让卡片更紧凑
	const safeAbstract = (abstract || '')
		.replace(/\n{3,}/g, '\n')
		.trim() || '(本期暂无摘要)';

	// 飞书 interactive 卡片: 标题 + 摘要 + 查看全文链接
	return {
		msg_type: 'interactive',
		card: {
			config: { wide_screen_mode: true },
			header: {
				title: {
					tag: 'plain_text',
					content: `📺 新闻联播 · ${dateStr}`,
				},
				template: 'blue',
			},
			elements: [
				{
					tag: 'div',
					text: {
						tag: 'lark_md',
						content: safeAbstract,
					},
				},
				{
					tag: 'action',
					actions: [
						{
							tag: 'button',
							text: {
								tag: 'plain_text',
								content: '🔗 查看完整文字稿',
							},
							url,
							type: 'primary',
						},
					],
				},
			],
		},
	};
};

// ───────────────────────── 主流程 ─────────────────────────

const main = async () => {
	if (!FEISHU_WEBHOOK && !DRY_RUN) {
		console.error('未设置 FEISHU_WEBHOOK 环境变量, 跳过推送');
		console.error('  本地测试: 设置 FEISHU_DRY_RUN=1 可只打印消息不发送');
		console.error('    PowerShell: $env:FEISHU_DRY_RUN="1"; node push-feishu.js');
		process.exit(1);
	}

	const latest = getLatest();
	console.log('最新条目日期:', latest.date);

	// 可选: 用 TODAY 环境变量限定只推今天 (workflow 里抓取的就是今天)
	// 默认宽松: 推 catalogue 最新一条 (哪怕不是今天, 也能保证有内容可推)
	const today = process.env.TODAY;
	if (today && latest.date !== today) {
		console.log(`最新条目 ${latest.date} != 今天 ${today}, 跳过推送 (当天节目可能尚未抓取)`);
		return;
	}

	const message = buildMessage(latest);

	// 干跑模式: 只打印组装好的消息, 不实际发送
	if (DRY_RUN) {
		console.log('=== [DRY RUN] 将发送的消息 ===');
		console.log(JSON.stringify(message, null, 2));
		console.log('=== [DRY RUN] 结束 ===');
		return;
	}

	console.log('消息卡片组装完成, 开始推送...');

	const res = await nodeFetch(FEISHU_WEBHOOK, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(message),
	});
	const body = await res.text();

	// 飞书成功响应: {"StatusCode":0,"StatusMessage":"success",...} 或 {"code":0,...}
	if (!res.ok) {
		throw new Error(`飞书返回 HTTP ${res.status}: ${body}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		parsed = {};
	}
	const code = parsed.code ?? parsed.StatusCode ?? -1;
	if (code !== 0) {
		throw new Error(`飞书推送失败 (code=${code}): ${body}`);
	}
	console.log('✅ 推送成功');
};

main().catch(err => {
	console.error('推送失败:', err.message || err);
	process.exit(1);
});
