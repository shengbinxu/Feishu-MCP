# 飞书 MCP 服务实现分享

## 1. MCP 协议简介

MCP（Model Context Protocol）是一种用于AI模型与外部系统交互的协议，它允许AI模型（如Cursor、Windsurf、Cline等）能够访问和操作外部系统的数据，从而提供更智能、更精准的服务。

### 1.1 MCP 的核心理念

- **上下文扩展**：允许AI模型获取更多的上下文信息，超越用户输入的限制
- **工具调用**：使AI模型能够通过定义好的接口调用外部系统的功能
- **双向通信**：在AI模型和外部系统之间建立双向通信通道

### 1.2 MCP 的优势

- 提高AI模型的理解准确性
- 减少用户手动复制粘贴的需求
- 简化复杂任务的处理流程
- 保护敏感信息，只提供必要的数据

## 2. 飞书 MCP 服务器架构

### 2.1 整体架构

飞书 MCP 服务器是基于 MCP 协议实现的一个中间层服务，它连接了AI编码工具（如Cursor）和飞书文档系统，使AI工具能够直接访问和操作飞书文档。

```
+----------------+       +------------------+       +----------------+
|                |       |                  |       |                |
|  AI编码工具     | <===> |  飞书 MCP 服务器  | <===> |  飞书API       |
| (Cursor等)     |       |                  |       |                |
+----------------+       +------------------+       +----------------+
```

### 2.2 核心组件

- **McpServer**：基于@modelcontextprotocol/sdk实现的MCP服务器核心
- **FeishuService**：负责与飞书API交互的服务层
- **Transport层**：支持多种通信方式（HTTP/SSE和标准输入输出）

## 3. 技术实现细节

### 3.1 服务器初始化流程

1. 加载环境配置（.env文件和命令行参数）
2. 初始化飞书服务（FeishuService）
3. 创建MCP服务器实例（FeishuMcpServer）
4. 注册工具函数（Tools）
5. 根据运行模式选择通信方式（HTTP或标准输入输出）

```typescript
// 服务器启动流程示例
export async function startServer(): Promise<void> {
  // 检查是否为标准输入输出模式
  const isStdioMode = process.env.NODE_ENV === "cli" || process.argv.includes("--stdio");

  // 获取服务器配置
  const config = getServerConfig(isStdioMode);

  // 创建飞书配置对象
  const feishuConfig = {
    appId: config.feishuAppId!,
    appSecret: config.feishuAppSecret!
  };

  // 创建MCP服务器实例
  const server = new FeishuMcpServer(feishuConfig);

  // 根据模式选择通信方式
  if (isStdioMode) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    await server.startHttpServer(config.port);
  }
}
```

### 3.2 飞书API交互

飞书MCP服务器通过FeishuService与飞书API进行交互，主要功能包括：

1. **认证管理**：获取和刷新飞书访问令牌
2. **文档操作**：创建、读取和修改飞书文档
3. **文档块操作**：获取和创建文档块（文本块、代码块等）

```typescript
// 飞书服务示例代码
export class FeishuService {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl = "https://open.feishu.cn/open-apis";
  private accessToken: string | null = null;
  private tokenExpireTime: number | null = null;

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
  }

  // 获取访问令牌
  private async getAccessToken(): Promise<string> {
    // 检查令牌是否过期
    if (this.accessToken && !this.isTokenExpired()) {
      return this.accessToken;
    }

    // 获取新的访问令牌
    const response = await axios.post(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      app_id: this.appId,
      app_secret: this.appSecret,
    });

    this.accessToken = response.data.tenant_access_token;
    this.tokenExpireTime = Date.now() + response.data.expire * 1000;
    return this.accessToken;
  }

  // 其他API方法...
}
```

### 3.3 MCP工具实现

飞书MCP服务器通过注册一系列工具函数，使AI模型能够执行特定的操作：

1. **创建文档**：`create_feishu_doc`
2. **获取文档内容**：`get_feishu_doc_content`
3. **获取文档块**：`get_feishu_doc_blocks`
4. **创建文本块**：`create_feishu_text_block`
5. **创建代码块**：`create_feishu_code_block`

```typescript
// 工具注册示例
private registerTools(): void {
  // 添加创建飞书文档工具
  this.server.tool(
    "create_feishu_doc",
    "Create a new Feishu document",
    {
      title: z.string().describe("Document title"),
      folderToken: z.string().optional().describe("Folder token where the document will be created")
    },
    async ({ title, folderToken }) => {
      try {
        const newDoc = await this.feishuService.createDocument(title, folderToken);
        return {
          content: [{ type: "text", text: JSON.stringify(newDoc, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `创建飞书文档失败: ${error}` }],
        };
      }
    }
  );

  // 其他工具注册...
}
```

