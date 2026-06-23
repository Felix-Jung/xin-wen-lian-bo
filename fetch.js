import nodeFetch from "node-fetch";
import Iconv from "iconv-lite";

// 现代 Chrome UA（原版 Edge 107 UA + 写死的 cookie 已被央视拦截，返回 ERROR 页）
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 单次请求
 * @param {string} url 目标 URL
 * @param {number} timeoutMs 超时（毫秒）
 * @returns {Promise<string>} 解码后的 HTML 文本
 */
const fetchOnce = async (url, timeoutMs = 30000) => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await nodeFetch(url, {
			headers: {
				accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
				"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
				"cache-control": "no-cache",
				pragma: "no-cache",
				"sec-ch-ua":
					'"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
				"sec-ch-ua-mobile": "?0",
				"sec-ch-ua-platform": '"Windows"',
				"sec-fetch-dest": "document",
				"sec-fetch-mode": "navigate",
				"sec-fetch-site": "none",
				"upgrade-insecure-requests": "1",
				"user-agent": UA,
				referer: "http://tv.cctv.com/lm/xwlb/",
			},
			method: "GET",
			signal: controller.signal,
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status} ${res.statusText}`);
		}
		// 央视列表页声明 gb2312，但实际多为 utf-8；
		// 直接 res.text() 会按声明编码解码，可能乱码。
		// 这里取原始 buffer，按 utf-8 兜底解码（iconv 对纯 utf-8 字节是透传的）。
		const buf = Buffer.from(await res.arrayBuffer());
		return Iconv.decode(buf, "utf-8").toString();
	} finally {
		clearTimeout(timer);
	}
};

/**
 * 带重试的请求
 * @param {string} url 目标 URL
 * @param {object} opts { retries, timeoutMs, onRetry }
 * @returns {Promise<string>} HTML 文本
 */
export default async function fetch(url, opts = {}) {
	const {
		retries = 3,
		timeoutMs = 30000,
		onRetry = (n, err) => console.warn(`  [retry ${n}] ${url} -> ${err.message}`),
	} = opts;
	let lastErr;
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			return await fetchOnce(url, timeoutMs);
		} catch (err) {
			lastErr = err;
			if (attempt < retries) {
				onRetry(attempt, err);
				// 指数退避: 1s, 2s, 4s...
				await sleep(1000 * Math.pow(2, attempt - 1));
			}
		}
	}
	throw lastErr;
}
