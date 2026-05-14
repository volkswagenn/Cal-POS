import type { Category, Product } from '../../types';
import { apiRequest } from './client';

export const productsApi = {
  listProducts() {
    return apiRequest<{ products: Product[] }>('/api/products');
  },

  createProduct(product: Product) {
    return apiRequest<{ product: Product }>('/api/products', {
      method: 'POST',
      body: JSON.stringify(product),
    });
  },

  updateProduct(id: string, patch: Partial<Product>) {
    return apiRequest<{ product: Product }>(`/api/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  deleteProduct(id: string) {
    return apiRequest<{ ok: true }>(`/api/products/${id}`, { method: 'DELETE' });
  },

  listCategories() {
    return apiRequest<{ categories: Category[] }>('/api/categories');
  },

  createCategory(category: Category) {
    return apiRequest<{ category: Category }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    });
  },

  updateCategory(id: string, patch: Partial<Category>) {
    return apiRequest<{ category: Category }>(`/api/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  deleteCategory(id: string) {
    return apiRequest<{ ok: true }>(`/api/categories/${id}`, { method: 'DELETE' });
  },
};
