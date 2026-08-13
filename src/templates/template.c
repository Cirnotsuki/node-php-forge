#include <openssl/evp.h>
#include <openssl/rand.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h> // malloc
#include <string.h>

#ifdef _WIN32
#	include <windows.h>
#	include <winternl.h>
#	include <io.h>
#	define IS_TTY() _isatty(_fileno(stdout))
// Windows 没有 fcntl.h / dirent.h / sys/types.h
// open() / O_EXCL / ssize_t / DIR* 等类型在 Windows 下不存在
#else
#	include <dirent.h> // DIR, opendir, readdir, closedir
#	include <dlfcn.h>
#	include <errno.h> // errno, EINTR
#	include <fcntl.h> // O_WRONLY, O_CREAT, O_EXCL
#	include <limits.h>
#	include <sys/stat.h>
#	include <sys/types.h> // ssize_t, mode_t
#	include <unistd.h>
#	include <pthread.h>
#	include <poll.h>
#	define IS_TTY() isatty(STDOUT_FILENO)
#	ifndef MAX_PATH
#		define MAX_PATH 4096
#	endif
#endif


#define AES_KEY_LEN 32
#define AES_IV_LEN 12
#define AES_TAG_LEN 16
#define AES_DATA_LEN KA_C_AES_DATA_LEN

#define RUNTIME_IN_SELF KA_C_RUNTIME_IN_SELF_VALUE
#define RUNTIME_DEBUG KA_C_RUNTIME_DEBUG_VALUE

/*
|--------------------------------------------------------------------------
| 退出码定义
|--------------------------------------------------------------------------
*/
#define EXIT_OK 0           // 成功
#define EXIT_ERR_ARGS 1     // 参数错误 / 调用方校验失败
#define EXIT_ERR_EXT_DIR 2  // 无法获取 EXE 所在目录
#define EXIT_ERR_TEMP_DIR 3 // 无法获取安全临时目录
#define EXIT_ERR_MKDIR 4    // 创建临时子目录失败
#define EXIT_ERR_READ 5     // 读取 payload / runtime 文件失败
#define EXIT_ERR_DECRYPT 6  // AES-GCM 解密或 JSON unescape 失败
#define EXIT_ERR_WRITE 7    // 写入临时文件失败
#define EXIT_ERR_CALLER 8   // 父进程校验未通过（预留，对应 is_parent_php）

/*
|--------------------------------------------------------------------------
| 混淆密钥 Node 常量定义
|--------------------------------------------------------------------------
*/
static char g_temp_dir[MAX_PATH];

// 临时目录、文件名常量
static const char TEMPDIR[] = "KA_C_TEMPDIR";
static const char BINFILE[] = "KA_C_BINFILE";

static const unsigned char AES_DATA[AES_DATA_LEN] = {KA_C_AES_DATA_VALUE};

// AES 混淆密钥
static const unsigned char AES_KEY_OBF[AES_KEY_LEN] = {
    // node 混淆数据
    KA_C_AES_KEY
    // node 混淆数据
};
static const unsigned char AES_KEY_MASK[AES_KEY_LEN] = {
    // node 混淆数据
    KA_C_AES_MASK_KEY
    // node 混淆数据
};

static const unsigned char AES_IV_OBF[AES_IV_LEN] = {
    // node 混淆数据
    KA_C_AES_IV
    // node 混淆数据
};
static const unsigned char AES_IV_MASK[AES_IV_LEN] = {
    // node 混淆数据
    KA_C_AES_MASK_IV
    // node 混淆数据
};

static const unsigned char AES_TAG_OBF[AES_TAG_LEN] = {
    // node 混淆数据
    KA_C_AES_TAG
    // node 混淆数据
};
static const unsigned char AES_TAG_MASK[AES_TAG_LEN] = {
    // node 混淆数据
    KA_C_AES_MASK_TAG
    // node 混淆数据
};

