#include "php.h"
#include <openssl/rand.h>
#include <openssl/evp.h>
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
    #include <windows.h>
    // Windows 不需要 fcntl.h / dirent.h / sys/types.h
    // open() / O_EXCL / ssize_t / DIR* 等在 Windows 分支中根本不使用
#else
    #include <dlfcn.h>
    #include <limits.h>
    #include <stdlib.h>
    #include <unistd.h>
    #include <sys/stat.h>
    #include <sys/types.h>   // ← ssize_t, mode_t
    #include <fcntl.h>       // ← O_WRONLY, O_CREAT, O_EXCL
    #include <errno.h>       // ← errno, EINTR
    #include <dirent.h>      // ← DIR, opendir, readdir, closedir
    #ifndef MAX_PATH
        #define MAX_PATH 4096
    #endif
#endif

#define AES_KEY_LEN 32
#define AES_IV_LEN 12
#define AES_TAG_LEN 16

/*
|--------------------------------------------------------------------------
| 打包时由 Node 自动生成
|--------------------------------------------------------------------------
*/

// 加密文件名
static const char BINFILE[] = "KA_C_BINFILE";

static const char TEMPDIR[] = "KA_C_TEMPDIR";

// AES 参数
static const unsigned char AES_KEY[AES_KEY_LEN] = {
    // node 生成
    KA_C_AES_KEY
    // node 生成
};

static const unsigned char AES_IV[AES_IV_LEN] = {
    // node 生成
    KA_C_AES_IV
    // node 生成
};

static const unsigned char AES_TAG[AES_TAG_LEN] = {
    // node 生成
    KA_C_AES_TAG
    // node 生成
};

/*
|--------------------------------------------------------------------------
| 工具函数
|--------------------------------------------------------------------------
*/

// 获取扩展所在目录
static char *get_extension_dir()
{
    static char dir[MAX_PATH];

#ifdef _WIN32

    HMODULE module = NULL;

    if (!GetModuleHandleExA(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
            (LPCSTR)&get_extension_dir,
            &module))
    {
        return NULL;
    }

    DWORD len = GetModuleFileNameA(
        module,
        dir,
        sizeof(dir));

    if (len == 0 || len >= sizeof(dir))
    {
        return NULL;
    }

    // 删除 runtime.dll 文件名
    while (len > 0)
    {
        if (dir[len - 1] == '\\')
        {
            dir[len - 1] = '\0';
            break;
        }

        len--;
    }

#else

    Dl_info info;

    if (dladdr(
            (void *)&get_extension_dir,
            &info) == 0)
    {
        return NULL;
    }

    strncpy(
        dir,
        info.dli_fname,
        sizeof(dir) - 1);

    dir[sizeof(dir) - 1] = '\0';

    // 删除 runtime.so 文件名

    char *last = strrchr(
        dir,
        '/');

    if (last)
    {
        *last = '\0';
    }

#endif

    return dir;
}

/**
 * 跨平台安全获取临时目录路径
 * @param buf      输出缓冲区
 * @param buf_size 缓冲区大小（建议 MAX_PATH 或 PATH_MAX）
 * @return 成功返回 buf 指针，失败返回 NULL
 */
