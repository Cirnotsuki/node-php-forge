import { AnyAstNode, AstNode } from '../types';
import { PhpParser } from '..';
import { isKind, typedAstNode } from '../utils/typeGard';
import { FunctionNode, RecordBase, RecordFunction, RecordVariable } from './recordNode';
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

	if (!type) {
		console.warn('nullAssignDeepType', sourceType);
	}

	return type || new AstType();
}

export class AstType {
	items: AstType[] = [];
	key: string = '';
	name: string = '';
	node: null | AstNode = null;
	bin: Array<AstType | string> = [];
	constructor(node: AstNode | null = null, key: string = '') {
		if (node) {
			this.init(node);
			this.node = node;
		} else {
			this.name = '';
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

		if (isKind(node.parent, 'parameter')) {
			this.name = this.handleParameter(node.parent);
			return;
		}

		if (isKind(node.parent, 'staticvariable')) {
			this.name = this.handleStaticVariable(node.parent.defaultValue);
			return;
		}

		this.name = this.analysisType(node);
	}

	handleStaticVariable(staticVal: PhpParser.StaticVariable['defaultValue']) {
		if (staticVal === null) {
			return '';
		}
		if (typeof staticVal !== 'object') {
			return typeof staticVal;
		}

		return new AstType(typedAstNode(staticVal)).name;
	}

	handleParameter(param: AstNode<PhpParser.Parameter>) {
		if (param.type) {
			return new AstType(typedAstNode(param.type)).name;
		}
		if (param.value) {
			return new AstType(typedAstNode(param.value)).name;
		}

		const parent = param.parent;
		if (isKind(parent, 'function') || isKind(parent, 'method') || isKind(parent, 'closure')) {
			const index = parent.arguments.indexOf(param);
			if (parent.record instanceof RecordFunction) {
				return this.analyisArgType(parent.record.calls, index);
			}
		}

		return '';
	}

	analyisArgType(calls: RecordFunction['calls'], index: number) {
		const variables = new Array<AstNode>();
		for (const call of calls.values()) {
			if (call[index]) {
				variables.push(call[index]);
			}
		}

		const types = variables.map((variable) => AstType.create(variable));

		// 使用Set去除重复类型
		const typeSet = new Set<string>(
			types.filter((type) => type instanceof AstType).map((type) => type.name),
		);

		// 如果所有类型相同，则返回该类型
		if (typeSet.size === 1) {
			return Array.from(typeSet)[0];
		}

		// 如果存在多种类型，返回'mixed'
		return 'mixed';
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
			this.bin = AstType.binExtractor(node);

			// 使用Set去除重复类型
			const typeSet = new Set<string>(
				this.bin.filter((type) => type instanceof AstType).map((type) => type.name),
			);

			if (typeSet.size === 1) {
				return Array.from(typeSet)[0];
			}
			// 如果所有类型相同，则返回该类型

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
		const types = new Array<AstType | string>();

		function extractBin(bin: AstNode) {
			// 如果节点是二元表达式
			if (isKind(bin, 'bin')) {
				extractBin(bin.left as AstNode<typeof bin.left>);

				types.push(bin.type);

				extractBin(bin.right as AstNode<typeof bin.right>);
				return;
			}

			const type = AstType.create(bin);

			if (isKind(type.node, 'bin')) {
				extractBin(type.node);
				return;
			}

			// 获取节点的值类型并添加到类型数组中
			types.push(type);
		}

		// 开始提取节点中的类型
		extractBin(node);

		return types;
	}

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

		return new AstType(node);
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

		if (isKind(node.parent, 'parameter') || isKind(node.parent, 'staticvariable')) {
			return AstType.create(node);
		}

		console.warn('nullType', record);
		return new AstType();
	}
}