/*
|--------------------------------------------------------------------------
| 工具函数（路径获取、目录清理、文件操作）
|--------------------------------------------------------------------------
*/
// 获取 EXE 所在目录（替代旧的 get_extension_dir）
static char *get_exe_dir(char *dir, size_t dir_size) {
#ifdef _WIN32

	DWORD len = GetModuleFileNameA(NULL, dir, (DWORD)dir_size);

	if (len == 0 || len >= dir_size) {
		return NULL;
	}

	// 截断到最后一个 '\'
	while (len > 0) {
		if (dir[len - 1] == '\\') {
			dir[len - 1] = '\0';
			break;
		}
		len--;
	}

#else

	ssize_t len = readlink("/proc/self/exe", dir, dir_size - 1);
	if (len < 0)
		return NULL;
	dir[len] = '\0';

	char *last = strrchr(dir, '/');
	if (last) {
		*last = '\0';
	} else {
		return NULL;
	}

#endif

	return dir;
}

/**
 * 获取系统安全临时目录
 * @param buf      输出路径缓冲区
 * @param buf_size 缓冲区长度，建议 MAX_PATH / PATH_MAX
 * @return 成功返回 buf，失败 NULL
 */
static char *get_temp_dir(char *buf, size_t buf_size) {
#ifdef _WIN32
	/*
	 * Windows: GetTempPathA 自动按优先级查找
	 * 1. TMP 环境变量
	 * 2. TEMP 环境变量
	 * 3. USERPROFILE 环境变量
	 * 4. Windows 默认临时目录
	 *
	 * 返回路径末尾可能带 '\'，需要移除
	 */
	DWORD len = GetTempPathA((DWORD)buf_size, buf);

	if (len == 0 || len >= buf_size) {
		return NULL;
	}

	// 移除末尾路径分隔符
	if (len > 0 && buf[len - 1] == '\\') {
		buf[len - 1] = '\0';
	}

	return buf;

#else
	/*
	 * POSIX: 按优先级寻找安全临时目录
	 * 优先读取 getenv("TMPDIR")，不存在则依次尝试备选目录
	 * 要求目录权限为 1777（包含sticky位）防止篡改
	 */
	const char *candidates[] = {"/tmp", "/var/tmp", NULL};

	struct stat st;

	for (int i = 0; candidates[i] != NULL; i++) {
		// 使用 lstat 避免跟随符号链接
		if (lstat(candidates[i], &st) != 0) {
			continue;
		}

		// 判断目录并且权限包含 sticky+全局读写执行 1777
		// sticky 位防止普通用户删除他人文件
		if (S_ISDIR(st.st_mode) && (st.st_mode & 01777) == 01777) {
			size_t path_len = strlen(candidates[i]);
			if (path_len >= buf_size) {
				return NULL;
			}
			memcpy(buf, candidates[i], path_len + 1);
			return buf;
		}
	}

	// 无可用安全临时目录
	return NULL;
#endif
}

// 清理临时目录内 ka_ 开头文件
static int clean_temp_dir(const char *temp_dir) {
#ifdef _WIN32
	WIN32_FIND_DATAA data;
	char pattern[MAX_PATH];
	snprintf(pattern, sizeof(pattern), "%s\\ka_*", temp_dir);

	HANDLE handle = FindFirstFileA(pattern, &data);
	if (handle == INVALID_HANDLE_VALUE)
		return 0;

	do {
		// 跳过 . 和 ..
		if (strcmp(data.cFileName, ".") == 0 || strcmp(data.cFileName, "..") == 0) {
			continue;
		}

		if (strncmp(data.cFileName, "ka_", 3) != 0) {
			continue;
		}

		char file_path[MAX_PATH];
		snprintf(file_path, sizeof(file_path), "%s\\%s", temp_dir, data.cFileName);

		// Windows 判断重解析点（符号链接），直接删除不跟进
		DWORD attrs = GetFileAttributesA(file_path);
		if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_REPARSE_POINT)) {
			DeleteFileA(file_path);
			continue;
		}

		DeleteFileA(file_path);
	} while (FindNextFileA(handle, &data));

	FindClose(handle);