static char *get_temp_dir(char *buf, size_t buf_size)
{
#ifdef _WIN32
    /*
     * Windows: GetTempPathA 按以下优先级查找：
     * 1. TMP 环境变量
     * 2. TEMP 环境变量
     * 3. USERPROFILE 环境变量
     * 4. Windows 系统目录
     *
     * 返回值包含尾部分隔符 '\'
     */
    DWORD len = GetTempPathA((DWORD)buf_size, buf);

    if (len == 0 || len >= buf_size)
    {
        return NULL;
    }

    // 移除尾部反斜杠，统一格式
    if (len > 0 && buf[len - 1] == '\\')
    {
        buf[len - 1] = '\0';
    }

    return buf;

#else
    /*
     * POSIX: 按安全优先级手动检查
     * 注意：故意不使用 getenv("TMPDIR") 作为首选
     * 因为 TMPDIR 可被任意用户设置，存在注入风险
     */
    const char *candidates[] = {
        "/tmp",
        "/var/tmp",
        NULL};

    struct stat st;

    for (int i = 0; candidates[i] != NULL; i++)
    {
        // 使用 lstat 防止符号链接攻击
        if (lstat(candidates[i], &st) != 0)
        {
            continue;
        }

        // 必须是真实目录，且权限为 1777 (sticky bit + rwxrwxrwx)
        // sticky bit 确保用户只能删除自己的文件
        if (S_ISDIR(st.st_mode) && (st.st_mode & 01777) == 01777)
        {
            size_t path_len = strlen(candidates[i]);
            if (path_len >= buf_size)
            {
                return NULL;
            }
            memcpy(buf, candidates[i], path_len + 1);
            return buf;
        }
    }

    // 所有候选目录均不可用
    return NULL;
#endif
}
// 清理临时目录
static int clean_temp_dir(const char *temp_dir)
{
#ifdef _WIN32
    WIN32_FIND_DATAA data;
    char pattern[MAX_PATH];
    snprintf(pattern, sizeof(pattern), "%s\\ka_*", temp_dir); // 只清理自己生成的文件

    HANDLE handle = FindFirstFileA(pattern, &data);
    if (handle == INVALID_HANDLE_VALUE)
        return 0;

    do
    {
        // 跳过 . 和 ..
        if (strcmp(data.cFileName, ".") == 0 || strcmp(data.cFileName, "..") == 0)
            continue;

        char file_path[MAX_PATH];
        snprintf(file_path, sizeof(file_path), "%s\\%s", temp_dir, data.cFileName);

        // Windows 下检查是否为重解析点(符号链接)
        DWORD attrs = GetFileAttributesA(file_path);
        if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_REPARSE_POINT))
        {
            // 符号链接直接删除链接本身，不跟随
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
    while ((entry = readdir(dir)) != NULL)
    {
        // 只清理 ka_ 前缀的文件，避免误删其他内容
        if (strncmp(entry->d_name, "ka_", 3) != 0)
            continue;

        char file_path[PATH_MAX];
        snprintf(file_path, sizeof(file_path), "%s/%s", temp_dir, entry->d_name);

        // ?? 关键：使用 lstat 而非 stat，检测符号链接
        struct stat st;
        if (lstat(file_path, &st) != 0)
            continue;

        // 如果是符号链接，直接 unlink 链接本身
        // 如果是普通文件，正常删除
        // 拒绝删除目录、设备等其他类型
        if (S_ISLNK(st.st_mode) || S_ISREG(st.st_mode))
        {
            unlink(file_path);
        }
    }

    closedir(dir);
#endif

    return 0;
}
// 读取加密文件
static unsigned char *read_payload(const char *path, size_t *size)
{
    FILE *fp = NULL;
    unsigned char *buffer = NULL;

    fp = fopen(path, "rb");

    if (!fp)
    {
        return NULL;
    }

    fseek(fp, 0, SEEK_END);

    long file_size = ftell(fp);
    if (file_size < 0)
    {
        fclose(fp);
        return NULL;
    }
    *size = (size_t)file_size;

    fseek(fp, 0, SEEK_SET);

    buffer = malloc(*size);

    if (!buffer)
    {
        fclose(fp);
        return NULL;
    }

    size_t actual = fread(buffer, 1, *size, fp);
    if (actual != *size)
    {
        free(buffer);
        fclose(fp);
        return NULL;
    }

    fclose(fp);

    return buffer;
}

// AES解密
static unsigned char *decrypt_payload(
    const unsigned char *encrypted,
    size_t encrypted_size,
    size_t *output_size)
{
    unsigned char *decrypted = NULL;

    /*
        AES-GCM解密后长度等于密文长度
    */

    decrypted = malloc(
        encrypted_size);

    if (!decrypted)
    {
        return NULL;
    }

    /*
        AES-256-GCM

        对应 PHP:

        openssl_decrypt(
            $encrypted,
            'aes-256-gcm',
            key,
            OPENSSL_RAW_DATA,
            iv,
            tag
        );

    */

    int result = aes_gcm_decrypt(
        encrypted,
        encrypted_size,

        AES_KEY,
        AES_KEY_LEN,

        AES_IV,
        AES_IV_LEN,

        AES_TAG,
        AES_TAG_LEN,

        decrypted,
        output_size);

    if (result != 0)
    {
        free(decrypted);

        return NULL;
    }

    return decrypted;
}

