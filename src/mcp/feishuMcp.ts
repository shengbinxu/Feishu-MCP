import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FeishuApiService } from '../services/feishuApiService.js';
import { Logger } from '../utils/logger.js';
import { Config } from '../utils/config.js';
import { registerFeishuTools } from './tools/feishuTools.js';
import { registerFeishuBlockTools } from './tools/feishuBlockTools.js';
import { registerFeishuFolderTools } from './tools/feishuFolderTools.js';

const serverInfo = {
  name: "Feishu MCP Server",
  version: "0.0.9",
};

const serverOptions = {
  capabilities: { logging: {}, tools: {} },
};

/**
 * 飞书MCP服务类
 * 继承自McpServer，提供飞书工具注册和初始化功能
 */
export class FeishuMcp extends McpServer {
  private feishuService: FeishuApiService | null = null;
  private userAccessToken?: string;
  private userInfo?: any;
  private toolsRegistered: number = 0; // 手动计数工具数量

  /**
   * 构造函数
   * @param userAccessToken 用户访问令牌（可选）
   * @param userInfo 用户信息（可选）
   */
  constructor(userAccessToken?: string, userInfo?: any) {
    super(serverInfo,serverOptions);
    
    this.userAccessToken = userAccessToken;
    this.userInfo = userInfo;
    
    // 初始化飞书服务
    this.initFeishuService();
    
    // 总是尝试注册工具
    try {
      this.registerAllTools();
      Logger.info(`工具注册完成 - 用户: ${this.userInfo?.name || '未知'}`);
    } catch (error) {
      Logger.error('注册飞书工具时出错:', error);
      // 不抛出错误，让MCP服务器继续运行，但工具可能不可用
    }
  }

  /**
   * 初始化飞书API服务
   */
  private initFeishuService(): void {
    try {
      // 先检查配置是否完整
      const config = Config.getInstance();
      
      Logger.info(`检查飞书配置 - App ID: ${config.feishu.appId ? '已配置' : '未配置'}, App Secret: ${config.feishu.appSecret ? '已配置' : '未配置'}`);
      
      if (!config.feishu.appId || !config.feishu.appSecret) {
        Logger.warn('飞书配置不完整，但继续初始化服务以支持基本功能');
        Logger.warn('要使用完整功能，请设置环境变量 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
        // 不返回null，而是继续初始化，这样至少有基本的工具可用
      }
      
      // 使用单例模式获取飞书服务实例
      this.feishuService = FeishuApiService.getInstance();
      Logger.info('飞书服务初始化成功');
    } catch (error) {
      Logger.error('飞书服务初始化失败:', error);
      this.feishuService = null;
    }
  }

  /**
   * 注册所有飞书MCP工具
   */
  private registerAllTools(): void {
    Logger.info(`开始注册工具 - 用户令牌: ${this.userAccessToken ? '已提供' : '未提供'}, 用户: ${this.userInfo?.name || '未知'}`);
    Logger.info(`飞书服务状态: ${this.feishuService ? '已初始化' : '未初始化'}`);
    
    try {
      // 重置工具计数
      this.toolsRegistered = 0;
      
      // 注册所有工具 - 传递用户上下文，即使服务未完全初始化也尝试注册
      Logger.debug('注册飞书文档工具...');
      const feishuToolsCount = this.registerFeishuToolsWithCount();
      
      Logger.debug('注册飞书块工具...');
      const blockToolsCount = this.registerFeishuBlockToolsWithCount();
      
      Logger.debug('注册飞书文件夹工具...');
      const folderToolsCount = this.registerFeishuFolderToolsWithCount();
      
      this.toolsRegistered = feishuToolsCount + blockToolsCount + folderToolsCount;
      
      Logger.info(`所有工具注册完成，共注册 ${this.toolsRegistered} 个工具`);
      
      if (this.toolsRegistered === 0) {
        Logger.warn('警告：没有注册任何工具，这可能是配置问题或工具注册失败');
        Logger.warn('请检查飞书配置或查看详细错误日志');
      }
    } catch (error) {
      Logger.error('工具注册过程中出错:', error);
      throw error; // 重新抛出，让上层处理
    }
  }
  
  /**
   * 注册飞书工具并返回数量
   */
  private registerFeishuToolsWithCount(): number {
    const toolsBefore = this.getAllToolNames().length;
    registerFeishuTools(this, this.feishuService, this.userAccessToken, this.userInfo);
    const toolsAfter = this.getAllToolNames().length;
    return toolsAfter - toolsBefore;
  }
  
  /**
   * 注册飞书块工具并返回数量
   */
  private registerFeishuBlockToolsWithCount(): number {
    const toolsBefore = this.getAllToolNames().length;
    registerFeishuBlockTools(this, this.feishuService);
    const toolsAfter = this.getAllToolNames().length;
    return toolsAfter - toolsBefore;
  }
  
  /**
   * 注册飞书文件夹工具并返回数量
   */
  private registerFeishuFolderToolsWithCount(): number {
    const toolsBefore = this.getAllToolNames().length;
    registerFeishuFolderTools(this, this.feishuService, this.userAccessToken, this.userInfo);
    const toolsAfter = this.getAllToolNames().length;
    return toolsAfter - toolsBefore;
  }
  
  /**
   * 获取所有工具名称（用于计数）
   */
  private getAllToolNames(): string[] {
    try {
      // 尝试多种可能的字段来获取工具
      const server = this.server || this;
      const possibleFields = ['_tools', 'tools', '_handlers', 'handlers', '_toolHandlers', 'toolHandlers', '_tool_handlers'];
      
      for (const field of possibleFields) {
        const tools = (server as any)[field];
        if (tools && typeof tools === 'object') {
          return Object.keys(tools);
        }
      }
      return [];
    } catch {
      return [];
    }
  }
  
  /**
   * 获取已注册的工具数量（用于调试）
   */
  public getToolCount(): number {
    try {
      // 优先返回手动计数的数量
      if (this.toolsRegistered > 0) {
        return this.toolsRegistered;
      }
      
      // 备用方案：尝试通过反射获取工具数量
      const toolNames = this.getAllToolNames();
      return toolNames.length;
    } catch (error) {
      Logger.debug('获取工具数量时出错:', error);
      return this.toolsRegistered; // 返回手动计数的数量
    }
  }
  
  /**
   * 获取用户访问令牌
   */
  public getUserAccessToken(): string | undefined {
    return this.userAccessToken;
  }
  
  /**
   * 获取用户信息
   */
  public getUserInfo(): any {
    return this.userInfo;
  }
} 