#else
	DIR *dir = opendir(temp_dir);
	if (!dir)
		return -1;

	struct dirent *entry;
	while ((entry = readdir(dir)) != NULL) {
		// 只处理 ka_ 前缀文件，跳过其他文件
		if (strncmp(entry->d_name, "ka_", 3) != 0)
			continue;

		char file_path[PATH_MAX];
		snprintf(file_path, sizeof(file_path), "%s/%s", temp_dir, entry->d_name);

		// 使用 lstat，不要使用 stat 防止跟随软链接
		struct stat st;
		if (lstat(file_path, &st) != 0)
			continue;

		// 普通文件或符号链接直接 unlink
		// 不递归删除目录，只清理文件
		if (S_ISLNK(st.st_mode) || S_ISREG(st.st_mode)) {
			unlink(file_path);
		}
	}

	closedir(dir);
#endif

	return 0;
}

/**
 * @brief 还原 AES-GCM 解密参数
 * @details 对应 Node.js 构建时的 XOR 混淆逻辑: real = obfuscated ^ mask
 */
static void deobfuscate_aes_params(unsigned char *out_key, unsigned char *out_iv, unsigned char *out_tag) {
	// 还原 Key (32 bytes)
	for (size_t i = 0; i < AES_KEY_LEN; i++) {
		out_key[i] = AES_KEY_OBF[i] ^ AES_KEY_MASK[i];
	}

	// 还原 IV (12 bytes)
	for (size_t i = 0; i < AES_IV_LEN; i++) {
		out_iv[i] = AES_IV_OBF[i] ^ AES_IV_MASK[i];
	}

	// 还原 Tag (16 bytes)
	for (size_t i = 0; i < AES_TAG_LEN; i++) {
		out_tag[i] = AES_TAG_OBF[i] ^ AES_TAG_MASK[i];
	}
}

static int aes_gcm_decrypt(
    const unsigned char *encrypted, size_t encrypted_size,

    const unsigned char *key, size_t key_size,

    const unsigned char *iv, size_t iv_size,

    const unsigned char *tag, size_t tag_size,

    unsigned char *output, size_t *output_size
) {
	EVP_CIPHER_CTX *ctx = NULL;

	int len = 0;
	int plaintext_len = 0;

	ctx = EVP_CIPHER_CTX_new();

	if (!ctx) {
		return -1;
	}

	/*
	    AES-256-GCM
	*/

	if (EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, NULL, NULL) != 1) {
		EVP_CIPHER_CTX_free(ctx);

		return -2;
	}

	/*
	    设置 key 与 iv
	*/

	if (EVP_DecryptInit_ex(ctx, NULL, NULL, key, iv) != 1) {
		EVP_CIPHER_CTX_free(ctx);

		return -3;
	}

	/*
	    解密密文
	*/

	if (EVP_DecryptUpdate(ctx, output, &len, encrypted, encrypted_size) != 1) {
		EVP_CIPHER_CTX_free(ctx);

		return -4;
	}

	plaintext_len = len;

	/*
	    设置 GCM TAG

	    对应 PHP openssl_decrypt 传入 tag 参数
	*/

	if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, tag_size, (void *)tag) != 1) {
		EVP_CIPHER_CTX_free(ctx);

		return -5;
	}

	/*
	    完成解密校验 TAG

	    TAG 校验失败此处会返回错误
	*/

	if (EVP_DecryptFinal_ex(ctx, output + plaintext_len, &len) <= 0) {
		EVP_CIPHER_CTX_free(ctx);

		return -6;
	}

	plaintext_len += len;

	*output_size = plaintext_len;

	EVP_CIPHER_CTX_free(ctx);

	return 0;
}

/**
 * @brief 安全内存擦除（防止被编译器优化掉）
 */
