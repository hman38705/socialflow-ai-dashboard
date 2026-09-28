import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'SocialFlow AI Dashboard API',
      version: '1.0.0',
      description:
        'REST API for the SocialFlow AI Dashboard — social media scheduling, analytics, AI content tools, billing, and more.',
    },
    servers: [
      { url: '/api/v1', description: 'Current stable version' },
      { url: '/api', description: 'Legacy alias (deprecated)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        AuthTokens: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
          },
          required: ['accessToken', 'refreshToken'],
        },
        Credentials: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
          },
          required: ['email', 'password'],
        },
        RefreshTokenRequest: {
          type: 'object',
          properties: {
            refreshToken: { type: 'string' },
          },
          required: ['refreshToken'],
        },
        ChangePasswordRequest: {
          type: 'object',
          properties: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8 },
          },
          required: ['currentPassword', 'newPassword'],
        },
        Post: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            content: { type: 'string' },
            platform: {
              type: 'string',
              enum: ['twitter', 'linkedin', 'instagram', 'tiktok', 'facebook', 'youtube'],
            },
            organizationId: { type: 'string', format: 'uuid' },
            scheduledAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Organization: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        WebhookSubscription: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string', format: 'uri' },
            events: { type: 'array', items: { type: 'string' } },
            active: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        VideoJob: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
            },
            progress: { type: 'number', minimum: 0, maximum: 100 },
            outputPath: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true },
          },
        },
        Subscription: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            plan: { type: 'string' },
            credits: { type: 'number' },
            status: { type: 'string' },
          },
        },
        PagedResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: {} },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            pages: { type: 'integer' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/**/*.ts', './src/routes/v1/*.ts', './src/modules/content/routes.video.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
