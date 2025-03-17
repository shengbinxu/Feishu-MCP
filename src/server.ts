import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FeishuService } from "./services/feishu.js";
import express, { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingMessage, ServerResponse } from "http";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export const Logger = {
  log: (...args: any[]) => { console.log(...args); },
  error: (...args: any[]) => { console.error(...args); },
};

export class FeishuMcpServer {
  private readonly server: McpServer;
  private sseTransport: SSEServerTransport | null = null;
  private readonly feishuService: FeishuService | null = null;

  constructor(feishuConfig: { appId: string; appSecret: string }) {
    // 详细记录飞书配置状态
    Logger.log(`飞书配置已提供 - AppID: ${feishuConfig.appId.substring(0, 4)}...${feishuConfig.appId.substring(feishuConfig.appId.length - 4)}, AppSecret: ${feishuConfig.appSecret.substring(0, 4)}...${feishuConfig.appSecret.substring(feishuConfig.appSecret.length - 4)}`);
    try {
      this.feishuService = new FeishuService(feishuConfig.appId, feishuConfig.appSecret);
      Logger.log('飞书服务初始化成功');
    } catch (error) {
      Logger.error('飞书服务初始化失败:', error);
      throw new Error('飞书服务初始化失败');
    }
    
    this.server = new McpServer(
      {
        name: "Feishu MCP Server",
        version: "0.0.1",
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
      "create_feishu_doc",
      "Create a new Feishu document",
      {
        title: z.string().describe("Document title"),
        folderToken: z.string().optional().describe("Folder token where the document will be created. If not provided, the document will be created in the root directory"),
      },
      async ({ title, folderToken }) => {
        try {
          Logger.log(`开始创建飞书文档，标题: ${title}${folderToken ? `，文件夹Token: ${folderToken}` : ''}`);
          // @ts-ignore
          const newDoc = await this.feishuService.createDocument(title, folderToken);
          Logger.log(`飞书文档创建成功，文档ID: ${newDoc?.objToken || newDoc?.document_id}`);
          return {
            content: [{ type: "text", text: JSON.stringify(newDoc, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书文档失败:`, error);
          return {
            content: [{ type: "text", text: `创建飞书文档失败: ${error}` }],
          };
        }
      },
    );

    // 添加获取飞书文档信息工具
    // this.server.tool(
    //   "get_feishu_doc_info",
    //   "Get basic information about a Feishu document",
    //   {
    //     documentId: z.string().describe("Document ID or URL. Supported formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID (e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf)"),
    //   },
    //   async ({ documentId }) => {
    //     try {
    //       if (!this.feishuService) {
    //         return {
    //           content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
    //         };
    //       }

    //       Logger.log(`开始获取飞书文档信息，文档ID: ${documentId}`);
    //       const docInfo = await this.feishuService.getDocumentInfo(documentId);
    //       Logger.log(`飞书文档信息获取成功，标题: ${docInfo.title}`);

    //       return {
    //         content: [{ type: "text", text: JSON.stringify(docInfo, null, 2) }],
    //       };
    //     } catch (error) {
    //       Logger.error(`获取飞书文档信息失败:`, error);
    //       return {
    //         content: [{ type: "text", text: `获取飞书文档信息失败: ${error}` }],
    //       };
    //     }
    //   },
    // );

    // 添加获取飞书文档内容工具
    this.server.tool(
      "get_feishu_doc_content",
      "Get the plain text content of a Feishu document",
      {
        documentId: z.string().describe("Document ID or URL. Supported formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID (e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf)"),
        lang: z.number().optional().default(0).describe("Language code. Default is 0 (Chinese)"),
      },
      async ({ documentId, lang }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          Logger.log(`开始获取飞书文档内容，文档ID: ${documentId}，语言: ${lang}`);
          const content = await this.feishuService.getDocumentContent(documentId, lang);
          Logger.log(`飞书文档内容获取成功，内容长度: ${content.length}字符`);

          return {
            content: [{ type: "text", text: content }],
          };
        } catch (error) {
          Logger.error(`获取飞书文档内容失败:`, error);
          return {
            content: [{ type: "text", text: `获取飞书文档内容失败: ${error}` }],
          };
        }
      },
    );

    // 添加获取飞书文档块工具
    this.server.tool(
      "get_feishu_doc_blocks",
      "When document structure is needed, obtain the block information about the Feishu document for content analysis or block insertion",
      {
        documentId: z.string().describe("Document ID or URL. Supported formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID (e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf)"),
        pageSize: z.number().optional().default(500).describe("Number of blocks per page. Default is 500"),
      },
      async ({ documentId, pageSize }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          Logger.log(`开始获取飞书文档块，文档ID: ${documentId}，页大小: ${pageSize}`);
          const blocks = await this.feishuService.getDocumentBlocks(documentId, pageSize);
          Logger.log(`飞书文档块获取成功，共 ${blocks.length} 个块`);

          return {
            content: [{ type: "text", text: JSON.stringify(blocks, null, 2) }],
          };
        } catch (error) {
          Logger.error(`获取飞书文档块失败:`, error);
          return {
            content: [{ type: "text", text: `获取飞书文档块失败: ${error}` }],
          };
        }
      },
    );

    // 添加创建飞书文档块工具
    this.server.tool(
      "create_feishu_text_block",
      "Create a new text block in a Feishu document (AI will automatically convert Markdown syntax to corresponding style attributes: **bold** → bold:true, *italic* → italic:true, ~~strikethrough~~ → strikethrough:true, `code` → inline_code:true)",
      {
        documentId: z.string().describe("Document ID or URL. Supported formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID (e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf)"),
        parentBlockId: z.string().describe("Parent block ID (NOT URL) where the new block will be added as a child. This should be the raw block ID without any URL prefix. When adding blocks at the page level (root level), use the extracted document ID from documentId parameter"),
        textContents: z.array(
          z.object({
            text: z.string().describe("Text content"),
            style: z.object({
              bold: z.boolean().optional().describe("Whether to make text bold. Default is false"),
              italic: z.boolean().optional().describe("Whether to make text italic. Default is false"),
              underline: z.boolean().optional().describe("Whether to add underline. Default is false"),
              strikethrough: z.boolean().optional().describe("Whether to add strikethrough. Default is false"),
              inline_code: z.boolean().optional().describe("Whether to format as inline code. Default is false"),
              text_color: z.number().optional().describe("Text color as a number. Default is 0")
            }).optional().describe("Text style settings")
          })
        ).describe("Array of text content objects. A block can contain multiple text segments with different styles"),
        align: z.number().optional().default(1).describe("Text alignment: 1 for left, 2 for center, 3 for right. Default is 1"),
        index: z.number().optional().default(0).describe("Insertion position index. Default is 0 (insert at the beginning). If unsure about the position, use the get_feishu_doc_blocks tool first to understand the document structure. For consecutive insertions, calculate the next position as previous_index + 1 to avoid querying document structure repeatedly")
      },
      async ({ documentId, parentBlockId, textContents, align = 1, index }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          // 处理Markdown语法转换
          const processedTextContents = textContents.map(content => {
            let { text, style = {} } = content;

            // 创建一个新的style对象，避免修改原始对象
            const newStyle = { ...style };

            // 处理粗体 **text**
            if (text.match(/\*\*([^*]+)\*\*/g)) {
              text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
              newStyle.bold = true;
            }

            // 处理斜体 *text*
            if (text.match(/(?<!\*)\*([^*]+)\*(?!\*)/g)) {
              text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");
              newStyle.italic = true;
            }

            // 处理删除线 ~~text~~
            if (text.match(/~~([^~]+)~~/g)) {
              text = text.replace(/~~([^~]+)~~/g, "$1");
              newStyle.strikethrough = true;
            }

            // 处理行内代码 `code`
            if (text.match(/`([^`]+)`/g)) {
              text = text.replace(/`([^`]+)`/g, "$1");
              newStyle.inline_code = true;
            }

            return { text, style: newStyle };
          });

          Logger.log(`开始创建飞书文本块，文档ID: ${documentId}，父块ID: ${parentBlockId}，对齐方式: ${align}，插入位置: ${index}`);
          const result = await this.feishuService.createTextBlock(documentId, parentBlockId, processedTextContents, align, index);
          Logger.log(`飞书文本块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书文本块失败:`, error);
          return {
            content: [{ type: "text", text: `创建飞书文本块失败: ${error}` }],
          };
        }
      },
    );


    // 添加创建飞书代码块工具
    this.server.tool(
      "create_feishu_code_block",
      "Create a new code block in a Feishu document",
      {
        documentId: z.string().describe("Document ID or URL. Supported formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID (e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf)"),
        parentBlockId: z.string().describe("Parent block ID (NOT URL) where the new block will be added as a child. This should be the raw block ID without any URL prefix. When adding blocks at the page level (root level), use the extracted document ID from documentId parameter"),
        code: z.string().describe("Code content"),
        language: z.number().optional().default(0).describe("Programming language code as a number. Examples: 1: PlainText; 7: Bash; 8: CSharp; 9: C++; 10: C; 12: CSS; 22: Go; 24: HTML; 29: Java; 30: JavaScript; 32: Kotlin; 43: PHP; 49: Python; 52: Ruby; 53: Rust; 56: SQL; 60: Shell; 61: Swift; 63: TypeScript. Default is 0"),
        wrap: z.boolean().optional().default(false).describe("Whether to enable automatic line wrapping. Default is false"),
        index: z.number().optional().default(0).describe("Insertion position index. Default is 0 (insert at the beginning). If unsure about the position, use the get_feishu_doc_blocks tool first to understand the document structure. For consecutive insertions, calculate the next position as previous_index + 1 to avoid querying document structure repeatedly")
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
          return {
            content: [{ type: "text", text: `创建飞书代码块失败: ${error}` }],
          };
        }
      },
    );

    // 添加创建飞书标题块工具
    this.server.tool(
      "create_feishu_heading_block",
      "Create a heading block in a Feishu document with specified level (1-9)",
      {
        documentId: z.string().describe("Document ID or URL. Supported formats:\n1. Standard document URL: https://xxx.feishu.cn/docs/xxx or https://xxx.feishu.cn/docx/xxx\n2. API URL: https://open.feishu.cn/open-apis/doc/v2/documents/xxx\n3. Direct document ID (e.g., JcKbdlokYoPIe0xDzJ1cduRXnRf)"),
        parentBlockId: z.string().describe("Parent block ID (NOT URL) where the new block will be added as a child. This should be the raw block ID without any URL prefix. When adding blocks at the page level (root level), use the extracted document ID from documentId parameter"),
        level: z.number().min(1).max(9).describe("Heading level from 1 to 9, where 1 is the largest heading (h1) and 9 is the smallest (h9)"),
        content: z.string().describe("Heading text content"),
        index: z.number().optional().default(0).describe("Insertion position index. Default is 0 (insert at the beginning). If unsure about the position, use the get_feishu_doc_blocks tool first to understand the document structure. For consecutive insertions, calculate the next position as previous_index + 1 to avoid querying document structure repeatedly")
      },
      async ({ documentId, parentBlockId, level, content, index = 0 }) => {
        try {
          if (!this.feishuService) {
            return {
              content: [{ type: "text", text: "Feishu service is not initialized. Please check the configuration" }],
            };
          }

          Logger.log(`开始创建飞书标题块，文档ID: ${documentId}，父块ID: ${parentBlockId}，标题级别: ${level}，插入位置: ${index}`);
          const result = await this.feishuService.createHeadingBlock(documentId, parentBlockId, content, level, index);
          Logger.log(`飞书标题块创建成功`);

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          Logger.error(`创建飞书标题块失败:`, error);
          return {
            content: [{ type: "text", text: `创建飞书标题块失败: ${error}` }],
          };
        }
      },
    );
  }

  async connect(transport: Transport): Promise<void> {
    // Logger.log("Connecting to transport...");
    await this.server.connect(transport);

    Logger.log = (...args: any[]) => {
      this.server.server.sendLoggingMessage({
        level: "info",
        data: args,
      });
    };
    Logger.error = (...args: any[]) => {
      this.server.server.sendLoggingMessage({
        level: "error",
        data: args,
      });
    };

    Logger.log("Server connected and ready to process requests");
  }

  async startHttpServer(port: number): Promise<void> {
    const app = express();

    app.get("/sse", async (_req: Request, res: Response) => {
      console.log("New SSE connection established");
      this.sseTransport = new SSEServerTransport(
        "/messages",
        res as unknown as ServerResponse<IncomingMessage>,
      );
      await this.server.connect(this.sseTransport);
    });

    app.post("/messages", async (req: Request, res: Response) => {
      if (!this.sseTransport) {
        res.sendStatus(400);
        return;
      }
      await this.sseTransport.handlePostMessage(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse<IncomingMessage>,
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