static void secure_zero(void *ptr, size_t len) {
#if defined(_WIN32)
	// Windows API 保证不会被优化
	SecureZeroMemory(ptr, len);
#elif defined(__STDC_LIB_EXT1__)
	// C11 Annex K 标准安全函数
	memset_s(ptr, len, 0, len);
#elif defined(__GNUC__) || defined(__clang__)
	// GCC/Clang: 通过内联汇编屏障阻止优化
	volatile unsigned char *p = (volatile unsigned char *)ptr;
	while (len--) {
		*p++ = 0;
	}
#else
	// Fallback: 使用 volatile 指针 + 内存屏障
	volatile unsigned char *p = (volatile unsigned char *)ptr;
	size_t i = 0;
	while (i < len) {
		p[i++] = 0;
	}
#endif
}

// AES解密入口
static unsigned char *decrypt_payload(const unsigned char *encrypted, size_t encrypted_size, size_t *output_size) {
	// 栈上存放真实密钥，函数返回前主动擦除
	unsigned char real_key[AES_KEY_LEN];
	unsigned char real_iv[AES_IV_LEN];
	unsigned char real_tag[AES_TAG_LEN];

	// 还原混淆密钥
	deobfuscate_aes_params(real_key, real_iv, real_tag);

	unsigned char *decrypted = malloc(encrypted_size);
	if (!decrypted) {
		secure_zero(real_key, sizeof(real_key));
		secure_zero(real_iv, sizeof(real_iv));
		secure_zero(real_tag, sizeof(real_tag));
		return NULL;
	}

	int result = aes_gcm_decrypt(
	    encrypted, encrypted_size, real_key,
	    AES_KEY_LEN,           // 使用栈上还原后的密钥
	    real_iv, AES_IV_LEN,   // 使用栈上还原后的 IV
	    real_tag, AES_TAG_LEN, // 使用栈上还原后的 TAG
	    decrypted, output_size
	);

	// 立即擦除栈上真实密钥
	secure_zero(real_key, sizeof(real_key));
	secure_zero(real_iv, sizeof(real_iv));
	secure_zero(real_tag, sizeof(real_tag));

	if (result != 0) {
		free(decrypted);

		return NULL;
	}

	return decrypted;
}

/**
 * @brief 原地解析 JSON 转义字符
 * @param buf      输入/输出缓冲区（内容会被直接修改）
 * @param len      原始数据长度
 * @return size_t  解码后的新长度；若遇到非法转义序列则返回 0
 * @note           支持: \" \\ \/ \b \f \n \r \t \uXXXX
 *                 不支持代理对(surrogate pair)，\uD800-\uDFFF 视为非法
 */
static size_t json_unescape_inplace(unsigned char *buf, size_t len) {
	if (!buf || len == 0)
		return 0;

	size_t read = 0;  // 读取游标
	size_t write = 0; // 写入游标（始终 <= read）

	while (read < len) {
		if (buf[read] != '\\') {
			// 非转义字符，直接拷贝
			buf[write++] = buf[read++];
			continue;
		}

		// 遇到 '\'，至少还需要一个后续字符
		if (read + 1 >= len)
			return 0;

		unsigned char esc = buf[read + 1];
		switch (esc) {
		case '"':
			buf[write++] = '"';
			read += 2;
			break;
		case '\\':
			buf[write++] = '\\';
			read += 2;
			break;
		case '/':
			buf[write++] = '/';
			read += 2;
			break;
		case 'b':
			buf[write++] = '\b';
			read += 2;
			break;
		case 'f':
			buf[write++] = '\f';
			read += 2;
			break;
		case 'n':
			buf[write++] = '\n';
			read += 2;
			break;
		case 'r':
			buf[write++] = '\r';
			read += 2;
			break;
		case 't':
			buf[write++] = '\t';
			read += 2;
			break;

		case 'u': {
			// \uXXXX: 需要恰好 4 个十六进制数字
			if (read + 5 >= len)
				return 0;

			unsigned int cp = 0;
			for (int i = 0; i < 4; i++) {
				unsigned char c = buf[read + 2 + i];
				unsigned int nibble;
				if (c >= '0' && c <= '9')
					nibble = c - '0';
				else if (c >= 'a' && c <= 'f')
					nibble = c - 'a' + 10;
				else if (c >= 'A' && c <= 'F')
					nibble = c - 'A' + 10;
				else
					return 0; // 非法十六进制字符

				cp = (cp << 4) | nibble;
			}

			// 拒绝代理对区间 U+D800..U+DFFF
			if (cp >= 0xD800 && cp <= 0xDFFF)
				return 0;

			// UTF-8 编码
			if (cp <= 0x7F) {
				buf[write++] = (unsigned char)cp;
			} else if (cp <= 0x7FF) {
				buf[write++] = (unsigned char)(0xC0 | (cp >> 6));
				buf[write++] = (unsigned char)(0x80 | (cp & 0x3F));
			} else { // cp <= 0xFFFF (BMP 范围内，已排除代理对)
				buf[write++] = (unsigned char)(0xE0 | (cp >> 12));
				buf[write++] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F));
				buf[write++] = (unsigned char)(0x80 | (cp & 0x3F));
			}

			read += 6; // \u + 4 hex digits
			break;
		}

		default:
			// 未识别的转义序列
			return 0;
		}
	}

	return write;
}

