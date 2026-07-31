import { Parameter } from 'php-parser';
import { AstNode } from '../types';
import { Runtime } from '../core/runtime';
import { isKind } from './typeGard';
import { PhpParser } from '..';
import { uuidv4 } from '@ka-libs/crypto';
import { CONST_PREFIX } from '../config/constans';
import { getNodeName } from './helper';

export function findFunctionRecord(node: AstNode) {
	const scope = node.scope;
	if (isKind(node, 'parameter') || isKind(node.parent, 'parameter')) {
		if (isKind(scope, 'function')) {
			return Runtime.options.functions.get(getNodeName(scope.name));
		}
		if (isKind(scope, 'method') && isKind(scope.parent, 'class')) {
			const className = getNodeName(scope.parent.name);
			const methodName = getNodeName(scope.name);
			return Runtime.options.classes.get(className)?.methods.get(methodName);
		}
		if (isKind(scope, 'closure')) {
		}
	}
}
