import type { FastifyReply, FastifyRequest } from 'fastify';

export function requireRole(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.user.role.toLowerCase();
    const allowed = allowedRoles.map((item) => item.toLowerCase());

    if (!allowed.includes(role)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
  };
}
