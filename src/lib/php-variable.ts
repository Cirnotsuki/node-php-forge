import fs from 'fs';
import path from 'path';
import { uuidv4 } from '@ka-libs/crypto/uuidv4';
import PHPParser from 'php-parser';
import { randomPrefix } from '../utils/randomPrefix';
import { AstNode, AnyAstNode, ScopeNode } from '../types';
import { RESERVED, VARIABLE_OPT } from '../config/constans';
import { isKind, isScopeNode } from '../utils/typeGard';
import { fileIterator, normalizePath, scanPHPFile } from '../utils/utils';
import logger from '../utils/logger';
import { Runtime } from '../core/runtime';
import { Ast } from '../core/ast';
import { RecordVariable } from '../core/recordNode';
import { BuildContext } from '../core/buildOption';
import { getNodeName } from '../utils/variableUtil';

export default async function (buildContext: BuildContext) {
	const variables = buildContext.variables;
	const ROOT_DIR = buildContext.distDir;

	function recordVariable(node: AstNode, replace?: string): void;
	function recordVariable(node: AstNode, source?: RecordVariable | null): void;
	function recordVariable(node: AstNode, arg: string | RecordVariable | null = null) {
		if (node.name.length <= VARIABLE_OPT.MIX_NAME_LENGTH) return;

		const record = node.lookup();

		if (record) {
			record.resigns.push(node);
			return;
		}

		if (arguments.length === 1) {
			const uuid = uuidv4(true);
			node.scope.setCache(node.name, new RecordVariable(node, randomPrefix() + uuid.slice(-4)));
			return;
		}

		if (typeof arg === 'string') {
			node.scope.setCache(node.name, new RecordVariable(node, arg));
			return;
		}

		node.scope.setCache(node.name, new RecordVariable(node, arg));
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

	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		// 遍历第一次，记录所有的变量定义
		ast.walk((node: AstNode) => {
			if (!node.parent) return;
			if (isKind(node, 'assign')) {
				assignLeftIterator(node.left as AstNode);
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
			// 跳过所有和类相关的实现
			if (isKind(node.parent, 'class')) return;
			if (isKind(node.parent, 'function')) return;
			if (isKind(node.parent, 'method')) return;
			if (isKind(node.parent, 'property')) return;
			if (isKind(node.parent, 'propertystatement')) return;
			if (isKind(node.parent, 'propertylookup') && node.getAttribute('source') !== 'what') return;
			if (isKind(node.parent, 'staticlookup')) return;

			// 查找 global 和 use
			let record = node.lookup();
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
				ast.recordReplacement(node, record.replace);
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