static int aes_gcm_decrypt(
    const unsigned char *encrypted,
    size_t encrypted_size,

    const unsigned char *key,
    size_t key_size,

    const unsigned char *iv,
    size_t iv_size,

    const unsigned char *tag,
    size_t tag_size,

    unsigned char *output,
    size_t *output_size)
{
    EVP_CIPHER_CTX *ctx = NULL;

    int len = 0;
    int plaintext_len = 0;

    ctx = EVP_CIPHER_CTX_new();

    if (!ctx)
    {
        return -1;
    }

    /*
        AES-256-GCM
    */

    if (EVP_DecryptInit_ex(
            ctx,
            EVP_aes_256_gcm(),
            NULL,
            NULL,
            NULL) != 1)
    {
        EVP_CIPHER_CTX_free(ctx);

        return -2;
    }

    /*
        设置 key 和 iv
    */

    if (EVP_DecryptInit_ex(
            ctx,
            NULL,
            NULL,
            key,
            iv) != 1)
    {
        EVP_CIPHER_CTX_free(ctx);

        return -3;
    }

    /*
        解密密文
    */

    if (EVP_DecryptUpdate(
            ctx,
            output,
            &len,
            encrypted,
            encrypted_size) != 1)
    {
        EVP_CIPHER_CTX_free(ctx);

        return -4;
    }

    plaintext_len = len;

    /*
        设置 GCM TAG

        对应 PHP openssl_decrypt 最后的 tag 参数
    */

    if (EVP_CIPHER_CTX_ctrl(
            ctx,
            EVP_CTRL_GCM_SET_TAG,
            tag_size,
            (void *)tag) != 1)
    {
        EVP_CIPHER_CTX_free(ctx);

        return -5;
    }

    /*
        最终验证 TAG

        如果 TAG 不正确，这里失败
    */

    if (EVP_DecryptFinal_ex(
            ctx,
            output + plaintext_len,
            &len) <= 0)
    {
        EVP_CIPHER_CTX_free(ctx);

        return -6;
    }

    plaintext_len += len;

    *output_size = plaintext_len;

    EVP_CIPHER_CTX_free(ctx);

    return 0;
}

