import path from 'path';
import { uuidv4 } from '@ka-libs/crypto';
import { AstNode, AnyAstNode, AstNodeMap } from '../types';
import { CONST_PREFIX, EXCLUDE_STRING, RANDOM_NUMBER_SIZE, STRING_OPT } from '../config/constans';
import logger from '../utils/logger';
import utils, { normalizePath } from '../utils/utils';
import { isKind } from '../utils/typeGard';
import { Runtime } from '../core/runtime';
import { Ast } from '../core/ast';
import {
	extractStringValue,
	getPartContentInEncapsedRaw,
	injectRuntimeCode,
} from '../utils/pipeUtil';
import { BuildContext } from '../core/buildOption';
import PhpParser from 'php-parser';
import { generateConstantName, getNodeName } from '../utils/helper';

// ========================================
// AST String Pool Compiler
// ========================================

export default async function (buildContext: BuildContext) {
	const { ENABLE_STRING_POOL, MIN_STRING_LENGTH } = STRING_OPT;

	const phpFiles: string[] = [];
	const stringMap = buildContext.strings;
	const constants = new Set([
		...buildContext.options.constants.keys(),
		...buildContext.options.constants.values(),
	]);
	const stringIdSet = new Set<number>();
	const runtimeFunctionName = generateConstantName();
	buildContext.runtime.stringPoolFunction = runtimeFunctionName;

	// ========================================
	// Utils
	// ========================================
	function shouldSkipString(str: string): boolean {
		if (!str || str.length < MIN_STRING_LENGTH) return true;
		if (str.includes('<?php') || str.includes('<?=') || str.includes('?>')) return true;
		if (EXCLUDE_STRING.includes(str)) return true;
		if (constants.has(str)) return true;
		return false;
	}

	function shouldSkipNode(node: AstNode<PhpParser.String>) {
		const parent = node.parent;
		if (isKind(parent, 'call')) {
			const name = getNodeName(parent.what.name);
			if (['method_exists', 'function_exists'].includes(name)) return true;
		}

		return false;
	}

	/**
	 * 判断节点是否处于“编译期上下文”（不应被替换）
	 * 包括：常量定义、类属性默认值、函数/闭包参数默认值、Attribute、Enum Case
	 */
	function isCompileTimeContext(node: AstNode): boolean {
		let current: AstNode | undefined | null = node.parent;

		while (current) {
			// 1. 常量定义: const X = '...'
			if (isKind(current, 'constant') && isKind(current.parent, 'constantstatement')) return true;
			// 类常量: public const X = '...'
			if (isKind(current, 'classconstant')) return true;

			// 2. 类属性默认值: public $x = '...'
			if (isKind(current, 'property') && isKind(current.parent, 'propertystatement')) return true;

			// 3. 函数/方法/闭包/箭头函数的参数默认值
			if (isKind(current, 'parameter')) return true;

			// 4. Attribute: #[Route('...')]
			if (isKind(current, 'attribute') || isKind(current, 'attrgroup')) return true;

			// 5. Enum Case: case X = '...'
			if (isKind(current, 'enumcase')) return true;

			// 6. Static variable default: static $x = '...'
			if (isKind(current, 'staticvariable')) return true;

			current = current.parent;
		}

		return false;
	}

	// ========================================
	// Collect Strings (Phase 1)
	// ========================================
	function getRandomID() {
		let stringId = utils.randomNumber(RANDOM_NUMBER_SIZE);
		while (stringIdSet.has(stringId)) {
			stringId = utils.randomNumber(RANDOM_NUMBER_SIZE);
		}
		stringIdSet.add(stringId);
		return stringId;
	}

	function nodeInEncapsed(node: AstNode) {
		let parent: AstNode | null | undefined = node;
		while (parent) {
			if (isKind(parent, 'encapsed')) {
				return true;
			}
			parent = parent.parent;
		}
		return false;
	}

	function extractEncapsed(
		node: AstNode<PhpParser.Encapsed>,
		callback: (child: { isString: boolean; raw: string }) => void,
	) {
		// 2. Encapsed / Heredoc / Nowdoc 等容器节点
		//    通过 isKind 收窄后，node.value 才是安全的数组类型
		for (const child of node.value) {
			if (isKind(child, 'encapsedpart')) {
				const value = getPartContentInEncapsedRaw(node.raw, child, node.loc!.start.offset);
				callback({
					isString: isKind(child.expression, 'string'),
					raw: value,
				});
			}
		}
	}

	function collectEncapsed(node: AstNode<AstNodeMap['encapsed']>) {
		extractEncapsed(node, ({ isString, raw }) => {
			if (isString) {
				if (raw.length < MIN_STRING_LENGTH) return;
				if (stringMap.has(raw)) return;
				stringMap.set(raw, getRandomID());
			}
		});
	}

	function collectString(node: AstNode<PhpParser.String>) {
		if (nodeInEncapsed(node)) return;
		if (shouldSkipNode(node)) return;

		const value = extractStringValue(node);
		if (value === null) return;

		if (shouldSkipString(value)) return;
		if (stringMap.has(value)) return;

		if (value in Runtime.options.replace) {
			stringMap.set(Runtime.options.replace[value], getRandomID());
		} else {
			stringMap.set(value, getRandomID());
		}
	}

	// ========================================
	// Record Replace Strings (Phase 2)
	// ========================================

	function recordEncapsed(node: AstNode<AstNodeMap['encapsed']>) {
		const result: string[] = [];

		extractEncapsed(node, ({ isString, raw }) => {
			if (isString) {
				if (raw.length < MIN_STRING_LENGTH) {
					result.push(`'${raw}'`);
				} else {
					const id = stringMap.get(raw)!;
					result.push(`${runtimeFunctionName}(${id})`);
				}
			} else {
				result.push(raw.replace(/^{/, '').replace(/}$/, ''));
			}
		});

		if (result.length === 0) return;
		node.recordReplacement(result.join('.'));
	}

	function recordString(node: AstNode<AstNodeMap['string']>) {
		if (nodeInEncapsed(node)) return;

		const value = extractStringValue(node);
		if (value === null) return;
		if (!stringMap.has(value)) return;
		if (!node.loc?.start?.offset || !node.loc?.end?.offset) return;

		const id = stringMap.get(value)!;
		node.recordReplacement(`${runtimeFunctionName}(${id})`);
	}

	// ========================================
	// Main
	// ========================================
	if (!ENABLE_STRING_POOL) return;
	logger.log('🚀 开始构建 AST 字符串池...\n');

	phpFiles.push(...(await utils.scanPHPFile(buildContext.distDir)));
	logger.log(`📦 共扫描 ${phpFiles.length} 个 PHP 文件\n`);

	// Phase 1: 在所有文件中搜集可替换字符串
	await utils.fileIterator(phpFiles, async (file) => {
		logger.log(`🔍 收集字符串: ${normalizePath(path.relative(Runtime.distRoot, file))}`);
		const ast = Ast.create(file);

		ast.walk((node) => {
			if (!isKind(node, 'string') && !isKind(node, 'encapsed')) return;
			if (isCompileTimeContext(node)) return;

			if (isKind(node, 'encapsed')) {
				collectEncapsed(node);
			}

			if (isKind(node, 'string')) {
				collectString(node);
			}
		});
	});

	logger.log(`📦 收集到 ${stringMap.size} 个字符串\n`);

	if (stringMap.size === 0) {
		logger.log(`❓️ 没有搜集到可替换字符串，跳过替换。`);
		return;
	}
	// Phase 2: 替换字符串
	await utils.fileIterator(phpFiles, async (file) => {
		logger.log(`🔄 开始替换字符串: ${normalizePath(path.relative(Runtime.distRoot, file))}`);

		const ast = Ast.create(file);

		ast.walk((node) => {
			if (!isKind(node, 'string') && !isKind(node, 'encapsed')) return;
			if (isCompileTimeContext(node)) return;
			if (!node.loc?.start?.offset || !node.loc?.end?.offset) return;

			if (isKind(node, 'encapsed')) {
				recordEncapsed(node);
			}

			if (isKind(node, 'string')) {
				recordString(node);
			}
		});

		ast.applyReplacements();
	});

	// Phase 3: 注入 Runtime
	logger.log('⚡ 注入 Runtime');

	try {
		await injectRuntimeCode(buildContext);
		logger.log(`⚡ Runtime Function: ${runtimeFunctionName}`);
	} catch (err: any) {
		logger.error(`❌ Runtime 注入失败: ${err.message}`);
	}

	logger.log('\n🎉 AST String Pool 完成');
	logger.log(`📊 字符串池大小: ${stringMap.size}`);
}
