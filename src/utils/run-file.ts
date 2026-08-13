import { spawn } from 'child_process';

interface SpawnOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeout?: number;
	stdio?: 'inherit' | 'pipe';
}

interface SpawnResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

export function runFile(
	command: string,
	args: string[],
	options: SpawnOptions = {},
): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: options.stdio ?? 'pipe',
			windowsHide: true,
		});

		// ---------- 超时控制 ----------
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (options.timeout && options.timeout > 0) {
			timer = setTimeout(() => {
				child.kill('SIGTERM');
				// SIGTERM 后给 3s 宽限期，仍不退出则强杀
				setTimeout(() => {
					if (!child.killed) child.kill('SIGKILL');
				}, 3000);
				reject(new Error(`Process timed out after ${options.timeout}ms`));
			}, options.timeout);
		}

		const clearTimer = () => {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
		};

		// ---------- 收集输出 ----------
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		if (child.stdout) {
			child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		}
		if (child.stderr) {
			child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
		}

		// ---------- 进程启动失败 ----------
		child.on('error', (err) => {
			clearTimer();
			reject(new Error(`Failed to spawn "${command}": ${err.message}`));
		});

		// ---------- 正常退出 ----------
		child.on('close', (code) => {
			clearTimer();
			resolve({
				code,
				stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
				stderr: Buffer.concat(stderrChunks).toString('utf-8'),
			});
		});
	});
}
