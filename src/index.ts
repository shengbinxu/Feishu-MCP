import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FeishuMcpServer } from "./server";
import { getServerConfig } from "./config";

export async function startServer(): Promise<void> {
  // Check if we're running in stdio mode (e.g., via CLI)
  const isStdioMode = process.env.NODE_ENV === "cli" || process.argv.includes("--stdio");

  const config = getServerConfig(isStdioMode);

  // 创建飞书配置对象
  const feishuConfig = {
    appId: config.feishuAppId!,
    appSecret: config.feishuAppSecret!
  };

  console.log("Feishu configuration status: Available");
  console.log(`Feishu App ID: ${feishuConfig.appId.substring(0, 4)}...${feishuConfig.appId.substring(feishuConfig.appId.length - 4)}`);
  console.log(`Feishu App Secret: ${feishuConfig.appSecret.substring(0, 4)}...${feishuConfig.appSecret.substring(feishuConfig.appSecret.length - 4)}`);

  const server = new FeishuMcpServer(feishuConfig);

  if (isStdioMode) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    console.log(`Initializing Feishu MCP Server in HTTP mode on port ${config.port}...`);
    await server.startHttpServer(config.port);
  }
}

// If this file is being run directly, start the server
if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
