import { AstNodeMap, AstNode, ScopeNode } from '../types';
import PhpParser from 'php-parser';
export function isKind<K extends keyof AstNodeMap>(
	node: any,
	kind: K,
): node is AstNode<AstNodeMap[K]> {
	if (!node) return false;
	return node.kind === kind;
}

export function isScopeNode(node: AstNode | ScopeNode | null): node is ScopeNode {
	if (!node) return false;
	if (node.kind === 'program') return true;
	return (
		isKind(node, 'function') ||
		isKind(node, 'method') ||
		isKind(node, 'closure') ||
		isKind(node, 'block') ||
		isKind(node, 'class')
	);
}

export function typedAstNode(node: PhpParser.Node) {
	return node as AstNode<typeof node>;
}

export * as typeGard from './typeGard';
