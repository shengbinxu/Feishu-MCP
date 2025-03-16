# 飞书文档 API 接口文档

## 0. 获取登录token

### 请求
```bash
curl -i -X POST 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal' \
-H 'Content-Type: application/json' \
-d '{
    "app_id": "<your_app_id>",
    "app_secret": "<your_app_secret>"
}'
```

### 返回结果
```json
{
  "app_access_token": "<access_token>",
  "code": 0,
  "expire": 6055,
  "msg": "ok",
  "tenant_access_token": "<tenant_access_token>"
}
```

## 1. 创建飞书文档

### 请求
```bash
curl -i -X POST 'https://open.feishu.cn/open-apis/docx/v1/documents' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer <access_token>' \
-d '{
    "folder_token": "<folder_token>",
    "title": "一篇新的文档"
}'
```

### 返回结果
```json
{
  "code": 0,
  "data": {
    "document": {
      "document_id": "<document_id>",
      "revision_id": 1,
      "title": "一篇新的文档"
    }
  },
  "msg": "success"
}
```

## 2. 获取文档基本信息

### 请求
```bash
curl -i -X GET 'https://open.feishu.cn/open-apis/docx/v1/documents/<document_id>' \
-H 'Authorization: Bearer <access_token>'
```

### 返回结果
```json
{
  "code": 0,
  "data": {
    "document": {
      "display_setting": {
        "show_authors": true,
        "show_comment_count": false,
        "show_create_time": false,
        "show_like_count": false,
        "show_pv": false,
        "show_related_matters": false,
        "show_uv": false
      },
      "document_id": "<document_id>",
      "revision_id": 1,
      "title": "一篇新的文档"
    }
  },
  "msg": "success"
}
```

## 3. 获取文档中的纯文本内容

### 请求
```bash
curl -i -X GET 'https://open.feishu.cn/open-apis/docx/v1/documents/<document_id>/raw_content?lang=0' \
-H 'Authorization: Bearer <access_token>'
```

### 返回结果
```json
{
  "code": 0,
  "data": {
    "content": "哈哈哈=1\n一级标题\n二级标题\n功能一\n功能二\n第一点\n第二点\n代码块-kotlin\n\n"
  },
  "msg": "success"
}
```

## 4. 获取文档中的块

### 请求
```bash
curl -i -X GET 'https://open.feishu.cn/open-apis/docx/v1/documents/<document_id>/blocks?document_revision_id=-1&page_size=500' \
-H 'Authorization: Bearer <access_token>'
```

### 返回结果
```json
{
  "code": 0,
  "data": {
    "has_more": false,
    "items": [
      {
        "block_id": "<block_id>",
        "block_type": 1,
        "children": ["<child_block_id>"],
        "page": {
          "elements": [
            {
              "text_run": {
                "content": "示例文本",
                "text_element_style": {
                  "bold": false,
                  "inline_code": false,
                  "italic": false,
                  "strikethrough": false,
                  "underline": false
                }
              }
            }
          ],
          "style": {
            "align": 1
          }
        },
        "parent_id": ""
      }
    ]
  },
  "msg": "success"
}
```

## 5. 创建块

### 请求
```bash
curl -i -X POST 'https://open.feishu.cn/open-apis/docx/v1/documents/<document_id>/blocks/<block_id>/children?document_revision_id=-1' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer <access_token>' \
-d '{
    "children": [
        {
            "block_type": 2,
            "text": {
                "elements": [
                    {
                        "text_run": {
                            "content": "多人实时协同，插入一切元素。不仅是在线文档，更是",
                            "text_element_style": {
                                "bold": false,
                                "inline_code": false,
                                "italic": false,
                                "strikethrough": false,
                                "text_color": 5,
                                "underline": false
                            }
                        }
                    }
                ],
                "style": {
                    "align": 1,
                    "folded": false
                }
            }
        }
    ],
    "index": 0
}'
```

## 6. 添加代码块

### 请求
```bash
curl -i -X POST 'https://open.feishu.cn/open-apis/docx/v1/documents/<document_id>/blocks/<block_id>/children?document_revision_id=-1' \
-H 'Content-Type: application/json' \
-d '{
    "children": [
        {
            "block_type": 14,
            "code": {
                "elements": [
                    {
                        "text_run": {
                            "content": "hello world",
                            "text_element_style": {
                                "bold": false,
                                "inline_code": false,
                                "italic": false,
                                "strikethrough": false,
                                "underline": false
                            }
                        }
                    }
                ],
                "style": {
                    "language": 32,
                    "wrap": false
                }
            }
        }
    ],
    "index": 3
}'
```

> 注：代码块语言类型对照表：
> 1: PlainText, 2: ABAP, 3: Ada, 4: Apache, 5: Apex, 6: Assembly Language, 7: Bash, 8: CSharp, 9: C++, 10: C, 11: COBOL, 12: CSS, 13: CoffeeScript, 14: D, 15: Dart, 16: Delphi, 17: Django, 18: Dockerfile, 19: Erlang, 20: Fortran, 22: Go, 23: Groovy, 24: HTML, 25: HTMLBars, 26: HTTP, 27: Haskell, 28: JSON, 29: Java, 30: JavaScript, 31: Julia, 32: Kotlin, 33: LateX, 34: Lisp, 36: Lua, 37: MATLAB, 38: Makefile, 39: Markdown, 40: Nginx, 41: Objective-C, 43: PHP, 44: Perl, 46: Power Shell, 47: Prolog, 48: ProtoBuf, 49: Python, 50: R, 52: Ruby, 53: Rust, 54: SAS, 55: SCSS, 56: SQL, 57: Scala, 58: Scheme, 60: Shell, 61: Swift, 62: Thrift, 63: TypeScript, 64: VBScript, 65: Visual Basic, 66: XML, 67: YAML, 68: CMake, 69: Diff, 70: Gherkin, 71: GraphQL, 72: OpenGL Shading Language, 73: Properties, 74: Solidity, 75: TOML