import fs, { mkdirSync } from 'fs';
import path from 'path';
import logger from '../utils/logger';
import utils from '../utils/utils';
import { Runtime } from '../core/runtime';
import { ENTRIES, PHP_FILE_ENCRYPT } from '../config/constans';
import { BuildContext } from '../core/buildOption';
import { Ast } from '../core/ast';
import { mkdirp } from 'mkdirp';
import { cleanupEmptyLines, generateVariableName, stripPhpComments } from '../utils/helper';
import { buildAutoUnlinkScript, buildRuntimeFile, buildRuntimeFileC, handlePhpFile } from '../utils/pipeUtil';
import { encrypt } from '@ka-libs/crypto';
// ========================================
// PHP Optimize Compiler
// ========================================
export default async function (buildContext: BuildContext) {
	const phpFiles = await utils.scanPHPFile(Runtime.distDir);
	const { symbols } = Runtime.options;

	await utils.fileIterator(phpFiles, async (filePath) => {
		// 清理文件
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
			result.push(/* php */ `
			if (!defined('ABSPATH')) {
				header('Location: /');
				exit;
			}
			`);

			if (Runtime.settings.encrypt) {
				const runtimeFile = Runtime.settings.buildRuntimeC ? await buildRuntimeFileC(filePath) : await buildRuntimeFile(filePath);
				result.push(stripPhpComments(runtimeFile));
			}
		}

		if (Runtime.settings.encrypt) {
			result.push(/* php */ `include ${symbols.getPhpFile}(__FILE__);`);
		}

		result.push('?>');
		result.forEach((item, i) => {
			result[i] = cleanupEmptyLines(item);
		});

		logger.log('🧹 开始清理 PHP 注释...\n');

		const prefix = (head || '').startsWith('<?php') ? '<?php\n' : '';
		const phpFile = prefix + stripPhpComments(body);

		if (Runtime.settings.encrypt) {
			await handlePhpFile(filePath, phpFile);
		} else {
			result.push(phpFile);
		}

		fs.writeFileSync(filePath, result.join('\n'), 'utf-8');
	});

	logger.log('\n🎉 PHP Optimize 完成');
	return buildContext;
}
