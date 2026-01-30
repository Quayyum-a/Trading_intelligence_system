import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getEnvironmentConfig } from '../config/env.js';

export interface HealthResponse {
  status: 'ok';
  environment: string;
  uptime: number;
}

const startTime = Date.now();

async function healthHandler(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const env = getEnvironmentConfig();
  const uptime = Date.now() - startTime;

  const response: HealthResponse = {
    status: 'ok',
    environment: env.NODE_ENV,
    uptime,
  };

  await reply.code(200).type('application/json').send(response);
}

export async function registerHealthRoutes(
  fastify: FastifyInstance
): Promise<void> {
  await fastify.register(async function healthRoutes(fastify: FastifyInstance) {
    fastify.get(
      '/health',
      {
        schema: {
          response: {
            200: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['ok'] },
                environment: { type: 'string' },
                uptime: { type: 'number' },
              },
              required: ['status', 'environment', 'uptime'],
            },
          },
        },
      },
      healthHandler
    );
  });
}
