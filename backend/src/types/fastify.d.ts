import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      shopId: string;
      role: string;
      username: string;
    };
    user: {
      sub: string;
      shopId: string;
      role: string;
      username: string;
    };
  }
}