// 创建临时文件，供PHP加载
// 参数：临时目录、前缀、二进制数据、长度
// 返回：堆分配路径字符串，调用方需要free
static char *write_temp_php(const char *temp_dir, const char *prefix, const unsigned char *data, size_t size) {
	char path[MAX_PATH];

	// prefix 为 NULL 时置空字符串
	if (!prefix)
		prefix = "";

	// 使用 OpenSSL RAND_bytes 获取16字节随机数生成文件名，避免冲突
	unsigned char rand_bytes[16];
	if (RAND_bytes(rand_bytes, sizeof(rand_bytes)) != 1) {
		return NULL;
	}

	// 构造简易GUID格式：Data1(4B) Data2(2B) Data3(2B) Data4[8](8B)
	uint32_t d1 = ((uint32_t)rand_bytes[0] << 24) | ((uint32_t)rand_bytes[1] << 16) | ((uint32_t)rand_bytes[2] << 8) | (uint32_t)rand_bytes[3];
	uint16_t d2 = ((uint16_t)rand_bytes[4] << 8) | (uint16_t)rand_bytes[5];
	uint16_t d3 = ((uint16_t)rand_bytes[6] << 8) | (uint16_t)rand_bytes[7];

#ifdef _WIN32

	int path_len = snprintf(
	    path, sizeof(path), "%s\\ka_%s%08lX%04X%04X%02X%02X%02X%02X%02X%02X%02X%02XKA_C_TEMP_FILETYPE", temp_dir, prefix, (unsigned long)d1, d2, d3, rand_bytes[8], rand_bytes[9],
	    rand_bytes[10], rand_bytes[11], rand_bytes[12], rand_bytes[13], rand_bytes[14], rand_bytes[15]
	);

	if (path_len < 0 || (size_t)path_len >= sizeof(path)) {
		return NULL; // 路径截断，拒绝创建文件
	}

	// 使用 CREATE_NEW 保证文件不存在，防止竞争；不使用 GetTempFileNameA
	// 容易被预测
	HANDLE hFile = CreateFileA(
	    path, GENERIC_WRITE,
	    0, // 独占打开，禁止共享
	    NULL, CREATE_NEW,
	    FILE_ATTRIBUTE_TEMPORARY, // 临时文件优化
	    NULL
	);

	if (hFile == INVALID_HANDLE_VALUE) {
		DeleteFileA(path);
		return NULL;
	}

	DWORD written = 0;
	BOOL ok = WriteFile(hFile, data, (DWORD)size, &written, NULL);
	CloseHandle(hFile);

	if (!ok || written != size) {
		DeleteFileA(path);
		return NULL;
	}

#else
	// POSIX: O_CREAT|O_EXCL 等价 Windows CREATE_NEW，防止竞态创建
	int path_len = snprintf(
	    path, sizeof(path), "%s/ka_%s%08X%04X%04X%02X%02X%02X%02X%02X%02X%02X%02XKA_C_TEMP_FILETYPE", temp_dir, prefix, d1, d2, d3, rand_bytes[8], rand_bytes[9], rand_bytes[10],
	    rand_bytes[11], rand_bytes[12], rand_bytes[13], rand_bytes[14], rand_bytes[15]
	);

	if (path_len < 0 || (size_t)path_len >= sizeof(path)) {
		return NULL; // 路径截断，拒绝创建文件
	}

	int fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0600);
	if (fd < 0) {
		return NULL;
	}

	size_t total_written = 0;
	while (total_written < size) {
		ssize_t n = write(fd, data + total_written, size - total_written);
		if (n <= 0) {
			if (n < 0 && errno == EINTR)
				continue;
			close(fd);
			unlink(path);
			return NULL;
		}
		total_written += n;
	}

	fsync(fd);
	close(fd);