// 写入临时PHP文件
// 修改返回类型为 zend_string* 或直接返回 bool/path
// 替换原有的 write_temp_php 函数
static zend_string *write_temp_php(
    const char *temp_dir,
    const char *prefix,
    const unsigned char *data,
    size_t size)
{
    char path[MAX_PATH];

    // prefix 为 NULL 时视为空字符串
    if (prefix == NULL)
    {
        prefix = "";
    }

    // 使用 OpenSSL RAND_bytes 生成 16 字节随机数据（跨平台统一）
    unsigned char rand_bytes[16];
    if (RAND_bytes(rand_bytes, sizeof(rand_bytes)) != 1)
    {
        return NULL;
    }

    // 按 GUID 格式解析：Data1(4B) Data2(2B) Data3(2B) Data4[8](8B)
    uint32_t d1 = ((uint32_t)rand_bytes[0] << 24) | ((uint32_t)rand_bytes[1] << 16) |
                  ((uint32_t)rand_bytes[2] << 8) | (uint32_t)rand_bytes[3];
    uint16_t d2 = ((uint16_t)rand_bytes[4] << 8) | (uint16_t)rand_bytes[5];
    uint16_t d3 = ((uint16_t)rand_bytes[6] << 8) | (uint16_t)rand_bytes[7];

#ifdef _WIN32
    snprintf(path, sizeof(path), "%s\\ka_%s%08lX%04X%04X%02X%02X%02X%02X%02X%02X%02X%02XKA_C_TEMP_FILETYPE",
             temp_dir, prefix,
             (unsigned long)d1, d2, d3,
             rand_bytes[8], rand_bytes[9], rand_bytes[10], rand_bytes[11],
             rand_bytes[12], rand_bytes[13], rand_bytes[14], rand_bytes[15]);

    // 重新以独占写模式打开，覆盖 GetTempFileNameA 创建的空白文件
    HANDLE hFile = CreateFileA(
        path,
        GENERIC_WRITE,
        0, // 不共享，防止其他进程读取
        NULL,
        CREATE_NEW,
        FILE_ATTRIBUTE_TEMPORARY, // 标记为临时文件
        NULL);

    if (hFile == INVALID_HANDLE_VALUE)
    {
        DeleteFileA(path);
        return NULL;
    }

    DWORD written = 0;
    BOOL ok = WriteFile(hFile, data, (DWORD)size, &written, NULL);
    CloseHandle(hFile);

    if (!ok || written != size)
    {
        DeleteFileA(path);
        return NULL;
    }

#else
    // POSIX: 复用完全相同的命名格式
    snprintf(path, sizeof(path), "%s/ka_%s%08X%04X%04X%02X%02X%02X%02X%02X%02X%02X%02XKA_C_TEMP_FILETYPE",
             temp_dir, prefix,
             d1, d2, d3,
             rand_bytes[8], rand_bytes[9], rand_bytes[10], rand_bytes[11],
             rand_bytes[12], rand_bytes[13], rand_bytes[14], rand_bytes[15]);

    // 使用 O_CREAT|O_EXCL 原子创建，等价于 CREATE_NEW
    int fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (fd < 0)
    {
        return NULL;
    }

    size_t total_written = 0;
    while (total_written < size)
    {
        ssize_t n = write(fd, data + total_written, size - total_written);
        if (n <= 0)
        {
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

    return zend_string_init(path, strlen(path), 0);
}

/*
|--------------------------------------------------------------------------
| PHP函数入口
|--------------------------------------------------------------------------
*/

PHP_FUNCTION(KA_C_RUNTIME_FUNCTION_NAME)
{
    unsigned char *encrypted = NULL;
    unsigned char *decrypted = NULL;
    zend_string *result = NULL; // 提前声明并初始化

    size_t encrypted_size = 0;
    size_t decrypted_size = 0;

    char temp_root[MAX_PATH];
    char temp_dir[MAX_PATH];
    char payload_path[MAX_PATH];
    int path_len = 0;

    char *ext_dir = get_extension_dir();
    if (!ext_dir)
    {
        php_error_docref(NULL, E_WARNING, "Failed to locate extension directory");
        RETURN_FALSE;
    }

    path_len = snprintf(
        payload_path,
        sizeof(payload_path),
#ifdef _WIN32
        "%s\\%s",
#else
        "%s/%s",
#endif,
        ext_dir,
        BINFILE);

    if (path_len < 0 || (size_t)path_len >= sizeof(payload_path))
    {
        php_error_docref(NULL, E_WARNING, "Path too long");
        RETURN_FALSE;
    }

    // ========== 阶段2: 获取安全临时目录 (TEMPDIR) ==========
    // TEMPDIR 用于存放解密后的 runtime.php，与 BINFILE 无关
    if (get_temp_dir(temp_root, sizeof(temp_root)) == NULL)
    {
        php_error_docref(NULL, E_WARNING, "Failed to locate a temporary directory");
        RETURN_FALSE;
    }

    int temp_dir_len = snprintf(
        temp_dir,
        sizeof(temp_dir),
#ifdef _WIN32
        "%s\\%s",
#else
        "%s/%s",
#endif,
        KA_C_TEMP_ROOT, // devMode ? ext_dir : temp_root
        TEMPDIR);

    if (temp_dir_len < 0 || (size_t)temp_dir_len >= sizeof(temp_dir))
    {
        php_error_docref(NULL, E_WARNING, "Path too long");
        RETURN_FALSE;
    }

    // 原子性地检查并创建目录（跨平台安全版本）
#ifdef _WIN32
    // Windows: CreateDirectoryA 在目录已存在时返回 FALSE
    // GetLastError() == ERROR_ALREADY_EXISTS 表示目录已存在，属于正常情况
    if (!CreateDirectoryA(temp_dir, NULL))
    {
        DWORD err = GetLastError();
        if (err != ERROR_ALREADY_EXISTS)
        {
            php_error_docref(NULL, E_WARNING, "Failed to create temp directory: error %lu", err);
            RETURN_FALSE;
        }
    }
#else
    // POSIX: mkdir 是原子操作，避免 TOCTOU 竞态
    // 0700 权限：仅所有者可访问，防止其他用户窥探解密后的 PHP 文件
    mode_t old_umask = umask(0077);
    if (mkdir(temp_dir, 0700) != 0)
    {
        if (errno != EEXIST)
        {
            php_error_docref(NULL, E_WARNING,
                             "Failed to create temp directory: %s", strerror(errno));
            RETURN_FALSE;
        }
        // EEXIST 时验证已有路径确实是目录（防止同名文件占位攻击）
        struct stat st;
        if (lstat(temp_dir, &st) != 0 || !S_ISDIR(st.st_mode))
        {
            php_error_docref(NULL, E_WARNING,
                             "Temp path exists but is not a directory");
            RETURN_FALSE;
        }
    }
    umask(old_umask); // 恢复原始 umask
#endif

    clean_temp_dir(temp_dir);

    encrypted = read_payload(payload_path, &encrypted_size);

    if (!encrypted)
    {
        php_error_docref(NULL, E_WARNING, "Failed to read encrypted payload");
        goto cleanup;
    }

    decrypted = decrypt_payload(encrypted, encrypted_size, &decrypted_size);

    if (!decrypted)
    {
        php_error_docref(NULL, E_WARNING, "Decryption failed");
        goto cleanup;
    }

    // 写入临时文件（使用安全版本）
    result = write_temp_php(temp_dir, NULL, decrypted, decrypted_size);
    if (!result)
    {
        php_error_docref(NULL, E_WARNING, "Failed to write temp PHP file");
        goto cleanup;
    }

cleanup:
    if (encrypted)
        free(encrypted);
    if (decrypted)
        free(decrypted);

    if (!result)
    {
        RETURN_FALSE;
    }
    RETURN_STR(result);
}

/* {{{ proto string|false create_temp_file(string $content, string $prefix)
   将二进制内容写入运行时临时目录，返回文件路径。用于调试定位错误。
   注意：必须在 KA_C_RUNTIME_FUNCTION_NAME 执行成功后调用。 */
PHP_FUNCTION(KA_C_CREATE_TEMP_FILE_FUNCTION_NAME)
{
    zend_string *content = NULL;
    zend_string *prefix = NULL;

    char temp_root[MAX_PATH];
    char temp_dir[MAX_PATH];

    ZEND_PARSE_PARAMETERS_START(2, 2)
    Z_PARAM_STR(content)
    Z_PARAM_STR(prefix)
    ZEND_PARSE_PARAMETERS_END();

    char *ext_dir = get_extension_dir();
    if (!ext_dir)
    {
        php_error_docref(NULL, E_WARNING, "Failed to locate extension directory");
        RETURN_FALSE;
    }

    // ========== 阶段2: 获取安全临时目录 (TEMPDIR) ==========
    // TEMPDIR 用于存放解密后的 runtime.php，与 BINFILE 无关
    if (get_temp_dir(temp_root, sizeof(temp_root)) == NULL)
    {
        php_error_docref(NULL, E_WARNING, "Failed to locate a temporary directory");
        RETURN_FALSE;
    }

    int temp_dir_len = snprintf(
        temp_dir,
        sizeof(temp_dir),
#ifdef _WIN32
        "%s\\%s",
#else
        "%s/%s",
#endif,
        KA_C_TEMP_ROOT, // devMode ? ext_dir : temp_root
        TEMPDIR);

    if (temp_dir_len < 0 || (size_t)temp_dir_len >= sizeof(temp_dir))
    {
        php_error_docref(NULL, E_WARNING, "Path too long");
        RETURN_FALSE;
    }

    // 验证目录确实存在（runtime 应已创建）
#ifdef _WIN32
    DWORD attrs = GetFileAttributesA(temp_dir);
    if (attrs == INVALID_FILE_ATTRIBUTES || !(attrs & FILE_ATTRIBUTE_DIRECTORY))
    {
        php_error_docref(NULL, E_WARNING,
                         "Temp directory does not exist. Call runtime function first.");
        RETURN_FALSE;
    }
#else
    struct stat st;
    if (lstat(temp_dir, &st) != 0 || !S_ISDIR(st.st_mode))
    {
        php_error_docref(NULL, E_WARNING,
                         "Temp directory does not exist. Call runtime function first.");
        RETURN_FALSE;
    }
#endif

    // 调用内部写入函数
    zend_string *result = write_temp_php(
        temp_dir,
        ZSTR_VAL(prefix),
        (const unsigned char *)ZSTR_VAL(content),
        ZSTR_LEN(content));

    if (!result)
    {
        php_error_docref(NULL, E_WARNING, "Failed to create temp file");
        RETURN_FALSE;
    }

    RETURN_STR(result);
}
/* }}} */
/*
|--------------------------------------------------------------------------
| PHP Extension注册
|--------------------------------------------------------------------------
*/

static const zend_function_entry runtime_functions[] =
    {
        PHP_FE(KA_C_RUNTIME_FUNCTION_NAME, NULL)
        PHP_FE(KA_C_CREATE_TEMP_FILE_FUNCTION_NAME, NULL)
        PHP_FE_END
    };

zend_module_entry runtime_module =
    {
        STANDARD_MODULE_HEADER,

        "KA_C_RUNTIME_DLL_NAME",

        runtime_functions,

        NULL, // module startup
        NULL, // module shutdown
        NULL, // request startup
        NULL, // request shutdown
        NULL, // info

        "1.0.0",

        STANDARD_MODULE_PROPERTIES};

#ifdef COMPILE_DL_RUNTIME

ZEND_GET_MODULE(KA_C_RUNTIME_DLL_NAME)

#endif