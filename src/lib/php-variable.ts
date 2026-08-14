import fs from 'fs';
import path from 'path';
import { uuidv4 } from '@ka-libs/crypto/uuidv4';
import PHPParser from 'php-parser';
import { randomPrefix } from '../utils/helper';
import { AstNode, AnyAstNode, ScopeNode } from '../types';
import { RESERVED, VARIABLE_OPT } from '../config/constans';
import { isKind, isScopeNode, typedAstNode } from '../utils/typeGard';
import { fileIterator, normalizePath, scanPHPFile } from '../utils/utils';
import logger from '../utils/logger';
import { Runtime } from '../core/runtime';
import { Ast } from '../core/ast';
import { RecordVariable } from '../core/recordNode';
import { BuildContext } from '../core/buildOption';
import { getNodeName } from '../utils/helper';
import { PhpParser } from '..';

export default async function (buildContext: BuildContext) {
	const variables = buildContext.variables;
	const ROOT_DIR = buildContext.distDir;

	function recordVariable(
		node: AstNode<PhpParser.Variable | PhpParser.Identifier>,
		replace?: string,
	): void;
	function recordVariable(
		node: AstNode<PhpParser.Variable | PhpParser.Identifier>,
		source?: RecordVariable | null,
	): void;
	function recordVariable(
		node: AstNode<PhpParser.Variable | PhpParser.Identifier>,
		arg: string | RecordVariable | null = null,
	) {
		if (node.name.length <= VARIABLE_OPT.MIX_NAME_LENGTH) return;

		const record = node.lookup();

		if (record) {
			record.references.push(node);
			return;
		}

		if (arguments.length === 1) {
			const uuid = uuidv4(true);
			node.scope.setCache(new RecordVariable(node, randomPrefix() + uuid.slice(-4)), node.name);
			return;
		}

		if (typeof arg === 'string') {
			node.scope.setCache(new RecordVariable(node, arg), node.name);
			return;
		}

		node.scope.setCache(new RecordVariable(node, arg), node.name);
	}

	function assignLeftIterator(left: AstNode) {
		function iterator(node: AstNode, keys: string[] = []) {
			if (isKind(node, 'list')) {
				node.items.forEach((entry, index) => {
					if (!isKind(entry, 'entry')) return;
					iterator(entry.value as AstNode, keys.concat(getNodeName(entry.key || `${index}`)));
				});
				return;
			}
			if (isKind(node, 'variable')) {
				node.setAttribute('assignKey', JSON.stringify(keys));
				recordVariable(node);
				return;
			}
		}
		iterator(left);
	}

	function traceUndefined(node: AstNode<PhpParser.Variable>) {
		if (isKind(node.parent, 'global')) return;
		const varname = getNodeName(node.name);
		if (
			['this', 'self', '_GET', '_POST', '_SERVER', '_SESSION', '_COOKIE', 'GLOBALS'].includes(
				varname,
			)
		)
			return;
		node.trace();
	}

	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		// 遍历第一次，记录所有的变量定义
		ast.walk((node: AstNode) => {
			if (!node.parent) return;
			if (isKind(node, 'assign')) {
				assignLeftIterator(node.left as AstNode);
				return;
			}

			if (isKind(node, 'staticvariable')) {
				recordVariable(typedAstNode(node.variable));
				return;
			}

			if (isKind(node, 'parameter')) {
				const param = node.name;

				if (isKind(param, 'identifier')) {
					recordVariable(param);
				}
				return;
			}

			if (isKind(node, 'foreach')) {
				if (isKind(node.value, 'variable')) {
					recordVariable(node.value);
				}
				if (isKind(node.key, 'variable')) {
					recordVariable(node.key);
				}
				return;
			}

			if (isKind(node, 'catch')) {
				if (isKind(node.variable, 'variable')) {
					recordVariable(node.variable);
				}
				return;
			}

			// global 是一个特殊的定义，记录时上下文变量没扫描完，无法确定是否在外部有定义
			if (isKind(node, 'global')) {
				node.items.forEach((item) => {
					if (!isKind(item, 'variable')) return;
					recordVariable(item, null);
				});
				return;
			}
		});

		ast.walk((node: AstNode) => {
			if (!isKind(node, 'variable') && !isKind(node, 'identifier')) return;
			if (isKind(node.parent, 'class'))
				// 跳过所有和类相关的实现
				return;
			if (isKind(node.parent, 'function')) return;
			if (isKind(node.parent, 'method')) return;
			if (isKind(node.parent, 'property')) return;
			if (isKind(node.parent, 'propertystatement')) return;
			if (isKind(node.parent, 'propertylookup') && node.getAttribute('source') !== 'what') return;
			if (isKind(node.parent, 'staticlookup')) return;

			let record = node.lookup();

			// 查找 global 和 use
			if (isKind(node.parent, 'global')) {
				// global 已经定义过了，所以从外面一层找是否有定义
				record = node.scope.lookup(null, node.name);
				// 更新来源
				if (node.record && record) {
					node.record.setSrouce(record);
				}
			}

			if (isKind(node.parent, 'closure') && node.getAttribute('source') === 'uses') {
				record = node.lookup(1);
				if (record && record instanceof RecordVariable) {
					recordVariable(node, record);
				}
			}

			if (record) {
				if ((node as any).byref) {
					node.recordReplacement('&' + record.replace);
				} else {
					node.recordReplacement(record.replace);
				}
			} else if (isKind(node, 'variable')) {
				traceUndefined(node);
			}
		});

		variables.push(
			...ast.getAllCaches().map(([varname, record]) => ({
				varname,
				replace: record.replace,
				location: normalizePath(path.relative(Runtime.distRoot, record.location)),
			})),
		);

		// ast.applyReplacements();
	});

	logger.log(`✅️ 变量混淆完成，共 ${variables.length} 个变量`);
	return buildContext;
}
