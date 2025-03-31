import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FeishuService } from './services/feishu.js';
import express, { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { IncomingMessage, ServerResponse } from 'http';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export const Logger = {
  log: (...args: any[]) => {
    console.log(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
  },
};

// 添加一个工具类方法，用于格式化错误信息
function formatErrorMessage(error: any): string {
  if (error instanceof Error) {
    return error.message;
  } else if (typeof error === 'string') {
    return error;
  } else if (error && typeof error === 'object') {
    try {
      // 处理包含apiError字段的FeishuError对象
      if (error.apiError) {
        const apiError = error.apiError;
        let errorMsg = '';
        
        // 处理标准飞书API错误格式
        if (apiError.code && apiError.msg) {
          errorMsg = `${apiError.msg} (错误码: ${apiError.code})`;
          
          // 添加字段验证错误信息
          if (apiError.error && apiError.error.field_violations && apiError.error.field_violations.length > 0) {
            const violations = apiError.error.field_violations;
            errorMsg += '\n字段验证错误:';
            violations.forEach((violation: any) => {
              let detail = `\n - ${violation.field}`;
              if (violation.description) {
                detail += `: ${violation.description}`;
              }
              if (violation.value) {
                detail += `，提供的值: ${violation.value}`;
              }
              errorMsg += detail;
            });
            
            // 添加排查建议链接
            if (apiError.error.troubleshooter) {
              errorMsg += `\n\n${apiError.error.troubleshooter}`;
            }
          }
          
          return errorMsg;
        }
        
        // 如果apiError没有标准结构，尝试序列化
        return `API错误: ${JSON.stringify(apiError)}`;
      }
      
      // 处理飞书API特定的错误格式
      if (error.code && error.msg) {
        // 基本错误信息
        let errorMsg = `${error.msg} (错误码: ${error.code})`;
        
        // 如果有详细的验证错误信息
        if (error.error && error.error.field_violations && error.error.field_violations.length > 0) {
          const violations = error.error.field_violations;
          errorMsg += '\n字段验证错误:';
          violations.forEach((violation: any) => {
            let detail = `\n - ${violation.field}`;
            if (violation.description) {
              detail += `: ${violation.description}`;
            }
            if (violation.value) {
              detail += `，提供的值: ${violation.value}`;
            }
            errorMsg += detail;
          });
          
          // 添加排查建议链接（如果有）
          if (error.error.troubleshooter) {
            errorMsg += `\n\n${error.error.troubleshooter}`;
          }
        }
        return errorMsg;
      }
      
      // 处理 {status, err} 格式的错误
      if (error.status && error.err) {
        return `操作失败 (状态码: ${error.status}): ${error.err}`;
      }
      
      // 尝试提取API错误信息，通常在错误对象的message或error字段中
      if (error.message) {
        return error.message;
      } else if (error.error) {
        if (typeof error.error === 'string') {
          return error.error;
        } else if (error.error.message) {
          return error.error.message;
        } else if (error.error.field_violations) {
          // 处理错误嵌套在error对象中的情况
          const violations = error.error.field_violations;
          let errorMsg = '字段验证错误:';
          violations.forEach((violation: any) => {
            let detail = `\n - ${violation.field}`;
            if (violation.description) {
              detail += `: ${violation.description}`;
            }
            if (violation.value) {
              detail += `，提供的值: ${violation.value}`;
            }
            errorMsg += detail;
          });
          return errorMsg;
        }
      } else if (error.code || error.status) {
        // 处理HTTP错误或API错误码
        const code = error.code || error.status;
        const msg = error.statusText || error.msg || 'Unknown error';
        return `操作失败 (错误码: ${code}): ${msg}`;
      }
      
      // 如果上述都不符合，尝试将整个对象序列化（但移除敏感信息）
      const safeError = { ...error };
      // 移除可能的敏感信息
      ['token', 'secret', 'password', 'key', 'credentials'].forEach(key => {
        if (key in safeError) delete safeError[key];
      });
      return `发生错误: ${JSON.stringify(safeError)}`;
    } catch (e) {
      console.error("Error formatting error message:", e);
      return '发生未知错误';
    }
  }
  return '发生未知错误';
}

export class FeishuMcpServer {
  private readonly server: McpServer;
  private sseTransport: SSEServerTransport | null = null;
  private readonly feishuService: FeishuService | null = null;

  constructor(feishuConfig: { appId: string; appSecret: string }) {
    // 详细记录飞书配置状态
    Logger.log(
      `飞书配置已提供 - AppID: ${feishuConfig.appId.substring(0, 4)}...${feishuConfig.appId.substring(feishuConfig.appId.length - 4)}, AppSecret: ${feishuConfig.appSecret.substring(0, 4)}...${feishuConfig.appSecret.substring(feishuConfig.appSecret.length - 4)}`,
    );
    try {
      this.feishuService = new FeishuService(
        feishuConfig.appId,
        feishuConfig.appSecret,
      );
      Logger.log('飞书服务初始化成功');
    } catch (error) {
      Logger.error('飞书服务初始化失败:', error);
      throw new Error('飞书服务初始化失败');
    }

    this.server = new McpServer(
      {
        name: 'Feishu MCP Server',
        version: '0.0.1',
      },
      {
        capabilities: {
          logging: {},
          tools: {},
        },
      },
    );

    this.registerTools();
  }

  private registerTools(): void {
    // 添加创建飞书文档工具
    this.server.tool(
      'create_feishu_document',
      'Creates a new Feishu document and returns its information. Use this tool when you need to create a document from scratch with a specific title and folder location.',
      {
        title: z.string().describe('Document title (required). This will be displayed in the Feishu document list and document header.'),
        folderToken: z.string().describe('Folder token (required). Specifies where to create the document. Format is an alphanumeric string like "doxcnOu1ZKYH4RtX1Y5XwL5WGRh".'),
      },
      async ({ title, folderToken }) => {
        try {
          Logger.log(`开始创建飞书文档，标题: ${title}${folderToken ? `，文件夹Token: ${folderToken}` : '，使用默认文件夹'}`);
          const newDoc = await this.feishuService?.createDocument(title, folderToken);
          if (!newDoc) {
            throw new Error('创建文档失败，未返回文档信息');
          }
          Logger.log(`飞书文档创建成功，文档ID: ${newDoc.objToken || newDoc.document_id}`);
          return {
            content: [{ type: 'text', text: JSON.stringify(newDoc, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书文档失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `创建飞书文档失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加获取飞书文档信息工具
    this.server.tool(
      "get_feishu_doc_info",
      "Retrieves basic information about a Feishu document. Use this to verify if a document exists, check access permissions, or get metadata like title, type, and creation information.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf"),
      },
      async ({ documentId }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          Logger.log(`开始获取飞书文档信息，文档ID: ${documentId}`);
          const docInfo = await this.feishuService.getDocumentInfo(documentId);
          Logger.log(`飞书文档信息获取成功，标题: ${docInfo.title}`);

          return {
            content: [{ type: "text", text: JSON.stringify(docInfo, null, 2) }],
          };
        } catch (error) {
          Logger.error(`获取飞书文档信息失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `获取飞书文档信息失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加获取飞书文档内容工具
    this.server.tool(
      'get_feishu_doc_content',
      'Retrieves the plain text content of a Feishu document. Ideal for content analysis, processing, or when you need to extract text without formatting. The content maintains the document structure but without styling.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf'),
        lang: z.number().optional().default(0).describe('Language code (optional). Default is 0 (Chinese). Use 1 for English if available.'),
      },
      async ({ documentId, lang }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: 'Feishu service is not initialized. Please check the configuration' }],
            };
          }

          Logger.log(`开始获取飞书文档内容，文档ID: ${documentId}，语言: ${lang}`);
          const content = await this.feishuService.getDocumentContent(documentId, lang);
          Logger.log(`飞书文档内容获取成功，内容长度: ${content.length}字符`);

          return {
            content: [{ type: 'text', text: content }],
          };
        } catch (error) {
          Logger.error(`获取飞书文档内容失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `获取飞书文档内容失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加获取飞书文档块工具
    this.server.tool(
      'get_feishu_doc_blocks',
      'Retrieves the block structure information of a Feishu document. Essential to use before inserting content to understand document structure and determine correct insertion positions. Returns a detailed hierarchy of blocks with their IDs, types, and content.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf'),
        pageSize: z.number().optional().default(500).describe('Number of blocks per page (optional). Default is 500. Used for paginating large documents. Increase for more blocks at once, decrease for faster response with fewer blocks.'),
      },
      async ({ documentId, pageSize }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: 'Feishu service is not initialized. Please check the configuration' }],
            };
          }

          Logger.log(`开始获取飞书文档块，文档ID: ${documentId}，页大小: ${pageSize}`);
          const blocks = await this.feishuService.getDocumentBlocks(documentId, pageSize);
          Logger.log(`飞书文档块获取成功，共 ${blocks.length} 个块`);

          return {
            content: [{ type: 'text', text: JSON.stringify(blocks, null, 2) }],
          };
        } catch (error) {
          Logger.error(`获取飞书文档块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `获取飞书文档块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加获取块内容工具
    this.server.tool(
      'get_feishu_block_content',
      'Retrieves the detailed content and structure of a specific block in a Feishu document. Useful for inspecting block properties, formatting, and content, especially before making updates or for debugging purposes.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf'),
        blockId: z.string().describe('Block ID (required). The ID of the specific block to get content from. You can obtain block IDs using the get_feishu_doc_blocks tool.'),
      },
      async ({ documentId, blockId }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: '飞书服务未初始化，请检查配置' }],
            };
          }

          Logger.log(`开始获取飞书块内容，文档ID: ${documentId}，块ID: ${blockId}`);
          const blockContent = await this.feishuService.getBlockContent(documentId, blockId);
          Logger.log(`飞书块内容获取成功，块类型: ${blockContent.block_type}`);

          return {
            content: [{ type: 'text', text: JSON.stringify(blockContent, null, 2) }],
          };
        } catch (error) {
          Logger.error(`获取飞书块内容失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `获取飞书块内容失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加更新块文本内容工具
    this.server.tool(
      'update_feishu_block_text',
      'Updates the text content and styling of a specific block in a Feishu document. Can be used to modify content in existing text, code, or heading blocks while preserving the block type and other properties.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf'),
        blockId: z.string().describe('Block ID (required). The ID of the specific block to update content. You can obtain block IDs using the get_feishu_doc_blocks tool.'),
        textElements: z.array(
          z.object({
            text: z.string().describe('Text content. Provide plain text without markdown syntax; use the style object for formatting.'),
            style: z.object({
              bold: z.boolean().optional().describe('Whether to make text bold. Default is false, equivalent to **text** in Markdown.'),
              italic: z.boolean().optional().describe('Whether to make text italic. Default is false, equivalent to *text* in Markdown.'),
              underline: z.boolean().optional().describe('Whether to add underline. Default is false.'),
              strikethrough: z.boolean().optional().describe('Whether to add strikethrough. Default is false, equivalent to ~~text~~ in Markdown.'),
              inline_code: z.boolean().optional().describe('Whether to format as inline code. Default is false, equivalent to `code` in Markdown.'),
              text_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
                message: "Text color must be between 1 and 7 inclusive"
              }).describe('Text color value. Default is 0 (black). Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error.'),
              background_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
                message: "Background color must be between 1 and 7 inclusive"
              }).describe('Background color value. Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error.')
            }).optional().describe('Text style settings. Explicitly set style properties instead of relying on Markdown syntax conversion.')
          })
        ).describe('Array of text content objects. A block can contain multiple text segments with different styles. Example: [{text:"Hello",style:{bold:true}},{text:" World",style:{italic:true}}]'),
      },
      async ({ documentId, blockId, textElements }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: 'text', text: '飞书服务未初始化，请检查配置' }],
            };
          }

          Logger.log(`开始更新飞书块文本内容，文档ID: ${documentId}，块ID: ${blockId}`);
          const result = await this.feishuService.updateBlockTextContent(documentId, blockId, textElements);
          Logger.log(`飞书块文本内容更新成功`);

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`更新飞书块文本内容失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `更新飞书块文本内容失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加通用飞书块创建工具（支持文本、代码、标题）
    this.server.tool(
      'create_feishu_multiple_blocks',
      'Creates multiple blocks of different types (text, code, heading, list) in a single API call and at the same position. Significantly improves efficiency compared to creating individual blocks separately. ONLY use this when you need to insert multiple blocks CONSECUTIVELY at the SAME position. If blocks need to be inserted at different positions, use individual block creation tools instead. NOTE: Due to API limitations, you can create a maximum of 50 blocks in a single call. PREFER THIS TOOL OVER INDIVIDUAL BLOCK CREATION TOOLS when creating multiple consecutive blocks, as it is much more efficient and reduces API calls.',
      {
        documentId: z.string().describe('Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf'),
        parentBlockId: z.string().describe('Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_doc_blocks tool.'),
        startIndex: z.number().describe('Starting insertion position index (required). Specifies where the first block should be inserted. Use 0 to insert at the beginning. Use get_feishu_doc_blocks tool to understand document structure if unsure.'),
        blocks: z.array(
          z.object({
            blockType: z.enum(['text', 'code', 'heading', 'list']).describe("Block type (required): 'text', 'code', 'heading', or 'list'. Choose based on the content type you need to create."),
            options: z.union([
              z.object({
                text: z.object({
                  textStyles: z.array(
                    z.object({
                      text: z.string().describe('Text segment content. The actual text to display.'),
                      style: z.object({
                        bold: z.boolean().optional().describe('Whether to make text bold. Default is false, equivalent to **text** in Markdown.'),
                        italic: z.boolean().optional().describe('Whether to make text italic. Default is false, equivalent to *text* in Markdown.'),
                        underline: z.boolean().optional().describe('Whether to add underline. Default is false.'),
                        strikethrough: z.boolean().optional().describe('Whether to add strikethrough. Default is false, equivalent to ~~text~~ in Markdown.'),
                        inline_code: z.boolean().optional().describe('Whether to format as inline code. Default is false, equivalent to `code` in Markdown.'),
                        text_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
                          message: "Text color must be between 1 and 7 inclusive"
                        }).describe('Text color value. Default is 0 (black). Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error.'),
                        background_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
                          message: "Background color must be between 1 and 7 inclusive"
                        }).describe('Background color value. Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error.')
                      }).optional().describe('Text style settings. Explicitly set style properties instead of relying on Markdown syntax conversion.'),
                    })
                  ).describe('Array of text content objects with styles. A block can contain multiple text segments with different styles. Example: [{text:"Hello",style:{bold:true}},{text:" World",style:{italic:true}}]'),
                  align: z.number().optional().default(1).describe('Text alignment: 1 for left (default), 2 for center, 3 for right.'),
                }).describe("Text block options. Only used when blockType is 'text'."),
              }),
              z.object({
                code: z.object({
                  code: z.string().describe('Code content. The complete code text to display.'),
                  language: z.number().optional().default(0).describe('Programming language code. Default is 0 (auto-detect). See documentation for full list of language codes.'),
                  wrap: z.boolean().optional().default(false).describe('Whether to enable automatic line wrapping. Default is false.'),
                }).describe("Code block options. Only used when blockType is 'code'."),
              }),
              z.object({
                heading: z.object({
                  level: z.number().min(1).max(9).describe('Heading level from 1 to 9, where 1 is the largest (h1) and 9 is the smallest (h9).'),
                  content: z.string().describe('Heading text content. The actual text of the heading.'),
                  align: z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
                    message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
                  }).describe('Text alignment: 1 for left (default), 2 for center, 3 for right. Only these three values are allowed.'),
                }).describe("Heading block options. Only used when blockType is 'heading'."),
              }),
              z.object({
                list: z.object({
                  content: z.string().describe('List item content. The actual text of the list item.'),
                  isOrdered: z.boolean().optional().default(false).describe('Whether this is an ordered (numbered) list item. Default is false (bullet point/unordered).'),
                  align: z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
                    message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
                  }).describe('Text alignment: 1 for left (default), 2 for center, 3 for right. Only these three values are allowed.'),
                }).describe("List block options. Only used when blockType is 'list'."),
              }),
            ]).describe('Options for the specific block type. Must provide the corresponding options object based on blockType.'),
          })
        ).max(50).describe('Array of block configurations (required). Each element contains blockType and options properties. Example: [{blockType:"text",options:{text:{textStyles:[{text:"Hello",style:{bold:true}}]}}},{blockType:"code",options:{code:{code:"console.log(\'Hello\')",language:30}}}]. Maximum 50 blocks per call.'),
      },
      async ({ documentId, parentBlockId, startIndex = 0, blocks }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Feishu service is not initialized. Please check the configuration',
                },
              ],
            };
          }

          if (blocks.length > 50) {
            return {
              content: [{ 
                type: 'text', 
                text: '错误: 每次调用最多只能创建50个块。请分批次创建或减少块数量。' 
              }],
            };
          }

          Logger.log(
            `开始批量创建飞书块，文档ID: ${documentId}，父块ID: ${parentBlockId}，块数量: ${blocks.length}，起始插入位置: ${startIndex}`);

          // 准备要创建的块内容数组
          const blockContents = [];

          // 处理每个块配置
          for (const blockConfig of blocks) {
            const { blockType, options = {} } = blockConfig;
            // 使用指定的索引或当前索引
            let blockContent;

            switch (blockType) {
              case 'text':
                // 处理文本块
              {
                // 类型检查，确保options包含text属性
                if ('text' in options && options.text) {
                  const textOptions = options.text as {
                    textStyles?: Array<{ text: string; style?: Record<string, any> }>;
                    align?: number;
                  };
                  const textStyles = textOptions.textStyles || [];
                  if (textStyles.length === 0) {
                    textStyles.push({ text: '', style: {} });
                  }
                  const align = textOptions.align || 1;
                  blockContent = this.feishuService.createTextBlockContent(textStyles, align);
                }
                break;
              }

              case 'code':
                // 处理代码块
              {
                // 类型检查，确保options包含code属性
                if ('code' in options && options.code) {
                  const codeOptions = options.code as {
                    code?: string;
                    language?: number;
                    wrap?: boolean;
                  };
                  const codeContent = codeOptions.code || '';
                  const language = codeOptions.language || 0;
                  const wrap = codeOptions.wrap || false;
                  blockContent = this.feishuService.createCodeBlockContent(codeContent, language, wrap);
                }
                break;
              }

              case 'heading':
                // 处理标题块
              {
                // 类型检查，确保options包含heading属性
                if ('heading' in options && options.heading) {
                  const headingOptions = options.heading as {
                    content?: string;
                    level?: number;
                    align?: number;
                  };
                  if (headingOptions.content) {
                    const headingContent = headingOptions.content;
                    const level = headingOptions.level || 1;
                    // 确保对齐方式值在合法范围内
                    const headingAlign = (headingOptions.align === 1 || headingOptions.align === 2 || headingOptions.align === 3) 
                      ? headingOptions.align : 1;
                    blockContent = this.feishuService.createHeadingBlockContent(headingContent, level, headingAlign);
                  }
                }
                break;
              }

              case 'list':
                // 处理列表块
              {
                // 类型检查，确保options包含list属性
                if ('list' in options && options.list) {
                  const listOptions = options.list as {
                    content?: string;
                    isOrdered?: boolean;
                    align?: number;
                  };
                  if (listOptions.content) {
                    const content = listOptions.content;
                    const isOrdered = listOptions.isOrdered || false;
                    // 确保对齐方式值在合法范围内
                    const align = (listOptions.align === 1 || listOptions.align === 2 || listOptions.align === 3)
                      ? listOptions.align : 1;
                    blockContent = this.feishuService.createListBlockContent(content, isOrdered, align);
                  }
                }
                break;
              }
            }

            if (blockContent) {
              blockContents.push(blockContent);
              Logger.log(`已准备${blockType}块，内容: ${JSON.stringify(blockContent).substring(0, 100)}...`);
            }
          }

          // 批量创建所有块
          const result = await this.feishuService.createDocumentBlocks(documentId, parentBlockId, blockContents, startIndex);
          Logger.log(`飞书块批量创建成功，共创建 ${blockContents.length} 个块`);

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`批量创建飞书块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: 'text', text: `批量创建飞书块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加创建飞书文本块工具
    this.server.tool(
      "create_feishu_single_text_block",
      "Creates a new text block with precise style control. Unlike markdown-based formatting, this tool lets you explicitly set text styles for each text segment. Ideal for formatted documents where exact styling control is needed.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf"),
        parentBlockId: z.string().describe("Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_doc_blocks tool."),
        textContents: z.array(
          z.object({
            text: z.string().describe("Text content. Provide plain text without markdown syntax; use style object for formatting."),
            style: z.object({
              bold: z.boolean().optional().describe("Whether to make text bold. Default is false, equivalent to **text** in Markdown."),
              italic: z.boolean().optional().describe("Whether to make text italic. Default is false, equivalent to *text* in Markdown."),
              underline: z.boolean().optional().describe("Whether to add underline. Default is false."),
              strikethrough: z.boolean().optional().describe("Whether to add strikethrough. Default is false, equivalent to ~~text~~ in Markdown."),
              inline_code: z.boolean().optional().describe("Whether to format as inline code. Default is false, equivalent to `code` in Markdown."),
              text_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
                message: "Text color must be between 1 and 7 inclusive"
              }).describe("Text color value. Default is 0 (black). Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error."),
              background_color: z.number().optional().refine(val => !val || (val >= 1 && val <= 7), {
                message: "Background color must be between 1 and 7 inclusive"
              }).describe('Background color value. Available values are only: 1 (gray), 2 (brown), 3 (orange), 4 (yellow), 5 (green), 6 (blue), 7 (purple). Values outside this range will cause an error.')
            }).optional().describe("Text style settings. Explicitly set style properties instead of relying on Markdown syntax conversion.")
          })
        ).describe("Array of text content objects. A block can contain multiple text segments with different styles. Example: [{text:'Hello',style:{bold:true}},{text:' World',style:{italic:true}}]"),
        align: z.number().optional().default(1).describe("Text alignment: 1 for left (default), 2 for center, 3 for right."),
        index: z.number().describe("Insertion position index (required). Specifies where the block should be inserted. Use 0 to insert at the beginning. Use get_feishu_doc_blocks tool to understand document structure if unsure. For consecutive insertions, calculate next index as previous index + 1.")
      },
      async ({ documentId, parentBlockId, textContents, align = 1, index }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          Logger.log(`开始创建飞书文本块，文档ID: ${documentId}，父块ID: ${parentBlockId}，对齐方式: ${align}，插入位置: ${index}`);
          const result = await this.feishuService.createTextBlock(documentId, parentBlockId, textContents, align, index);
          Logger.log(`飞书文本块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书文本块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `创建飞书文本块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加创建飞书代码块工具
    this.server.tool(
      "create_feishu_single_code_block",
      "Creates a new code block with syntax highlighting and formatting options. Ideal for technical documentation, tutorials, or displaying code examples with proper formatting and language-specific highlighting.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf"),
        parentBlockId: z.string().describe("Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_doc_blocks tool."),
        code: z.string().describe("Code content (required). The complete code text to display."),
        language: z.number().optional().default(0).describe("Programming language code (optional). Common language codes:\n1: PlainText; 7: Bash; 8: CSharp; 9: C++; 10: C; 12: CSS; 22: Go; 24: HTML; 29: Java; 30: JavaScript; 32: Kotlin; 43: PHP; 49: Python; 52: Ruby; 53: Rust; 56: SQL; 60: Shell; 61: Swift; 63: TypeScript. Default is 0 (auto-detect)."),
        wrap: z.boolean().optional().default(false).describe("Enable automatic line wrapping (optional). Default is false (no auto-wrap). Set to true to improve readability for long code lines."),
        index: z.number().describe("Insertion position index (required). Specifies where the block should be inserted. Use 0 to insert at the beginning. Use get_feishu_doc_blocks tool to understand document structure if unsure. For consecutive insertions, calculate next index as previous index + 1.")
      },
      async ({ documentId, parentBlockId, code, language = 0, wrap = false, index = 0 }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          Logger.log(`开始创建飞书代码块，文档ID: ${documentId}，父块ID: ${parentBlockId}，语言: ${language}，自动换行: ${wrap}，插入位置: ${index}`);
          const result = await this.feishuService.createCodeBlock(documentId, parentBlockId, code, language, wrap, index);
          Logger.log(`飞书代码块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书代码块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `创建飞书代码块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加创建飞书标题块工具
    this.server.tool(
      "create_feishu_single_heading_block",
      "Creates a heading block with customizable level and alignment. Use this tool to add section titles, chapter headings, or any hierarchical structure elements to your document. Supports nine heading levels for different emphasis needs.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf"),
        parentBlockId: z.string().describe("Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_doc_blocks tool."),
        level: z.number().min(1).max(9).describe("Heading level (required). Integer between 1 and 9, where 1 is the largest heading (h1) and 9 is the smallest (h9)."),
        content: z.string().describe("Heading text content (required). The actual text of the heading."),
        align: z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
          message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
        }).describe("Text alignment (optional): 1 for left (default), 2 for center, 3 for right. Only these three values are allowed."),
        index: z.number().describe("Insertion position index (required). Specifies where the block should be inserted. Use 0 to insert at the beginning. Use get_feishu_doc_blocks tool to understand document structure if unsure. For consecutive insertions, calculate next index as previous index + 1.")
      },
      async ({ documentId, parentBlockId, level, content, align = 1, index = 0 }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          // 确保align值在合法范围内（1-3）
          if (align !== 1 && align !== 2 && align !== 3) {
            return {
              content: [{ type: "text", text: "错误: 对齐方式(align)参数必须是1(居左)、2(居中)或3(居右)中的一个值。" }],
            };
          }

          Logger.log(`开始创建飞书标题块，文档ID: ${documentId}，父块ID: ${parentBlockId}，标题级别: ${level}，对齐方式: ${align}，插入位置: ${index}`);
          const result = await this.feishuService.createHeadingBlock(documentId, parentBlockId, content, level, index, align);
          Logger.log(`飞书标题块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书标题块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `创建飞书标题块失败: ${errorMessage}` }],
          };
        }
      },
    );

    // 添加创建飞书列表块工具
    this.server.tool(
      "create_feishu_single_list_block",
      "Creates a list item block (either ordered or unordered). Perfect for creating hierarchical and structured content with bullet points or numbered lists.",
      {
        documentId: z.string().describe("Document ID or URL (required). Supports the following formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID: e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf"),
        parentBlockId: z.string().describe("Parent block ID (required). Target block ID where content will be added, without any URL prefix. For page-level (root level) insertion, extract and use only the document ID portion (not the full URL) as parentBlockId. Obtain existing block IDs using the get_feishu_doc_blocks tool."),
        content: z.string().describe("List item content (required). The actual text of the list item."),
        isOrdered: z.boolean().optional().default(false).describe("Whether this is an ordered (numbered) list item. Default is false (bullet point/unordered)."),
        align: z.number().optional().default(1).refine(val => val === 1 || val === 2 || val === 3, {
          message: "Alignment must be one of: 1 (left), 2 (center), or 3 (right)"
        }).describe("Text alignment (optional): 1 for left (default), 2 for center, 3 for right. Only these three values are allowed."),
        index: z.number().describe("Insertion position index (required). Specifies where the block should be inserted. Use 0 to insert at the beginning. Use get_feishu_doc_blocks tool to understand document structure if unsure. For consecutive insertions, calculate next index as previous index + 1.")
      },
      async ({ documentId, parentBlockId, content, isOrdered = false, align = 1, index = 0 }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          // 确保align值在合法范围内（1-3）
          if (align !== 1 && align !== 2 && align !== 3) {
            return {
              content: [{ type: "text", text: "错误: 对齐方式(align)参数必须是1(居左)、2(居中)或3(居右)中的一个值。" }],
            };
          }

          const listType = isOrdered ? "有序" : "无序";
          Logger.log(`开始创建飞书${listType}列表块，文档ID: ${documentId}，父块ID: ${parentBlockId}，对齐方式: ${align}，插入位置: ${index}`);
          const result = await this.feishuService.createListBlock(documentId, parentBlockId, content, isOrdered, index, align);
          Logger.log(`飞书${listType}列表块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书列表块失败:`, error);
          const errorMessage = formatErrorMessage(error);
          return {
            content: [{ type: "text", text: `创建飞书列表块失败: ${errorMessage}` }],
          };
        }
      },
    );
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);

    Logger.log = (...args: any[]) => {
      this.server.server.sendLoggingMessage({ level: 'info', data: args });
    };
    Logger.error = (...args: any[]) => {
      this.server.server.sendLoggingMessage({ level: 'error', data: args });
    };

    Logger.log('Server connected and ready to process requests');
  }

  async startHttpServer(port: number): Promise<void> {
    const app = express();

    app.get('/sse', async (_req: Request, res: Response) => {
      console.log('New SSE connection established');
      this.sseTransport = new SSEServerTransport('/messages', res as unknown as ServerResponse<IncomingMessage>);
      await this.server.connect(this.sseTransport);
    });

    app.post('/messages', async (req: Request, res: Response) => {
      if (!this.sseTransport) {
        res.sendStatus(400);
        return;
      }
      await this.sseTransport.handlePostMessage(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse<IncomingMessage>
      );
    });

    Logger.log = console.log;
    Logger.error = console.error;

    app.listen(port, () => {
      Logger.log(`HTTP server listening on port ${port}`);
      Logger.log(`SSE endpoint available at http://localhost:${port}/sse`);
      Logger.log(`Message endpoint available at http://localhost:${port}/messages`);
    });
  }
}