#endif

	size_t len = strlen(path);
	char *result = (char *)malloc(len + 1);
	if (!result)
		return NULL;
	memcpy(result, path, len + 1); // 包含末尾 '\0'
	return result;
}


// ====== 智能清理线程 ======
#ifdef _WIN32
static DWORD WINAPI smart_clean(LPVOID param) {
	HANDLE hStdout = GetStdHandle(STD_OUTPUT_HANDLE);

	// 尝试用 PeekNamedPipe 判断是否为管道
	DWORD bytes_avail;
	BOOL is_pipe = PeekNamedPipe(hStdout, NULL, 0, NULL, &bytes_avail, NULL);

	if (is_pipe) {
		// 管道场景：最多等 1 秒，期间持续检测管道是否断开
		// 注意：不能用 ReadFile（stdout 是写句柄）
		// 改用循环 PeekNamedPipe + Sleep 模拟等待
		for (int i = 0; i < 10; i++) {
			Sleep(100);
			// PeekNamedPipe 在对端关闭后会返回 FALSE
			if (!PeekNamedPipe(hStdout, NULL, 0, NULL, &bytes_avail, NULL)) {
				break; // 管道已断开，立即清理
			}
		}
	} else {
		// 非管道（理论上不应到达这里，TTY 已在 main 拦截）
		Sleep(1000);
	}

	clean_temp_dir(g_temp_dir);
	return 0;
}
#else
static void *smart_clean(void *param) {
	// POSIX：用 poll 检测 stdout 是否被对端关闭
	// 每 100ms 检查一次，最多 1 秒
	for (int i = 0; i < 10; i++) {
		struct pollfd pfd = {.fd = STDOUT_FILENO, .events = 0}; // events=0 只监测异常
		int ret = poll(&pfd, 1, 100);

		if (ret > 0 && (pfd.revents & (POLLHUP | POLLERR))) {
			break; // 对端已关闭，立即清理
		}
		// ret == 0: 超时，继续循环
		// ret > 0 无 POLLHUP: 管道仍存活，继续等待
	}

	clean_temp_dir(g_temp_dir);
	return NULL;
}
#endif

static void start_smart_clean(const char *path) {
	strncpy(g_temp_dir, path, sizeof(g_temp_dir) - 1);
	g_temp_dir[sizeof(g_temp_dir) - 1] = '\0';

#ifdef _WIN32
	HANDLE h = CreateThread(NULL, 0, smart_clean, NULL, 0, NULL);
	if (h)
		CloseHandle(h);
#else
	pthread_t tid;
	pthread_create(&tid, NULL, smart_clean, NULL);
	pthread_detach(tid);
#endif
}

