import fs, { mkdirSync } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import utils from '../utils/utils';
import { Runtime } from '../core/runtime';
import {
	ENTRIES,
	ENTRY_ENCRYPT,
	EXCLUDES,
	PACKAGE_REPLACEMENT,
	STRING_POOL_ENCRYPT,
	TARGET_EXTENSION,
} from '../config/constans';
import { BuildContext } from '../core/buildOption';
import { Ast } from '../core/ast';
import { mkdirp } from 'mkdirp';
// ========================================
// PHP Optimize Compiler
// ========================================
export default async function (buildContext: BuildContext) {
	// ========================================
	// Strip PHP Comments
	// ========================================
	function stripPhpComments(content: string) {
		let result = '';
		let inString = false;
		let stringChar = '';
		let inLineComment = false;
		let inBlockComment = false;
		for (let i = 0; i < content.length; i++) {
			const char = content[i];
			const next = content[i + 1];
			const prev = content[i - 1];
			// ====================================
			// Block Comment
			// ====================================
			if (inBlockComment) {
				if (char === '*' && next === '/') {
					inBlockComment = false;
					i++;
				}
				continue;
			}
			// ====================================
			// Line Comment
			// ====================================
			if (inLineComment) {
				if (char === '\n') {
					inLineComment = false;
					result += '\n';
				}
				continue;
			}
			// ====================================
			// String
			// ====================================
			if (inString) {
				result += char;
				if (char === stringChar && prev !== '\\') {
					inString = false;
				}
				continue;
			}
			// ====================================
			// String Start
			// ====================================
			if (char === '"' || char === "'") {
				inString = true;
				stringChar = char;
				result += char;
				continue;
			}
			// ====================================
			// #
			// ====================================
			if (char === '#') {
				inLineComment = true;
				continue;
			}
			// ====================================
			// //
			// ====================================
			if (char === '/' && next === '/') {
				/**
				 * Avoid URL
				 */
				const recent = result.slice(-10);
				if (recent.endsWith('http:') || recent.endsWith('https:')) {
					result += char;
					continue;
				}
				inLineComment = true;
				i++;
				continue;
			}
			// ====================================
			// /*
			// ====================================
			if (char === '/' && next === '*') {
				/**
				 * Preserve License
				 */
				const ahead = content.substring(i, i + 15);
				if (ahead.includes('@license')) {
					result += char;
					continue;
				}
				inBlockComment = true;
				i++;
				continue;
			}
			result += char;
		}
		return cleanupEmptyLines(result);
	}
	// ========================================
	// Cleanup Empty Lines
	// ========================================
	function cleanupEmptyLines(content: string) {
		const lines = content.split(/\r?\n/);
		const cleaned = [];
		for (const line of lines) {
			/**
			 * 去除行尾空格
			 */
			const trimmedRight = line.replace(/\s+$/g, '');
			/**
			 * 去除首尾后为空
			 */
			if (!trimmedRight.trim()) {
				continue;
			}
			cleaned.push(trimmedRight);
		}
		/**
		 * 压缩连续空格
		 */
		return cleaned
			.join('\n')
			.replace(/[ \t]+/g, ' ')
			.replace(/\n{2,}/g, '\n')
			.trim();
	}
	// ========================================
	// Process File
	// ========================================
	async function processFile(filePath: string) {
		/**
		 * Skip
		 */
		if (utils.isExcluded(filePath)) {
			return;
		}
		/**
		 * Not PHP
		 */
		if (!utils.isPhpFile(filePath)) {
			return;
		}

		/**
		 * Strip Comments
		 */
		logger.log(`🧹 开始清理 PHP 文件: ${path.relative(Runtime.distDir, filePath)}`);

		const result = [];
		const [body, head] = fs
			.readFileSync(filePath, 'utf8')
			.replace(/^\uFEFF/, '')
			.split('/* KA_PHP_START */')
			.reverse();

		const isEntryFile = ENTRIES.includes(path.basename(filePath));

		logger.log('💉 注入 PHP 文件头...\n');
		result.push(`<?php
/**
 * Build Date: ${new Date(Runtime.options.date).toLocaleDateString()}
 * Build Time: ${Runtime.options.time}
 * Build guid: ${Runtime.options.guid}
 * Arthur: Kuzuki Azusa <https://github.com/cirnotsuki>
*/`);
		if (head) {
			result.push(head.replace(/^<\?php/, ''));
		}

		if (isEntryFile) {
			result.push(`
if (!defined('ABSPATH')) {
	header('Location: /');
	exit;
}`);
		}

		if (isEntryFile) {
			const dirname = path.dirname(filePath);
			const runtimePath = path.resolve(dirname, 'runtime.php');

			if (fs.existsSync(runtimePath)) {
				let runtime = fs.readFileSync(runtimePath, 'utf-8');

				const binFile = path.resolve(path.dirname(filePath), PACKAGE_REPLACEMENT.KA_PHP_RUNTIME);
				mkdirp.sync(path.dirname(binFile));

				runtime = stripPhpComments(runtime);
				if (!runtime.endsWith('?>')) {
					runtime += '\n?>';
				}

				fs.writeFileSync(binFile, runtime, 'utf-8');

				result.push(`include __DIR__ . '/${PACKAGE_REPLACEMENT.KA_PHP_RUNTIME}';`);
			}

			if (ENTRY_ENCRYPT) {
				result.push('e(__DIR__);');
			} else if (STRING_POOL_ENCRYPT) {
				result.push(`$GLOBALS['KA_CONTEXT'] = __DIR__;`);
			}
		}

		result.push('?>');

		logger.log('🧹 开始清理 PHP 注释...\n');

		let cleaned = stripPhpComments(body);

		if (head && head.startsWith('<?php')) {
			cleaned = '<?php\n' + cleaned;
		}
		if (ENTRY_ENCRYPT && isEntryFile) {
			const binFile = path.resolve(path.dirname(filePath), PACKAGE_REPLACEMENT.KA_PHP_BINARIES);
			mkdirp.sync(path.dirname(binFile));

			fs.writeFileSync(binFile, cleaned, 'utf-8');
		} else {
			result.push(cleaned);
		}

		fs.writeFileSync(filePath, result.join('\n'), 'utf-8');
	}

	const phpFiles = await utils.scanPHPFile(Runtime.distDir);
	const runtimes: string[] = [];
	await utils.fileIterator(phpFiles, async (file) => {
		if (file.includes('runtime.php')) {
			runtimes.push(file);
			return;
		}
		// 清理文件
		await processFile(file);
	});

	runtimes.forEach((file) => {
		try {
			fs.unlinkSync(file);
		} catch (error) {}
	});

	logger.log('\n🎉 PHP Optimize 完成');
	return buildContext;
}
