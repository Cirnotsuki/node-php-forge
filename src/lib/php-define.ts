import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { CONST_PREFIX, EXCLUDE_STRING } from '../config/constans';
import utils, { fileIterator, scanPHPFile } from '../utils/utils';
import { Runtime } from '../core/runtime';
import { BuildContext } from '../core/buildOption';
import { Ast } from '../core/ast';
import { isKind } from '../utils/typeGard';
import { generateConstantName, getNodeName } from '../utils/helper';

// ========================================
// PHP Define Symbol Compiler
// ========================================

export default async function (buildContext: BuildContext) {
	const ROOT_DIR = buildContext.distDir;

	const constantMap = Runtime.options.constants;

	function shouldSkipConst(constName: string) {
		return (
			EXCLUDE_STRING.includes(constName) ||
			/**
			 * WP
			 */
			constName.startsWith('WP_') ||
			/**
			 * PHP
			 */
			constName.startsWith('PHP_') ||
			/**
			 * WC
			 */
			constName.startsWith('WC_') ||
			/**
			 * Elementor
			 */
			constName.startsWith('ELEMENTOR_') ||
			/**
			 * Core
			 */
			constName === 'ABSPATH' ||
			constName === 'OBJECT' ||
			constName === 'ARRAY_A' ||
			constName === 'ARRAY_N' ||
			/**
			 * Runtime
			 */
			constName.startsWith('KA_')
		);
	}
	// ========================================
	// Main
	// ========================================
	logger.log('🚀 开始扫描 PHP 常量...\n');
	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		ast.walk((node) => {
			if (!isKind(node, 'call')) return;
			if (getNodeName(node.what.name) !== 'define') return;

			const stringNode = node.arguments[0];

			if (!isKind(stringNode, 'string')) return;

			const name = stringNode.value;

			if (shouldSkipConst(name)) return;

			const replace = generateConstantName();
			constantMap.set(name, replace);
			stringNode.recordReplacement(`"${replace}"`);

			console.log(`🔄 ${name} -> ${replace}`);
		});
	});
}
