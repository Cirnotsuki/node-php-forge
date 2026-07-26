import { AnyAstNode, AstNode } from '../types';
import { PhpParser } from '..';
import { isKind } from '../utils/typeGard';
import { RecordBase, RecordVariable } from './recordNode';
import { Runtime } from './runtime';

export function getNodeName(nameNode: PhpParser.Node | PhpParser.Identifier | string) {
	if (typeof nameNode === 'string') {
		return nameNode;
	}
	if (isKind(nameNode, 'identifier')) {
		return nameNode.name;
	}
	return '';
}

function findAssignNode(node: AstNode) {
	if (isKind(node, 'assign')) {
		return node;
	}
	if (node.parent) {
		return findAssignNode(node.parent);
	}
	return null;
}

function getAstTypeInList(list: AstType[], key: string): AstType | null {
	for (let i = 0; i < list.length; i += 1) {
		const type = list[i];
		const typeKey = type.key || `${i}`;
		if (typeKey === key) {
			return type;
		}
	}
	return null;
}

function getAssignDeepType(sourceType: AstType, keys: string[]) {
	let type: AstType | null = sourceType;

	while (keys.length > 0) {
		const key = keys.shift();
		if (!key) break;
		if (type) {
			type = getAstTypeInList(type.items, key);
		}
	}

	return type || new AstType();
}

// function getValueType(node: AstNode) {
// 	if (isKind(node, 'new')) {
// 		return getNodeName(node.what.name);
// 	}
// 	if (isKind(node, 'variable')) {
// 		const record = node.lookup();
// 		if (record && record instanceof RecordVariable) {
// 			return record.type;
// 		}
// 	}
// 	if (isKind(node, 'propertylookup')) {
// 		const classType = getValueType(node.what);
// 		const offsetName = getNodeName(node.offset);
// 		const cache = Runtime.options.classes.get(classType);
// 		// if(cache?.properties(offsetName))
// 	}
// 	if (['encapsed', 'string'].includes(node.kind)) {
// 		return 'string';
// 	}
// 	if (['array', 'list'].includes(node.kind)) {
// 		return 'array';
// 	}
// 	return node.kind;
// }

export class AstType {
	items: AstType[] = [];
	key: string = '';
	name: string = '';
	node: null | AstNode = null;
	constructor(
		node: AstNode<PhpParser.Variable | PhpParser.Entry | PhpParser.Expression> | null = null,
		key: string = '',
	) {
		if (node) {
			this.init(node);
			this.node = node;
		} else {
			this.name = 'void';
		}
		this.key = key;
	}

	init(node: AstNode<PhpParser.Expression>) {
		if (isKind(node, 'array') || isKind(node, 'list')) {
			this.name = 'array';
			this.items = node.items.map((child, index) => {
				return AstType.create(child as AstNode<typeof child>, `${index}`);
			});
			return;
		}

		this.name = this.analysisType(node);
	}

	/**
	 * 分析AST节点的类型
	 * @param node - 要分析的AST节点
	 * @return 返回分析后的类型结果，可能是单一类型或'mixed'
	 */
	analysisType(node: AstNode) {
		if (isKind(node, 'entry')) {
			this.key = getNodeName(node.key || '');
			const nodeType = AstType.create(node.value as AstNode);
			return nodeType.name;
		}

		if (isKind(node, 'bin')) {
			// 使用Set去除重复类型
			const typeSet = new Set<string>(AstType.binExtractor(node).map((type) => type.name));
			// 如果所有类型相同，则返回该类型
			if (typeSet.size === 1) {
				return Array.from(typeSet)[0];
			}

			// 如果存在多种类型，返回'mixed'
			return 'mixed';
		}

		return AstType.getValueType(node);
	}

