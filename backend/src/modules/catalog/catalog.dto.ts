export function toCategoryDto(category: {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    icon: category.icon ?? undefined,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function toProductDto(product: {
  id: string;
  name: string;
  displayName: string;
  price: unknown;
  categoryId: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  isOpenPrice: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: product.id,
    name: product.name,
    displayName: product.displayName,
    price: Number(product.price),
    categoryId: product.categoryId,
    color: product.color,
    sortOrder: product.sortOrder,
    isActive: product.isActive,
    isOpenPrice: product.isOpenPrice,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
