{
  "targets": [
    {
      "target_name": "yua0394b",
      "sources": [
        "runtime.c"
      ],
      "include_dirs": [
        "F:\\@My-Projects\\wp-php-merge\\deps\\php-8.3.33\\include",
        "F:\\@My-Projects\\wp-php-merge\\deps\\php-8.3.33\\include\\main",
        "F:\\@My-Projects\\wp-php-merge\\deps\\php-8.3.33\\include\\TSRM",
        "F:\\@My-Projects\\wp-php-merge\\deps\\php-8.3.33\\include\\Zend"
      ],
      "defines": [
        "COMPILE_DL_RUNTIME"
      ],
      "conditions": [
        [
          "OS!=\"win\"",
          {
            "cflags": [
              "-O2",
              "-fPIC",
              "-std=c11"
            ],
            "libraries": [
              "-lcrypto"
            ]
          }
        ],
        [
          "OS==\"win\"",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": [
                  "/O2",
                  "/std:c11"
                ]
              },
              "VCLinkerTool": {
                "AdditionalLibraryDirectories": [
                  "F:\\@My-Projects\\wp-php-merge\\deps\\openssl\\lib"
                ]
              }
            },
            "libraries": [
              "libcrypto.lib"
            ]
          }
        ]
      ]
    }
  ]
}