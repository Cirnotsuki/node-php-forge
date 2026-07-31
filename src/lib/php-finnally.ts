import { uuidv4 } from '@ka-libs/crypto';
import { Runtime } from '../core/runtime';
import { Ast } from '../core/ast';
import { BuildClass, BuildContext } from '../core/buildOption';
import { RecordVariable, RecordFunction, RecordIdentifier } from '../core/recordNode';
import { isKind, typedAstNode } from '../utils/typeGard';
import { fileIterator, getRaw, scanPHPFile } from '../utils/utils';
import { CONST_PREFIX, PACKAGE_REPLACEMENT } from '../config/constans';
import { AstNode } from '../types';
import PhpParser from 'php-parser';
import { randomPrefix } from '../utils/randomPrefix';
import hookArgTypes from '../config/hookArgTypes';
import { getNodeName } from '../utils/helper';
import { findBuildClass, findSelfBuildClass } from '../utils/pipeUtil';
export default async function (buildContext: BuildContext) {
	const ROOT_DIR = buildContext.distDir;
	const { functions, classes, constants } = Runtime.options;
	// const classes = Runtime.options.classes;

	function handleCallableString(node: AstNode<PhpParser.String>) {
		if (!functions.has(node.value)) return;

		let selfArg: AstNode<PhpParser.String | PhpParser.Array | PhpParser.List> = node;
		let classNode = null;
		if (isKind(node.parent, 'entry')) {
			if (isKind(node.parent.parent, 'array') || isKind(node.parent.parent, 'list')) {
				selfArg = node.parent.parent;
				if (isKind(node.parent.parent.items[0], 'entry')) {
					classNode = node.parent.parent.items[0].value;
				}
			}
		}

		if (!selfArg) return;

		const parentNode = selfArg.parent;

		if (!isKind(parentNode, 'call')) return;
		const hookName = getNodeName(parentNode.what.name);

		// console.log(node.parent);

		const argIndex = parentNode.arguments.indexOf(selfArg);
		const types = hookArgTypes.get(hookName) || [];
		const argType = types[argIndex];
		if (argType !== 'callable') return;

		const functionRecord = functions.get(node.value);
		if (functionRecord) {
			node.recordReplacement(`"${functionRecord.replace}"`);

			if (!hookArgTypes.has(hookName)) {
				Runtime.options.hooks.add(hookName);
			}
		}

		if (!classNode || !isKind(classNode, 'string')) return;

		const classRecord = classes.get(classNode.value);
		if (!classRecord) return;
		if (!classRecord.methods.has(node.value)) return;

		classNode.recordReplacement(`"${classRecord.name.replace}"`);
		node.recordReplacement(`"${classRecord.methods.get(node.value)!.replace}"`);
	}

	function handleStaticCallable(array: AstNode<PhpParser.Array>) {
		if (array.items.length !== 2) return;

		if (!isKind(array.items[0], 'entry')) return;

		const staticlookup = array.items[0].value;
		if (!isKind(staticlookup, 'staticlookup')) return;

		const identifier = staticlookup.offset;
		if (!isKind(identifier, 'identifier')) return;

		const what = typedAstNode(staticlookup.what);

		const offset = getNodeName(identifier.name);
		if (offset !== 'class') return;

		const buildClass = findBuildClass(what);
		if (!buildClass) return;

		const method = array.items[1];
		if (!isKind(method, 'entry')) return;

		const methodNode = method.value;

		if (!isKind(methodNode, 'string')) return;

		const methodRecord = buildClass.methods.get(methodNode.value);
		if (!methodRecord) return;

		methodNode.recordReplacement(`"${methodRecord.replace}"`);
	}

	function handleDefine(node: AstNode<PhpParser.Name>) {
		const name = getNodeName(node.name);
		if (!constants.has(name)) return;

		node.recordReplacement(constants.get(name)!);
	}

	function handleReplacement(node: AstNode<PhpParser.String>) {
		if (!Runtime.currentFile.includes('runtime.php')) return false;
		for (const [key, val] of Object.entries(Runtime.replacement)) {
			if (node.value.includes(key)) {
				node.recordReplacement(node.raw.replace(key, val));
				return true;
			}
		}
		return false;
	}

	function handleGlobalCall(call: AstNode<PhpParser.Call>) {
		if (!isKind(call.what, 'name')) return;
		const record = functions.get(getNodeName(call.what.name));
		
		if (record) {
			call.what.recordReplacement(record.replace);
		}
		// if(callNode.)
	}
	// 记录替换，只处理静态属性
	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		ast.walk((node) => {
			if (isKind(node, 'call')) {
				handleGlobalCall(node);
				return;
			}
			if (isKind(node, 'array') || isKind(node, 'list')) {
				handleStaticCallable(node);
				return;
			}

			if (isKind(node, 'string')) {
				handleReplacement(node) || handleCallableString(node);
				return;
			}
			if (isKind(node, 'name')) {
				handleDefine(node);
				return;
			}
		});

		ast.applyReplacements();
	});
}