/*
|--------------------------------------------------------------------------
| main - CLI 入口
|--------------------------------------------------------------------------
|
| 使用方式: runtime.exe [--create-temp <prefix>]
|
| 无参数:   解密 payload → 写入临时 PHP → stdout 输出路径
| --create-temp <prefix>: 从 stdin 读取内容 → 创建临时文件 → stdout 输出路径
|
| 成功: exit(0), stdout = 文件路径(无换行)
| 失败: exit(非0), stderr = 错误信息
|--------------------------------------------------------------------------
*/
int main(int argc, char *argv[]) {
	// ====== 入口守卫：非管道环境直接拒绝 ======
	// if (IS_TTY()) {
	// 	return EXIT_ERR_CALLER;
	// }

	char exe_dir[MAX_PATH];
	char temp_root[MAX_PATH];
	char temp_dir[MAX_PATH];

	unsigned char *decrypted = NULL;
	char *result_path = NULL;

	// ====== 获取 EXE 所在目录 ======
	if (!get_exe_dir(exe_dir, sizeof(exe_dir))) {
		return EXIT_ERR_EXT_DIR;
	}

	// ====== 获取安全临时根目录 ======
	if (!get_temp_dir(temp_root, sizeof(temp_root))) {
		return EXIT_ERR_TEMP_DIR;
	}

	// debug 模式把临时目录切换至程序同级目录
	if (RUNTIME_DEBUG == 1) {
		snprintf(temp_root, sizeof(temp_root), "%s", exe_dir);
	}

	// ====== 拼接临时子目录路径 ======
	int temp_dir_len;
#ifdef _WIN32
	temp_dir_len = snprintf(temp_dir, sizeof(temp_dir), "%s\\%s", temp_root, TEMPDIR);
#else
	temp_dir_len = snprintf(temp_dir, sizeof(temp_dir), "%s/%s", temp_root, TEMPDIR);
#endif

	if (temp_dir_len < 0 || (size_t)temp_dir_len >= sizeof(temp_dir)) {
		return EXIT_ERR_WRITE; // 路径截断，拒绝创建文件
	}
	// ====== 创建临时目录 ======
#ifdef _WIN32
	if (!CreateDirectoryA(temp_dir, NULL)) {
		DWORD err = GetLastError();
		if (err != ERROR_ALREADY_EXISTS) {
			return EXIT_ERR_MKDIR;
		}
	}
#else
	mode_t old_umask = umask(0077);
	if (mkdir(temp_dir, 0700) != 0) {
		if (errno != EEXIST) {
			umask(old_umask);
			return EXIT_ERR_MKDIR;
		}
		struct stat st;
		if (lstat(temp_dir, &st) != 0 || !S_ISDIR(st.st_mode)) {
			umask(old_umask);
			return EXIT_ERR_MKDIR;
		}
	}
	umask(old_umask);
#endif

	clean_temp_dir(temp_dir);

	size_t decrypted_size = 0;

	decrypted = decrypt_payload(AES_DATA, AES_DATA_LEN, &decrypted_size);

	if (!decrypted) {
		return EXIT_ERR_DECRYPT;
	}

	decrypted_size = json_unescape_inplace(decrypted, decrypted_size);

	if (decrypted_size == 0) {
		free(decrypted);
		return EXIT_ERR_DECRYPT;
	}

	unsigned char *decrypted_base = decrypted; // 保存原始堆指针

	// json_unescape_inplace、去转义等处理
	if (decrypted_size >= 2 && decrypted[0] == '"' && decrypted[decrypted_size - 1] == '"') {
		decrypted += 1;
		decrypted_size -= 2;
	} else if (decrypted_size > 0 && (decrypted[0] == '"' || decrypted[decrypted_size - 1] == '"')) {
		// 只有一侧有引号 → 格式异常
		free(decrypted_base);
		return EXIT_ERR_DECRYPT;
	}

	result_path = write_temp_php(temp_dir, NULL, decrypted, decrypted_size);
	free(decrypted_base); // 务必释放malloc返回的原始指针

	if (!result_path) {
		return EXIT_ERR_WRITE;
	}

	// ====== 输出结果到 stdout（不带换行，PHP直接trim） ======
	fwrite(result_path, 1, strlen(result_path), stdout);
	fflush(stdout);
	free(result_path);

	start_smart_clean(temp_dir);

	return EXIT_OK;
}