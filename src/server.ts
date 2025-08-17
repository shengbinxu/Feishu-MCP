import express, { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Logger } from './utils/logger.js';
import { SSEConnectionManager } from './manager/sseConnectionManager.js';
import { FeishuMcp } from './mcp/feishuMcp.js';
import { callback, getTokenByParams } from './services/callbackService.js';
import { Config } from './utils/config.js';
import { verifyUserToken, AuthenticatedRequest } from './middleware/authMiddleware.js';

export class FeishuMcpServer {
  private connectionManager: SSEConnectionManager;

  constructor() {
    this.connectionManager = new SSEConnectionManager();
  }

  // async connect(transport: Transport, userAccessToken?: string, userInfo?: any): Promise<void> {
  //   Logger.info('connect');
  //   const server = new FeishuMcp(userAccessToken, userInfo);
  //   await server.connect(transport);
  //
  //   Logger.info = (...args: any[]) => {
  //     server.server.sendLoggingMessage({ level: 'info', data: args });
  //   };
  //   Logger.error = (...args: any[]) => {
  //     server.server.sendLoggingMessage({ level: 'error', data: args });
  //   };
  //
  //   Logger.info('Server connected and ready to process requests');
  // }

  async startHttpServer(port: number): Promise<void> {
    const app = express();
    
    // 配置请求体解析中间件
    // app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/sse', verifyUserToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      let sseTransport: SSEServerTransport | null = null;
      try {
        
        sseTransport = new SSEServerTransport('/messages', res);
        const sessionId = sseTransport.sessionId;
        Logger.log(`[SSE Connection] New SSE connection established for sessionId ${sessionId} by user ${req.userInfo?.name}`, req.userInfo);
        
        // 添加错误监听器
        res.on('error', (error: any) => {
          Logger.error(`[SSE Connection] Response stream error for ${sessionId}:`, error);
          this.connectionManager.removeConnection(sessionId);
        });
        
        res.on('close', () => {
          Logger.info(`[SSE Connection] Response stream closed for ${sessionId}`);
          this.connectionManager.removeConnection(sessionId);
        });
        
        this.connectionManager.addConnection(sessionId, sseTransport, req, res);
        
        const tempServer = new FeishuMcp();
        // 直接连接MCP服务器到SSE传输层，不使用包装的connect方法
        await tempServer.connect(sseTransport);

        Logger.info(`[SSE Connection] Successfully connected transport for: ${sessionId}`);
      } catch (error: any) {
        Logger.error(`[SSE Connection] Error in SSE endpoint:`, error);
        if (sseTransport) {
          this.connectionManager.removeConnection(sseTransport.sessionId);
        }
        if (!res.writableEnded) {
          res.status(500).json({ error: 'Failed to establish SSE connection', details: error?.message || 'Unknown error' });
        }
        return;
      }
    });

    app.post('/messages', async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      Logger.info(`[SSE messages] Received message with sessionId: ${sessionId}, params: ${JSON.stringify(req.query)}, body: ${JSON.stringify(req.body)}`,);

      if (!sessionId) {
        res.status(400).send('Missing sessionId query parameter');
        return;
      }

      const transport = this.connectionManager.getTransport(sessionId);
      Logger.log(`[SSE messages] Retrieved transport for sessionId ${sessionId}: ${transport ? transport.sessionId : 'Transport not found'}`,);

      if (!transport) {
        res
          .status(404)
          .send(`No active connection found for sessionId: ${sessionId}`);
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.get('/callback', callback);

    // OAuth 2.0 Dynamic Client Registration - RFC 7591
    app.post('/register', (_: Request, res: Response) => {
      Logger.log(`[OAuth Registration] Received dynamic client registration request`);
      
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const clientSecret = `secret_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
      
      const registrationResponse = {
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0,
        redirect_uris: ['http://10.158.71.162:3333/oauth/feishu/callback'],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
        application_type: "web"
      };
      
      Logger.info(`[OAuth Registration] Created new client: ${clientId}`);
      res.status(201).json(registrationResponse);
    });

    // OAuth 2.0 Authorization Endpoint - 飞书授权
    app.get('/authorize', (req: Request, res: Response) => {
      Logger.log(`[Feishu OAuth Authorization] Received authorization request: ${JSON.stringify(req.query)}`);
      
      const { 
        response_type = 'code',
        client_id, 
        redirect_uri, 
        scope = 'docs:document.content:read docx:document docx:document.block:convert docx:document:create docx:document:readonly drive:drive drive:file:upload wiki:space:read wiki:space:retrieve wiki:wiki wiki:wiki:readonly offline_access drive:drive drive:drive.metadata:readonly drive:drive drive:drive:readonly space:document:retrieve', 
        state 
      } = req.query;
      
      // 验证必需参数
      if (!redirect_uri) {
        return res.status(400).json({ 
          error: 'invalid_request', 
          error_description: 'Missing redirect_uri parameter' 
        });
      }
      
      // 获取飞书配置
      const config = Config.getInstance();
      const feishuAppId = config.feishu.appId;
      
      if (!feishuAppId) {
        return res.status(500).json({ 
          error: 'server_error', 
          error_description: 'Feishu app_id not configured' 
        });
      }
      
      // 构造本服务器的回调地址 (飞书将回调到这里)
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const ourCallbackUrl = `${baseUrl}/oauth/feishu/callback`;
      
      // 将原始的redirect_uri和其他参数编码到state中
      const stateData = {
        original_redirect_uri: redirect_uri,
        original_state: state,
        client_id: client_id
      };
      const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64');
      
      // 构造飞书授权URL
      const feishuAuthUrl = new URL('https://open.feishu.cn/open-apis/authen/v1/authorize');
      feishuAuthUrl.searchParams.set('app_id', feishuAppId);
      feishuAuthUrl.searchParams.set('redirect_uri', ourCallbackUrl);
      feishuAuthUrl.searchParams.set('response_type', response_type as string);
      feishuAuthUrl.searchParams.set('scope', scope as string);
      feishuAuthUrl.searchParams.set('state', encodedState);
      
      Logger.info(`[Feishu OAuth Authorization] Redirecting to Feishu authorization page: ${feishuAuthUrl.toString()}`);
      Logger.info(`[Feishu OAuth Authorization] Original redirect_uri: ${redirect_uri}, will callback to: ${ourCallbackUrl}`);
      return res.redirect(feishuAuthUrl.toString());
    });

    // 飞书OAuth回调端点 - 接收飞书的授权码并重定向到原始地址
    app.get('/oauth/feishu/callback', (req: Request, res: Response) => {
      Logger.log(`[Feishu OAuth Callback] Received callback from Feishu: ${JSON.stringify(req.query)}`);
      
      const { code, state, error } = req.query;
      
      // 处理授权错误
      if (error) {
        Logger.error(`[Feishu OAuth Callback] Authorization error: ${error}`);
        return res.status(400).send(`授权失败: ${error}`);
      }
      
      // 验证必需参数
      if (!code || !state) {
        Logger.error(`[Feishu OAuth Callback] Missing required parameters: code=${code}, state=${state}`);
        return res.status(400).send('缺少必需参数');
      }
      
      try {
        // 解码state获取原始参数
        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
        const { original_redirect_uri, original_state, client_id } = stateData;
        
        Logger.info(`[Feishu OAuth Callback] Decoded state - original_redirect_uri: ${original_redirect_uri}`);
        
        // 构造重定向到原始地址的URL
        const finalRedirectUrl = new URL(original_redirect_uri);
        finalRedirectUrl.searchParams.set('code', code as string);
        
        if (original_state) {
          finalRedirectUrl.searchParams.set('state', original_state);
        }
        
        Logger.info(`[Feishu OAuth Callback] Final redirect to: ${finalRedirectUrl.toString()}`);
        return res.redirect(finalRedirectUrl.toString());
        
      } catch (error) {
        Logger.error(`[Feishu OAuth Callback] Error decoding state:`, error);
        return res.status(400).send('状态参数解码失败');
      }
    });

    // OAuth 2.0 Token Endpoint - 飞书令牌交换
    app.post('/token', async (req: Request, res: Response) => {
      Logger.log(`[Feishu OAuth Token] Received token request headers: ${JSON.stringify(req.headers)}`);
      Logger.log(`[Feishu OAuth Token] Received token request body: ${JSON.stringify(req.body)}`);
      Logger.log(`[Feishu OAuth Token] Content-Type: ${req.get('Content-Type')}`);
      
      const { grant_type, code, code_verifier, redirect_uri } = req.body;
      
      if (grant_type !== 'authorization_code') {
        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Only authorization_code grant type is supported'
        });
      }
      
      if (!code) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing authorization code'
        });
      }
      
      try {
        // 获取飞书配置
        const config = Config.getInstance();
        const feishuAppId = config.feishu.appId;
        const feishuAppSecret = config.feishu.appSecret;
        
        if (!feishuAppId || !feishuAppSecret) {
          return res.status(500).json({
            error: 'server_error',
            error_description: 'Feishu configuration incomplete'
          });
        }
        
        // 使用授权码换取飞书用户访问令牌
        // 注意: 必须使用与授权时相同的redirect_uri (即我们服务器的回调地址)
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const ourCallbackUrl = `${baseUrl}/oauth/feishu/callback`;
        
        const tokenRequestBody = {
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: ourCallbackUrl  // 使用我们服务器的回调地址，与授权时一致
        };
        
        const tokenResponse = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await getTenantAccessToken(feishuAppId, feishuAppSecret)}`
          },
          body: JSON.stringify(tokenRequestBody)
        });
        
        const tokenData = await tokenResponse.json();
        
        if (tokenData.code === 0) {
          // 成功获取飞书用户令牌
          Logger.info(`[Feishu OAuth Token] Successfully obtained user access token`);
          
          const response = {
            access_token: tokenData.data.access_token,
            token_type: 'Bearer',
            expires_in: tokenData.data.expires_in,
            refresh_token: tokenData.data.refresh_token,
            scope: tokenData.data.scope || 'email:readonly'
          };
          
                     return res.json(response);
         } else {
           Logger.error(`[Feishu OAuth Token] Failed to obtain access token: ${JSON.stringify(tokenData)}`);
           return res.status(400).json({
             error: 'invalid_grant',
             error_description: `Feishu API error: ${tokenData.msg || 'Unknown error'}`
           });
         }
       } catch (error) {
         Logger.error(`[Feishu OAuth Token] Error during token exchange:`, error);
         return res.status(500).json({
           error: 'server_error',
           error_description: 'Failed to exchange authorization code for access token'
         });
       }
    });

    // 获取飞书租户访问令牌的辅助函数
    async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret
        })
      });
      
      const data = await response.json();
      if (data.code === 0) {
        return data.tenant_access_token;
      } else {
        throw new Error(`Failed to get tenant access token: ${data.msg}`);
      }
    }

    app.get('/getToken', async (req: Request, res: Response) => {
      const { client_id, client_secret, token_type } = req.query;
      if (!client_id || !client_secret) {
        res.status(400).json({ code: 400, msg: '缺少 client_id 或 client_secret' });
        return;
      }
      try {
        const tokenResult = await getTokenByParams({
          client_id: client_id as string,
          client_secret: client_secret as string,
          token_type: token_type as string
        });
        res.json({ code: 0, msg: 'success', data: tokenResult });
      } catch (e: any) {
        res.status(500).json({ code: 500, msg: e.message || '获取token失败' });
      }
    });

    // OAuth 2.0 Authorization Server Metadata - RFC 8414
    app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
      Logger.log(`[OAuth Discovery] Received request for authorization server metadata`);
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
      const metadata = {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        userinfo_endpoint: `${baseUrl}/userinfo`,
        revocation_endpoint: `${baseUrl}/revoke`,
        introspection_endpoint: `${baseUrl}/introspect`,
        response_types_supported: [
          "code"
        ],
        response_modes_supported:[
          "query"
        ],
        grant_types_supported: [
          "authorization_code",
          "refresh_token"
        ],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
          "none"
        ],
        code_challenge_methods_supported: [
          "plain",
          "S256"
        ],
        registration_endpoint: `${baseUrl}/register`
      };

      res.json(metadata);
    });

    // OAuth 2.0 Protected Resource Metadata - RFC 8707
    app.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
      Logger.log(`[OAuth Discovery] Received request for protected resource metadata`);
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
      const metadata = {
        resource: baseUrl,
        authorization_servers: [`${baseUrl}`],
        bearer_methods_supported: [
          "header"
        ],
        resource_documentation: `${baseUrl}/docs`,
        // revocation_endpoint: `${baseUrl}/revoke`,
        // introspection_endpoint: `${baseUrl}/introspect`
      };

      res.json(metadata);
    });

    app.listen(port, () => {
      Logger.info(`HTTP server listening on port ${port}`);
      Logger.info(`SSE endpoint available at http://localhost:${port}/sse`);
      Logger.info(`Message endpoint available at http://localhost:${port}/messages`);
      Logger.info(`OAuth Authorization endpoint available at http://localhost:${port}/authorize`);
      Logger.info(`OAuth Token endpoint available at http://localhost:${port}/token`);
      Logger.info(`OAuth Registration endpoint available at http://localhost:${port}/register`);
      Logger.info(`OAuth Discovery endpoint available at http://localhost:${port}/.well-known/oauth-authorization-server`);
      Logger.info(`User Documents API available at http://localhost:${port}/api/user/documents`);
      Logger.info(`User Folders API available at http://localhost:${port}/api/user/folders`);
    });
  }
}