	static getValueType(node: AstNode) {
		if (isKind(node, 'new')) {
			return getNodeName(node.what.name);
		}
		// if (isKind(node, 'variable')) {
		// 	const record = node.lookup();
		// 	if (record && record instanceof RecordVariable) {
		// 		return record.type;
		// 	}
		// }
		// if (isKind(node, 'propertylookup')) {
		// 	const classType = getValueType(node.what);
		// 	const offsetName = getNodeName(node.offset);
		// 	const cache = Runtime.options.classes.get(classType);
		// 	// if(cache?.properties(offsetName))
		// }
		if (['encapsed', 'string'].includes(node.kind)) {
			return 'string';
		}
		if (['array', 'list'].includes(node.kind)) {
			return 'array';
		}
		return node.kind;
	}

	/**
	 * 从二元表达式中提取类型
	 * @param bin - 要分析的二元表达式节点
	 */
	static binExtractor(node: AstNode) {
		// 创建一个数组来存储提取的类型
		const types = new Array<AstType>();

		function extractBin(bin: AstNode) {
			// 如果节点是二元表达式
			if (isKind(bin, 'bin')) {
				extractBin(bin.left as AstNode<typeof bin.left>);
				extractBin(bin.right as AstNode<typeof bin.left>);
				return;
			}

			const type = AstType.create(bin);

			if (isKind(type.node, 'bin')) {
				extractBin(type.node as AstNode<typeof type.node>);
				return;
			}

			// 获取节点的值类型并添加到类型数组中
			types.push(AstType.create(bin));
		}

		// 开始提取节点中的类型
		extractBin(node);

		// 在控制台输出所有提取的类型（用于调试）
		console.warn(types);

		return types;
	}

	/**
	 * 分析AST节点的类型
	 * @param node - 要分析的AST节点
	 * @return 返回分析后的类型结果，可能是单一类型或'mixed'
	 */
	// analysisType(node: AstNode) {
	// 	// 创建一个数组来存储提取的类型
	// 	const types = new Array<string>();

	// 	/**
	// 	 * 从二元表达式中提取类型
	// 	 * @param bin - 要分析的二元表达式节点
	// 	 */
	// 	function extractBin(bin: AstNode) {
	// 		// 如果节点是二元表达式
	// 		if (isKind(bin, 'bin')) {
	// 			// 递归处理左节点，如果是嵌套的二元表达式
	// 			if (isKind(bin.left, 'bin')) {
	// 				extractBin(bin.left);
	// 			}
	// 			// 递归处理右节点，如果是嵌套的二元表达式
	// 			if (isKind(bin.right, 'bin')) {
	// 				extractBin(bin.right);
	// 			}
	// 			return;
	// 		}
	// 		// 获取节点的值类型并添加到类型数组中
	// 		types.push(getValueType(bin));
	// 	}

	// 	// 开始提取节点中的类型
	// 	extractBin(node);

	// 	// 在控制台输出所有提取的类型（用于调试）
	// 	console.warn(types);
	// 	// 使用Set去除重复类型
	// 	const typeSet = new Set<string>(types);
	// 	// 如果所有类型相同，则返回该类型
	// 	if (typeSet.size === 1) {
	// 		return types[0];
	// 	}
	// 	// 如果存在多种类型，返回'mixed'
	// 	return 'mixed';
	// }

	static create(node: AstNode, key: string = ''): AstType {
		if (isKind(node, 'assign')) {
			return AstType.create(node.right as AstNode<typeof node.right>);
		}
		if (isKind(node, 'entry')) {
			key = getNodeName(node.key || '') || key;
			node = node.value as AstNode<typeof node.value>;
		}
		if (isKind(node, 'variable')) {
			const record = node.lookup();
			const source = record?.getSrouce();
			if (source instanceof RecordVariable) {
				source.type.key = key;
				return source.type;
			}
			if (record instanceof RecordVariable) {
				record.type.key = key;
				return record.type;
			}
		}
		return new AstType(node, key);
	}

	static factory(record: RecordBase): AstType {
		const node = record.node;

		if (node.hasAttribute('assignKey')) {
			const assgnNode = findAssignNode(node);
			if (assgnNode) {
				const type = AstType.create(assgnNode);
				const keys = JSON.parse(node.getAttribute('assignKey'));
				return getAssignDeepType(type, keys);
			}
		}

		return new AstType();
	}
}