### 3.4 通信协议实现

飞书MCP服务器支持两种通信方式：

1. **HTTP/SSE模式**：通过HTTP服务器和Server-Sent Events实现与AI工具的通信
2. **标准输入输出模式**：通过进程的标准输入和输出流实现通信，适用于CLI环境

```typescript
// HTTP服务器启动代码
async startHttpServer(port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/", (_req: Request, res: Response) => {
    res.send("Feishu MCP Server is running");
  });

  app.get("/mcp", (req: IncomingMessage, res: ServerResponse) => {
    this.sseTransport = new SSEServerTransport();
    this.sseTransport.handleRequest(req, res);
    this.server.connect(this.sseTransport);
  });

  app.listen(port, () => {
    console.log(`Feishu MCP Server is running on port ${port}`);
  });
}
```

## 4. 工作流程

### 4.1 用户使用流程

1. 在Cursor的Agent模式下打开编辑器
2. 粘贴飞书文档的链接
3. 要求Cursor基于飞书文档执行操作（分析内容、创建代码等）
4. Cursor通过MCP服务器从飞书获取文档内容
5. Cursor使用获取的内容辅助编写代码

### 4.2 数据流转过程

```
+----------------+                  +------------------+                  +----------------+
|                |  1.请求文档内容   |                  |  2.API认证请求   |                |
|  Cursor        | ---------------> |  飞书 MCP 服务器  | ---------------> |  飞书API       |
|                |                  |                  |                  |                |
|                |  4.返回处理后的   |                  |  3.返回原始数据   |                |
|                | <--------------- |                  | <--------------- |                |
+----------------+     文档内容     +------------------+                  +----------------+
```

## 5. 优化与特性

### 5.1 数据优化

飞书MCP服务器在处理飞书API返回的数据时，会进行以下优化：

- **数据简化**：移除不必要的元数据，减少传输给AI模型的数据量
- **格式转换**：将复杂的API响应转换为更易于AI模型理解的格式
- **内容提取**：从文档块中提取关键内容，忽略样式等次要信息

### 5.2 特色功能

- **Markdown语法支持**：自动将Markdown语法转换为飞书文档的样式属性
- **文档块管理**：精细化控制文档结构，支持在特定位置插入内容
- **多种认证方式**：支持通过环境变量和命令行参数配置认证信息

## 6. 部署与配置

### 6.1 环境要求

- Node.js v20.17.0或更高版本
- 飞书开放平台应用（需要获取AppID和AppSecret）

### 6.2 配置方式

1. **环境变量配置**：通过.env文件设置
   ```
   PORT=3000
   FEISHU_APP_ID=your_app_id
   FEISHU_APP_SECRET=your_app_secret
   ```

2. **命令行参数配置**：
   ```bash
   feishu-mcp --port 3000 --feishu-app-id your_app_id --feishu-app-secret your_app_secret
   ```

### 6.3 启动方式

1. **HTTP模式**：
   ```bash
   npm start
   # 或
   npm run start:http
   ```

2. **CLI模式**：
   ```bash
   npm run start:cli
   ```

## 7. 应用场景

### 7.1 开发场景

- **需求分析**：AI工具可以直接读取飞书文档中的需求说明，进行分析并生成代码
- **文档生成**：根据代码自动生成技术文档并保存到飞书
- **代码审查**：将代码审查意见直接写入飞书文档

### 7.2 协作场景

- **团队协作**：多人共同编辑的飞书文档可以被AI工具实时访问
- **知识库集成**：将团队知识库与AI编码工具连接，提高开发效率

## 8. 未来展望

- **支持更多飞书文档类型**：表格、思维导图等
- **双向实时同步**：AI工具的输出可以实时同步到飞书文档
- **多平台集成**：支持更多AI编码工具和文档平台
- **高级权限管理**：细粒度的访问控制和安全策略

## 9. 总结

飞书MCP服务器通过实现Model Context Protocol，成功地将飞书文档系统与AI编码工具连接起来，使AI工具能够直接访问和操作飞书文档。这种集成极大地提高了开发效率，减少了上下文切换，使AI工具能够更准确地理解和处理文档内容。

通过模块化的设计和灵活的配置选项，飞书MCP服务器可以适应各种使用场景，为开发者提供更智能、更高效的编码体验。