import type { User } from '../../types';
import { apiRequest } from './client';

export const usersApi = {
  list() {
    return apiRequest<{ users: User[] }>('/api/users');
  },
};
