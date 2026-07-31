import { Ast } from '../core/ast';
import { RecordVariable } from '../core/recordNode';
import { Runtime } from '../core/runtime';
import { AnyAstNode, AstNode } from '../types';
import { getNodeName } from './helper';
import { isKind } from './typeGard';
import PhpParser from 'php-parser';



export function getReturnType(
	node: AstNode<PhpParser.Function | PhpParser.Method | PhpParser.Closure>,
) {
	let returnType = 'void';
	Ast.walker(node, (returnNode) => {
		if (!isKind(returnNode, 'return')) return;
		if (returnNode.scope.boundary() !== node) return;
		if (returnNode.expr) {
			returnType = analysisType(returnNode.expr as AstNode);
		}
	});
	return returnType;
}

export function getFunctionNode(callNode: AstNode<PhpParser.Call>) {
	if (isKind(callNode.what, 'name')) {
		const name = getNodeName(callNode.what.name);
		const record = Runtime.options.functions.get(name);
		if (record) {
			return record.node;
		}
	}
	if (isKind(callNode.what, 'variable')) {
		return callNode.what.name;
	}
}
export function getValueType(node: AnyAstNode) {
	if (isKind(node, 'new')) {
		return getNodeName(node.what.name);
	}
	if (isKind(node, 'variable')) {
		const record = node.lookup();
		if (record && record instanceof RecordVariable) {
			return record.type;
		}
	}
	if (isKind(node, 'propertylookup')) {
		const classType = getValueType(node.what);
		const offsetName = getNodeName(node.offset);
		const cache = Runtime.options.classes.get(classType);
		// if(cache?.properties(offsetName))
	}
	if (['encapsed', 'string'].includes(node.kind)) {
		return 'string';
	} 
	if (['array', 'list'].includes(node.kind)) {
		return 'array';
	} 
	return node.kind;
}

/**
 * 分析AST节点的类型
 * @param node - 要分析的AST节点
 * @return 返回分析后的类型结果，可能是单一类型或'mixed'
 */
export function analysisType(node: AstNode) {
	// 如果节点是赋值表达式，则递归分析右侧表达式的类型
	if (isKind(node, 'assign')) {
		return analysisType(node.right as AstNode);
	}

	// 创建一个数组来存储提取的类型
	const types = new Array<string>();

	/**
	 * 从二元表达式中提取类型
	 * @param bin - 要分析的二元表达式节点
	 */
	function extractBin(bin: AstNode) {
		// 如果节点是二元表达式
		if (isKind(bin, 'bin')) {
			// 递归处理左节点，如果是嵌套的二元表达式
			if (isKind(bin.left, 'bin')) {
				extractBin(bin.left);
			}
			// 递归处理右节点，如果是嵌套的二元表达式
			if (isKind(bin.right, 'bin')) {
				extractBin(bin.right);
			}
			return;
		}
		// 获取节点的值类型并添加到类型数组中
		types.push(getValueType(bin));
	}

	// 开始提取节点中的类型
	extractBin(node);

	// 在控制台输出所有提取的类型（用于调试）
	console.warn(types);
	// 使用Set去除重复类型
	const typeSet = new Set<string>(types);
	// 如果所有类型相同，则返回该类型
	if (typeSet.size === 1) {
		return types[0];
	}
	// 如果存在多种类型，返回'mixed'
	return 'mixed';
}

export function findAssignNode(node: AstNode) {
	if (isKind(node, 'assign')) {
		return node;
	}
	if (node.parent) {
		return findAssignNode(node.parent);
	}
	return null;
}

export function getEntryItemInList(
	list: AstNode<PhpParser.List | PhpParser.Array>,
	key: string,
): AstNode<PhpParser.Expression> | null {
	for (let i = 0; i < list.items.length; i += 1) {
		const item = list.items[i];
		if (!isKind(item, 'entry')) continue;
		const itemKey = getNodeName(item.key || `${i}`);
		if (itemKey === key) {
			return item.value as AstNode<PhpParser.Expression>;
		}
	}
	return null;
}

function traceAssignNode(node: AstNode) {

}


export function getAssignDeepType(node: AstNode, keys: string[]) {
	const assignNode = findAssignNode(node);

	if (assignNode) {
		let value: AstNode | null = assignNode.right as AstNode<PhpParser.Expression>;

		while (keys.length > 0) {
			const key = keys.shift();
			if (!key) break;
			if (isKind(value, 'list') || isKind(value, 'array')) {
				value = getEntryItemInList(value, key);
			}
		}

		if (value) {
			return analysisType(value as AstNode);
		}
	}

	return 'any';
}

export function getVariableType(record: RecordVariable) {
	let type = 'void';

	const node = record.node;
	if (isKind(node.parent, 'assign')) {
		type = analysisType(node.parent.right as AstNode);
	}
	if (node.hasAttribute('assignKey')) {
		type = getAssignDeepType(node, node.getAttribute('assignKey').split('.'));
	}

	node.trace();

	return type;
}
