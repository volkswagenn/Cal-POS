import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { ArrowDownAZ, Boxes, ChevronDown, Eye, EyeOff, GripVertical, Pencil, Plus, Save, Search, Tags, Trash2, X } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { LoadingOverlay } from '../components/common/LoadingOverlay';
import { Modal } from '../components/common/Modal';
import { ProductRepository } from '../db/repositories/ProductRepository';
import { CategoryRepository } from '../db/repositories/CategoryRepository';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../components/common/Toast';
import type { Category, Product } from '../types';
import { usePermissions } from '../hooks/usePermissions';

type ProductSort = 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc' | 'sort_order' | 'newest';
type CategorySort = 'name_asc' | 'name_desc' | 'sort_order' | 'newest';
type StatusFilter = 'all' | 'active' | 'hidden';
type ProductTab = 'products' | 'categories' | 'sorting';
type ProductDraft = Pick<Product, 'name' | 'displayName' | 'price' | 'categoryId' | 'color'>;
type CategoryDraft = Pick<Category, 'name' | 'color' | 'sortOrder'>;
type ConfirmDialogState = {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
};
type QuickAddRow = {
  _key: string;
  name: string;
  displayName: string;
  price: string;
  categoryId: string;
  color: string;
  isOpenPrice: boolean;
};

function compareText(a: string, b: string) {
  return a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' });
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function ProductManagementPage() {
  const { data: products, reload: reloadProducts, loading: loadingProducts } = useAsync(() => ProductRepository.getProducts(true), []);
  const { data: categories, reload: reloadCategories } = useAsync(() => CategoryRepository.getCategories(true), []);
  const [activeTab, setActiveTab] = useState<ProductTab>('products');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<ProductSort>('name_asc');
  const [productPageSize, setProductPageSize] = useState(50);
  const [productPage, setProductPage] = useState(1);
  const [sortingCategory, setSortingCategory] = useState('all');
  const [sortingQuery, setSortingQuery] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [draftOrder, setDraftOrder] = useState<Product[]>([]);
  const [moveTarget, setMoveTarget] = useState<{ product: Product; index: number } | null>(null);
  const [movePosition, setMovePosition] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const [syncDisplayName, setSyncDisplayName] = useState(true);
  const [showCreateProductModal, setShowCreateProductModal] = useState(false);
  const [productForm, setProductForm] = useState({ name: '', displayName: '', price: 0, categoryId: 'cat_1_29', color: '#22c55e', isOpenPrice: false });
  const [categoryQuery, setCategoryQuery] = useState('');
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<StatusFilter>('all');
  const [categorySortBy, setCategorySortBy] = useState<CategorySort>('sort_order');
  const [categoryPageSize, setCategoryPageSize] = useState(50);
  const [categoryPage, setCategoryPage] = useState(1);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [pendingDeleteCategoryIds, setPendingDeleteCategoryIds] = useState<string[]>([]);
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', color: '#1687e8' });
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddRows, setQuickAddRows] = useState<QuickAddRow[]>([]);
  const addDropdownRef = useRef<HTMLDivElement>(null);
  const quickRowKeyRef = useRef(0);
  const toast = useToast();
  const { can } = usePermissions();
  const canManageCatalog = can('products');

  const categoryName = (categoryId: string) => categories?.find((category) => category.id === categoryId)?.name ?? '-';
  const editingProduct = products?.find((product) => product.id === editingProductId);
  const editingCategory = categories?.find((category) => category.id === editingCategoryId);
  const hasProductDraft = Boolean(editingProductId && productDraft);
  const hasCategoryDraft = Boolean(editingCategoryId && categoryDraft);
  const hasProductDraftChange = Boolean(productDraft && editingProduct && (
    productDraft.name !== editingProduct.name
    || productDraft.displayName !== (editingProduct.displayName || editingProduct.name)
    || Number(productDraft.price) !== Number(editingProduct.price)
    || productDraft.categoryId !== editingProduct.categoryId
    || productDraft.color !== editingProduct.color
  ));
  const hasCategoryDeleteDraft = pendingDeleteCategoryIds.length > 0;
  const hasCategoryDraftChange = hasCategoryDeleteDraft || Boolean(categoryDraft && editingCategory && (
    categoryDraft.name !== editingCategory.name
    || categoryDraft.color !== editingCategory.color
    || Number(categoryDraft.sortOrder) !== Number(editingCategory.sortOrder)
  ));
  const currentSortingOrder = useMemo(() => [...(products ?? [])]
    .filter((product) => {
      const keyword = sortingQuery.trim().toLowerCase();
      const matchesCategory = sortingCategory === 'all' || product.categoryId === sortingCategory;
      const matchesQuery = !keyword || product.name.toLowerCase().includes(keyword) || product.displayName.toLowerCase().includes(keyword);
      return matchesCategory && matchesQuery;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || compareText(a.name, b.name)), [products, sortingCategory, sortingQuery]);
  const hasSortingDraft = draftOrder.length === currentSortingOrder.length && draftOrder.some((product, index) => product.id !== currentSortingOrder[index]?.id);
  const hasUnsavedDraft = hasProductDraftChange || hasCategoryDraftChange || hasSortingDraft;
  const navigationBlocker = useBlocker(hasUnsavedDraft);

  const filteredProducts = useMemo(() => {
    const rows = [...(products ?? [])].filter((product) => {
      const keyword = query.trim().toLowerCase();
      const matchesQuery = !keyword || product.name.toLowerCase().includes(keyword) || product.displayName.toLowerCase().includes(keyword);
      const matchesCategory = categoryFilter === 'all' || product.categoryId === categoryFilter;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? product.isActive : !product.isActive);
      return matchesQuery && matchesCategory && matchesStatus;
    });

    rows.sort((a, b) => {
      if (sortBy === 'name_asc') return compareText(a.name, b.name);
      if (sortBy === 'name_desc') return compareText(b.name, a.name);
      if (sortBy === 'price_asc') return a.price - b.price;
      if (sortBy === 'price_desc') return b.price - a.price;
      if (sortBy === 'newest') return compareText(b.createdAt, a.createdAt);
      return a.sortOrder - b.sortOrder;
    });
    return rows;
  }, [products, query, categoryFilter, statusFilter, sortBy]);

  const productTotalPages = Math.max(1, Math.ceil(filteredProducts.length / productPageSize));
  const productPageStart = (productPage - 1) * productPageSize;
  const paginatedProducts = filteredProducts.slice(productPageStart, productPageStart + productPageSize);
  const visibleStart = filteredProducts.length ? productPageStart + 1 : 0;
  const visibleEnd = Math.min(productPageStart + productPageSize, filteredProducts.length);
  const productPageNumbers = Array.from({ length: productTotalPages })
    .map((_, index) => index + 1)
    .slice(Math.max(0, productPage - 3), Math.min(productTotalPages, productPage + 2));

  // รับสินค้า/หมวดหมู่ใหม่จาก device อื่นทันทีเมื่อ sync ดึงมา
  useEffect(() => {
    const onCatalogUpdated = () => { reloadProducts(); reloadCategories(); };
    window.addEventListener('calpos:catalog-updated', onCatalogUpdated);
    return () => window.removeEventListener('calpos:catalog-updated', onCatalogUpdated);
  }, [reloadProducts, reloadCategories]);

  useEffect(() => {
    setProductPage(1);
  }, [query, categoryFilter, statusFilter, sortBy, productPageSize]);

  useEffect(() => {
    if (productPage > productTotalPages) setProductPage(productTotalPages);
  }, [productPage, productTotalPages]);

  const filteredCategories = useMemo(() => {
    const rows = [...(categories ?? [])].filter((category) => {
      if (pendingDeleteCategoryIds.includes(category.id)) return false;
      const keyword = categoryQuery.trim().toLowerCase();
      const matchesQuery = !keyword || category.name.toLowerCase().includes(keyword);
      const matchesStatus = categoryStatusFilter === 'all' || (categoryStatusFilter === 'active' ? category.isActive : !category.isActive);
      return matchesQuery && matchesStatus;
    });

    rows.sort((a, b) => {
      if (categorySortBy === 'name_asc') return compareText(a.name, b.name);
      if (categorySortBy === 'name_desc') return compareText(b.name, a.name);
      if (categorySortBy === 'newest') return compareText(b.createdAt, a.createdAt);
      return a.sortOrder - b.sortOrder;
    });
    return rows;
  }, [categories, categoryQuery, categoryStatusFilter, categorySortBy, pendingDeleteCategoryIds]);

  const categoryTotalPages = Math.max(1, Math.ceil(filteredCategories.length / categoryPageSize));
  const categoryPageStart = (categoryPage - 1) * categoryPageSize;
  const paginatedCategories = filteredCategories.slice(categoryPageStart, categoryPageStart + categoryPageSize);
  const categoryVisibleStart = filteredCategories.length ? categoryPageStart + 1 : 0;
  const categoryVisibleEnd = Math.min(categoryPageStart + categoryPageSize, filteredCategories.length);
  const categoryPageNumbers = Array.from({ length: categoryTotalPages })
    .map((_, index) => index + 1)
    .slice(Math.max(0, categoryPage - 3), Math.min(categoryTotalPages, categoryPage + 2));

  useEffect(() => {
    setCategoryPage(1);
  }, [categoryQuery, categoryStatusFilter, categorySortBy, categoryPageSize]);

  useEffect(() => {
    if (categoryPage > categoryTotalPages) setCategoryPage(categoryTotalPages);
  }, [categoryPage, categoryTotalPages]);

  useEffect(() => {
    setDraftOrder(currentSortingOrder);
  }, [currentSortingOrder]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedDraft) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedDraft]);

  useEffect(() => {
    if (!showAddDropdown) return;
    const handler = (e: MouseEvent) => {
      if (addDropdownRef.current && !addDropdownRef.current.contains(e.target as Node)) setShowAddDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddDropdown]);

  useEffect(() => {
    if (navigationBlocker.state !== 'blocked') return;
    setConfirmDialog({
      title: 'มีการแก้ไขที่ยังไม่ได้บันทึก',
      message: 'ต้องการละทิ้งการแก้ไขและออกจากหน้านี้หรือไม่?',
      confirmText: 'ละทิ้งการแก้ไข',
      onConfirm: () => {
      setEditingProductId(null);
      setProductDraft(null);
      setEditingCategoryId(null);
      setCategoryDraft(null);
      setDraftOrder(currentSortingOrder);
      setConfirmDialog(null);
      navigationBlocker.proceed();
      },
    });
  }, [currentSortingOrder, navigationBlocker]);

  const closeConfirmDialog = () => {
    if (navigationBlocker.state === 'blocked') navigationBlocker.reset();
    setConfirmDialog(null);
  };

  const discardUnsavedDraft = () => {
    setEditingProductId(null);
    setProductDraft(null);
    setEditingCategoryId(null);
    setCategoryDraft(null);
    setPendingDeleteCategoryIds([]);
    setDraftOrder(currentSortingOrder);
  };

  const confirmDiscard = (onConfirm: () => void, message = 'ต้องการละทิ้งการแก้ไขที่ยังไม่ได้บันทึกหรือไม่?') => {
    setConfirmDialog({
      title: 'มีการแก้ไขที่ยังไม่ได้บันทึก',
      message,
      confirmText: 'ละทิ้งการแก้ไข',
      onConfirm: () => {
        discardUnsavedDraft();
        setConfirmDialog(null);
        onConfirm();
      },
    });
  };

  const createProduct = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์จัดการสินค้า/หมวดหมู่', 'error');
    const productName = productForm.isOpenPrice ? (productForm.name.trim() || 'OPEN PRICE') : productForm.name.trim();
    const displayName = productForm.isOpenPrice
      ? (productForm.displayName.trim() || productName || 'Open Price')
      : (productForm.displayName.trim() || productName);
    await ProductRepository.createProduct({
      ...productForm,
      price: productForm.isOpenPrice ? 0 : productForm.price,
      isOpenPrice: productForm.isOpenPrice,
      name: productName,
      displayName,
    });
    const defaultCategory = categories?.find((category) => category.id === 'cat_1_29') ?? categories?.find((category) => category.id !== 'cat_open');
    setProductForm({ name: '', displayName: '', price: 0, categoryId: defaultCategory?.id ?? 'cat_1_29', color: defaultCategory?.color ?? '#22c55e', isOpenPrice: false });
    setSyncDisplayName(true);
    setShowCreateProductModal(false);
    toast('เพิ่มสินค้าแล้ว', 'success');
    reloadProducts();
  };

  const createCategory = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์จัดการสินค้า/หมวดหมู่', 'error');
    await CategoryRepository.createCategory(categoryForm);
    setCategoryForm({ name: '', color: '#1687e8' });
    setShowCreateCategoryModal(false);
    toast('เพิ่มหมวดหมู่แล้ว', 'success');
    reloadCategories();
  };

  const requestTabChange = (nextTab: ProductTab) => {
    if (nextTab === activeTab) return;
    if (hasUnsavedDraft) {
      confirmDiscard(() => setActiveTab(nextTab), 'ต้องการเปลี่ยน tab และละทิ้งการแก้ไขที่ยังไม่ได้บันทึกหรือไม่?');
      return;
    }
    setActiveTab(nextTab);
  };

  const startEditProduct = (product: Product) => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์แก้ไขสินค้า', 'error');
    if (hasUnsavedDraft && editingProductId !== product.id) {
      confirmDiscard(() => {
        setEditingProductId(product.id);
        setProductDraft({
          name: product.name,
          displayName: product.displayName || product.name,
          price: product.price,
          categoryId: product.categoryId,
          color: product.color,
        });
      }, 'ต้องการละทิ้งการแก้ไขปัจจุบันแล้วแก้ไขสินค้ารายการนี้หรือไม่?');
      return;
    }
    setEditingProductId(product.id);
    setProductDraft({
      name: product.name,
      displayName: product.displayName || product.name,
      price: product.price,
      categoryId: product.categoryId,
      color: product.color,
    });
  };

  const cancelEditProduct = () => {
    if (hasProductDraftChange) {
      confirmDiscard(() => undefined, 'ต้องการละทิ้งการแก้ไขสินค้านี้หรือไม่?');
      return;
    }
    setEditingProductId(null);
    setProductDraft(null);
  };

  const updateProductDraft = (patch: Partial<ProductDraft>) => {
    setProductDraft((draft) => draft ? { ...draft, ...patch } : draft);
  };

  const saveProductDraft = async (productId: string) => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์แก้ไขสินค้า', 'error');
    if (!productDraft) return;
    await ProductRepository.updateProduct(productId, {
      ...productDraft,
      name: productDraft.name.trim(),
      displayName: productDraft.displayName.trim() || productDraft.name.trim(),
      price: Number(productDraft.price),
    });
    toast('บันทึกข้อมูลสินค้าแล้ว', 'success');
    setEditingProductId(null);
    setProductDraft(null);
    reloadProducts();
  };

  const startEditCategory = (category: Category) => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์แก้ไขหมวดหมู่', 'error');
    if (hasUnsavedDraft && editingCategoryId !== category.id) {
      confirmDiscard(() => {
        setEditingCategoryId(category.id);
        setCategoryDraft({
          name: category.name,
          color: category.color,
          sortOrder: category.sortOrder,
        });
      }, 'ต้องการละทิ้งการแก้ไขปัจจุบันแล้วแก้ไขหมวดหมู่นี้หรือไม่?');
      return;
    }
    setEditingProductId(null);
    setProductDraft(null);
    setEditingCategoryId(category.id);
    setCategoryDraft({
      name: category.name,
      color: category.color,
      sortOrder: category.sortOrder,
    });
  };

  const cancelEditCategory = () => {
    if (hasCategoryDraftChange) {
      confirmDiscard(() => undefined, 'ต้องการละทิ้งการแก้ไขหมวดหมู่นี้หรือไม่?');
      return;
    }
    setEditingCategoryId(null);
    setCategoryDraft(null);
  };

  const updateCategoryDraft = (patch: Partial<CategoryDraft>) => {
    setCategoryDraft((draft) => draft ? { ...draft, ...patch } : draft);
  };

  const saveCategoryDraft = async (categoryId?: string) => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์แก้ไขหมวดหมู่', 'error');
    if (categoryId && categoryDraft) {
      await CategoryRepository.updateCategory(categoryId, {
        ...categoryDraft,
        name: categoryDraft.name.trim(),
        sortOrder: Number(categoryDraft.sortOrder),
      });
    }
    await Promise.all(pendingDeleteCategoryIds.map((id) => CategoryRepository.deleteCategory(id)));
    toast('บันทึกการแก้ไขหมวดหมู่แล้ว', 'success');
    setEditingCategoryId(null);
    setCategoryDraft(null);
    setPendingDeleteCategoryIds([]);
    reloadCategories();
  };

  const saveAlphabeticalOrder = () => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์จัดเรียงสินค้า', 'error');
    const scope = [...currentSortingOrder];
    setDraftOrder(scope.sort((a, b) => compareText(a.name, b.name)));
    toast('จัดเรียงตามตัวอักษรแล้ว กดบันทึกการแก้ไขเพื่อบันทึกจริง', 'success');
  };

  const saveManualOrder = async () => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์จัดเรียงสินค้า', 'error');
    if (!hasSortingDraft) return;
    const ids = draftOrder.map((product) => product.id);
    if (sortingCategory !== 'all') {
      // Scoped reorder: only affects products in this category, other categories are untouched
      await ProductRepository.reorderProductsInCategory(sortingCategory, ids);
    } else {
      await ProductRepository.reorderProducts(ids);
    }
    toast('บันทึกการแก้ไขลำดับสินค้าแล้ว หน้าขายจะใช้ลำดับนี้ทันที', 'success');
    reloadProducts();
  };

  const moveProductToPosition = async () => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์จัดเรียงสินค้า', 'error');
    if (!moveTarget) return;
    if (sortingCategory === 'all') {
      toast('กรุณาเลือกหมวดหมู่ก่อนย้ายสินค้าด้วยเลขลำดับ เพื่อไม่กระทบลำดับรวม', 'error');
      return;
    }
    const targetPosition = Math.min(Math.max(Number(movePosition || 1), 1), draftOrder.length);
    const nextOrder = moveItem(draftOrder, moveTarget.index, targetPosition - 1);
    setDraftOrder(nextOrder);
    toast(`ย้าย ${moveTarget.product.name} ไปที่ลำดับ ${targetPosition} แล้ว กดบันทึกการแก้ไขเพื่อบันทึกจริง`, 'success');
    setMoveTarget(null);
    setMovePosition('');
  };

  const changeSortingCategory = (nextCategory: string) => {
    if (hasSortingDraft) {
      confirmDiscard(() => setSortingCategory(nextCategory), 'ต้องการเปลี่ยนหมวดหมู่และละทิ้งการจัดเรียงที่ยังไม่ได้บันทึกหรือไม่?');
      return;
    }
    setSortingCategory(nextCategory);
  };

  const openQuickAdd = () => {
    const defaultCategory = categories?.find((c) => c.id === 'cat_1_29') ?? categories?.[0];
    setShowQuickAdd(true);
    setQuickAddRows([{ _key: String(++quickRowKeyRef.current), name: '', displayName: '', price: '', categoryId: defaultCategory?.id ?? 'cat_1_29', color: defaultCategory?.color ?? '#22c55e', isOpenPrice: false }]);
  };

  const addQuickRow = () => {
    const defaultCategory = categories?.find((c) => c.id === 'cat_1_29') ?? categories?.[0];
    setQuickAddRows((rows) => [...rows, { _key: String(++quickRowKeyRef.current), name: '', displayName: '', price: '', categoryId: defaultCategory?.id ?? 'cat_1_29', color: defaultCategory?.color ?? '#22c55e', isOpenPrice: false }]);
  };

  const updateQuickRow = (key: string, patch: Partial<QuickAddRow>) => {
    setQuickAddRows((rows) => rows.map((row) => row._key === key ? { ...row, ...patch } : row));
  };

  const removeQuickRow = (key: string) => {
    setQuickAddRows((rows) => rows.filter((row) => row._key !== key));
  };

  const saveQuickAddRows = async () => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์จัดการสินค้า/หมวดหมู่', 'error');
    const validRows = quickAddRows.filter((row) => row.name.trim());
    if (validRows.length === 0) return toast('กรุณากรอกชื่อสินค้าอย่างน้อย 1 รายการ', 'error');
    await Promise.all(validRows.map((row) => ProductRepository.createProduct({
      name: row.name.trim(),
      displayName: row.displayName.trim() || row.name.trim(),
      price: row.isOpenPrice ? 0 : Number(row.price) || 0,
      categoryId: row.categoryId,
      color: row.color,
      isOpenPrice: row.isOpenPrice,
    })));
    toast(`เพิ่มสินค้า ${validRows.length} รายการแล้ว`, 'success');
    setShowQuickAdd(false);
    setQuickAddRows([]);
    reloadProducts();
  };

  const requestDeleteProduct = (product: Product) => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์ลบสินค้า', 'error');
    setConfirmDialog({
      title: 'ลบรายการสินค้า',
      message: `ต้องการลบสินค้า ${product.name} หรือไม่?`,
      confirmText: 'ลบสินค้า',
      onConfirm: async () => {
        await ProductRepository.deleteProduct(product.id);
        setConfirmDialog(null);
        toast(`ลบ ${product.name} แล้ว`, 'success');
        reloadProducts();
      },
    });
  };

  const requestDeleteCategory = (category: Category) => {
    if (!canManageCatalog) return toast('ไม่มีสิทธิ์ลบหมวดหมู่', 'error');
    setConfirmDialog({
      title: 'นำหมวดหมู่ออกจากรายการ',
      message: `ต้องการนำหมวดหมู่ ${category.name} ออกจากรายการหรือไม่? ต้องกดบันทึกการแก้ไขก่อนจึงจะลบจริง`,
      confirmText: 'นำออกจากรายการ',
      onConfirm: () => {
        setPendingDeleteCategoryIds((ids) => ids.includes(category.id) ? ids : [...ids, category.id]);
        if (editingCategoryId === category.id) {
          setEditingCategoryId(null);
          setCategoryDraft(null);
        }
        setConfirmDialog(null);
        toast(`นำ ${category.name} ออกจากรายการแล้ว กดบันทึกการแก้ไขเพื่อลบจริง`, 'success');
      },
    });
  };

  return (
    <div className="relative p-4 md:p-6">
      <LoadingOverlay show={loadingProducts && !products} />
      <PageHeader title="สินค้าและหมวดหมู่" subtitle="จัดการสินค้า หมวดหมู่ และลำดับปุ่มสินค้าในหน้าขาย" />

      <div className="mb-4 inline-grid grid-cols-3 rounded-lg bg-white p-1 shadow-sm">
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'products' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => requestTabChange('products')}>
          <Boxes size={18} /> สินค้า
        </button>
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'categories' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => requestTabChange('categories')}>
          <Tags size={18} /> หมวดหมู่
        </button>
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'sorting' ? 'bg-primary-600 text-white' : 'text-slate-600'}`} onClick={() => requestTabChange('sorting')}>
          <ArrowDownAZ size={18} /> การจัดเรียงสินค้า
        </button>
      </div>

      {!canManageCatalog && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          ตำแหน่งนี้สามารถดูข้อมูลสินค้าและหมวดหมู่ได้เท่านั้น ปุ่มเพิ่ม แก้ไข ลบ และจัดเรียงจึงถูกปิดการใช้งาน
        </Card>
      )}

      {activeTab === 'products' && (
        <>
          <Card className="mb-4 p-4">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(150px,0.8fr)_minmax(120px,0.65fr)_minmax(160px,0.8fr)_minmax(130px,0.65fr)_minmax(150px,0.75fr)]">
              <input className="rounded-md border-slate-300" placeholder="ค้นหาชื่อสินค้า" value={query} onChange={(event) => setQuery(event.target.value)} />
              <select className="rounded-md border-slate-300" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">ทุกหมวดหมู่</option>
                {(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <select className="rounded-md border-slate-300" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="all">ทุกสถานะ</option>
                <option value="active">แสดง</option>
                <option value="hidden">ซ่อน</option>
              </select>
              <select className="rounded-md border-slate-300" value={sortBy} onChange={(event) => setSortBy(event.target.value as ProductSort)}>
                <option value="name_asc">เรียง A-Z / ก-ฮ</option>
                <option value="name_desc">เรียง Z-A / ฮ-ก</option>
                <option value="price_asc">ราคาน้อยไปมาก</option>
                <option value="price_desc">ราคามากไปน้อย</option>
                <option value="sort_order">ลำดับปุ่มขาย</option>
                <option value="newest">ใหม่ล่าสุด</option>
              </select>
              <select className="rounded-md border-slate-300" value={productPageSize} onChange={(event) => setProductPageSize(Number(event.target.value))}>
                <option value={10}>แสดง 10 รายการ</option>
                <option value={50}>แสดง 50 รายการ</option>
                <option value={100}>แสดง 100 รายการ</option>
              </select>
              <div ref={addDropdownRef} className="relative min-w-0 sm:col-span-2 xl:col-span-1">
                <div className="flex rounded-md">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-l-md bg-primary-600 px-3 py-2 font-black text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    onClick={() => setShowCreateProductModal(true)}
                    disabled={!canManageCatalog}
                  >
                    <Plus className="shrink-0" size={18} /> <span className="truncate">เพิ่มรายการ</span>
                  </button>
                  <button
                    type="button"
                    className="rounded-r-md border-l border-primary-500 bg-primary-600 px-2 text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    onClick={() => setShowAddDropdown((v) => !v)}
                    disabled={!canManageCatalog}
                    aria-label="ตัวเลือกเพิ่มเติม"
                  >
                    <ChevronDown size={18} />
                  </button>
                </div>
                {showAddDropdown && (
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[230px] rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-primary-50 hover:text-primary-700"
                      onClick={() => { setShowAddDropdown(false); openQuickAdd(); }}
                    >
                      <Plus size={15} /> เพิ่มรายการสินค้าแบบรวดเร็ว
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 text-sm text-slate-500">
              แสดง {visibleStart}-{visibleEnd} จากผลลัพธ์ {filteredProducts.length} รายการ | ทั้งหมด {products?.length ?? 0} รายการ
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => editingProductId && saveProductDraft(editingProductId)}
                disabled={!canManageCatalog || !hasProductDraftChange}
              >
                <Save size={18} /> บันทึกการแก้ไข
              </button>
            </div>
          </Card>

          {showQuickAdd && (
            <Card className="mb-4 overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 p-4">
                <div className="font-black text-slate-800">เพิ่มรายการสินค้าแบบรวดเร็ว</div>
                <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" onClick={() => { setShowQuickAdd(false); setQuickAddRows([]); }} aria-label="ปิด">
                  <X size={18} />
                </button>
              </div>
              <div className="overflow-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                    <tr>
                      <th className="p-2 pl-4">ชื่อสินค้า *</th>
                      <th className="p-2">Display name</th>
                      <th className="p-2">หมวดหมู่</th>
                      <th className="p-2">ราคา</th>
                      <th className="p-2 text-center">Open Price</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {quickAddRows.map((row) => (
                      <tr key={row._key} className="border-t border-slate-100">
                        <td className="p-2 pl-4">
                          <input
                            className="w-full min-w-[140px] rounded-md border-slate-300 text-sm"
                            placeholder="ชื่อสินค้า"
                            value={row.name}
                            onChange={(e) => updateQuickRow(row._key, { name: e.target.value })}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            className="w-full min-w-[120px] rounded-md border-slate-300 text-sm"
                            placeholder="เหมือนชื่อถ้าว่าง"
                            value={row.displayName}
                            onChange={(e) => updateQuickRow(row._key, { displayName: e.target.value })}
                          />
                        </td>
                        <td className="p-2">
                          <select
                            className="rounded-md border-slate-300 text-sm"
                            value={row.categoryId}
                            onChange={(e) => {
                              const cat = categories?.find((c) => c.id === e.target.value);
                              updateQuickRow(row._key, { categoryId: e.target.value, color: cat?.color ?? row.color });
                            }}
                          >
                            {(categories ?? []).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            className="w-24 rounded-md border-slate-300 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                            placeholder="0"
                            value={row.isOpenPrice ? '' : row.price}
                            disabled={row.isOpenPrice}
                            onChange={(e) => updateQuickRow(row._key, { price: e.target.value })}
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            className={`rounded-md px-3 py-1 text-xs font-bold ${row.isOpenPrice ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                            onClick={() => updateQuickRow(row._key, { isOpenPrice: !row.isOpenPrice, price: '' })}
                          >
                            {row.isOpenPrice ? 'เปิด' : 'ปิด'}
                          </button>
                        </td>
                        <td className="p-2">
                          <button type="button" className="rounded-md p-1 text-red-500 hover:bg-red-50" onClick={() => removeQuickRow(row._key)} aria-label="ลบแถว">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 p-4">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 hover:border-primary-400 hover:text-primary-700"
                  onClick={addQuickRow}
                >
                  <Plus size={16} /> เพิ่มแถว
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-slate-100 px-4 py-2 font-bold text-slate-700 hover:bg-slate-200"
                    onClick={() => { setShowQuickAdd(false); setQuickAddRows([]); }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-black text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    onClick={saveQuickAddRows}
                    disabled={!canManageCatalog}
                  >
                    <Save size={16} /> บันทึก {quickAddRows.filter((r) => r.name.trim()).length} รายการ
                  </button>
                </div>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-black text-slate-600">
                หน้า {productPage} จาก {productTotalPages}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-md bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                  disabled={productPage <= 1}
                >
                  ก่อนหน้า
                </button>
                {productPageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    className={`h-9 min-w-9 rounded-md px-3 text-sm font-black ${productPage === pageNumber ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                    onClick={() => setProductPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  className="rounded-md bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setProductPage((page) => Math.min(productTotalPages, page + 1))}
                  disabled={productPage >= productTotalPages}
                >
                  ถัดไป
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr><th className="p-3">สินค้า</th><th>Display name</th><th>ราคา</th><th>หมวด</th><th>สถานะ</th><th className="text-right p-3">จัดการ</th></tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product) => {
                    const isEditing = editingProductId === product.id && productDraft;
                    const rowDraft = isEditing ? productDraft : product;
                    return (
                      <tr key={product.id} className={`border-t border-slate-100 ${isEditing ? 'bg-primary-50/40' : ''}`}>
                        <td className="p-3">
                          <input
                            className="rounded-md border-slate-300 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-slate-900 disabled:opacity-100"
                            value={rowDraft.name}
                            disabled={!isEditing}
                            onChange={(event) => updateProductDraft({ name: event.target.value, displayName: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="rounded-md border-slate-300 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-slate-900 disabled:opacity-100"
                            value={rowDraft.displayName}
                            disabled={!isEditing}
                            onChange={(event) => updateProductDraft({ displayName: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="w-28 rounded-md border-slate-300 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-slate-900 disabled:opacity-100"
                            value={rowDraft.price}
                            disabled={!isEditing}
                            onChange={(event) => updateProductDraft({ price: Number(event.target.value) })}
                          />
                        </td>
                        <td>
                          <select
                            className="rounded-md border-slate-300 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-slate-900 disabled:opacity-100"
                            value={rowDraft.categoryId}
                            disabled={!isEditing}
                            onChange={(event) => {
                              const category = categories?.find((item) => item.id === event.target.value);
                              updateProductDraft({ categoryId: event.target.value, color: category?.color ?? rowDraft.color });
                            }}
                          >
                            {(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                          </select>
                        </td>
                        <td>{product.isActive ? 'แสดง' : 'ซ่อน'}</td>
                        <td className="p-3 text-right">
                          {isEditing ? (
                            <>
                              <button className="rounded-md bg-primary-600 p-2 text-white disabled:cursor-not-allowed disabled:bg-slate-300" onClick={() => saveProductDraft(product.id)} disabled={!canManageCatalog || !hasProductDraftChange} aria-label="บันทึกสินค้า">
                                <Save size={18} />
                              </button>
                              <button className="ml-2 rounded-md bg-slate-100 p-2 text-slate-700" onClick={cancelEditProduct} aria-label="ยกเลิกแก้ไข">
                                <X size={18} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button className="rounded-md bg-primary-50 p-2 text-primary-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => startEditProduct(product)} disabled={!canManageCatalog} aria-label="แก้ไขสินค้า">
                                <Pencil size={18} />
                              </button>
                              <button className="ml-2 rounded-md bg-slate-100 p-2 disabled:cursor-not-allowed disabled:opacity-40" onClick={async () => { await ProductRepository.updateProduct(product.id, { isActive: !product.isActive }); reloadProducts(); }} disabled={!canManageCatalog} aria-label="ซ่อนแสดง">
                                {product.isActive ? <Eye size={18} /> : <EyeOff size={18} />}
                              </button>
                              <button className="ml-2 rounded-md bg-red-50 p-2 text-red-600 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => requestDeleteProduct(product)} disabled={!canManageCatalog} aria-label="ลบสินค้า">
                                <Trash2 size={18} />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {activeTab === 'categories' && (
        <>
          <Card className="mb-4 p-4">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_190px_150px_auto]">
              <input className="rounded-md border-slate-300" placeholder="ค้นหาชื่อหมวดหมู่" value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} />
              <select className="rounded-md border-slate-300" value={categoryStatusFilter} onChange={(event) => setCategoryStatusFilter(event.target.value as StatusFilter)}>
                <option value="all">ทุกสถานะ</option>
                <option value="active">แสดง</option>
                <option value="hidden">ซ่อน</option>
              </select>
              <select className="rounded-md border-slate-300" value={categorySortBy} onChange={(event) => setCategorySortBy(event.target.value as CategorySort)}>
                <option value="sort_order">ลำดับหมวดหมู่</option>
                <option value="name_asc">เรียง A-Z / ก-ฮ</option>
                <option value="name_desc">เรียง Z-A / ฮ-ก</option>
                <option value="newest">ใหม่ล่าสุด</option>
              </select>
              <select className="rounded-md border-slate-300" value={categoryPageSize} onChange={(event) => setCategoryPageSize(Number(event.target.value))}>
                <option value={10}>แสดง 10 รายการ</option>
                <option value={50}>แสดง 50 รายการ</option>
                <option value={100}>แสดง 100 รายการ</option>
              </select>
              <button type="button" className="rounded-md bg-primary-600 px-4 py-2 font-black text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:col-span-2 xl:col-span-1" onClick={() => setShowCreateCategoryModal(true)} disabled={!canManageCatalog}>
                <Plus className="mr-1 inline" size={18} /> เพิ่มหมวดหมู่
              </button>
            </div>
            <div className="mt-2 text-sm text-slate-500">
              แสดง {categoryVisibleStart}-{categoryVisibleEnd} จากผลลัพธ์ {filteredCategories.length} รายการ | ทั้งหมด {categories?.length ?? 0} รายการ
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => saveCategoryDraft(editingCategoryId ?? undefined)}
                disabled={!canManageCatalog || !hasCategoryDraftChange}
              >
                <Save size={18} /> บันทึกการแก้ไข
              </button>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-black text-slate-600">หน้า {categoryPage} จาก {categoryTotalPages}</div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setCategoryPage((page) => Math.max(1, page - 1))} disabled={categoryPage <= 1}>
                  ก่อนหน้า
                </button>
                {categoryPageNumbers.map((pageNumber) => (
                  <button key={pageNumber} className={`h-9 min-w-9 rounded-md px-3 text-sm font-black ${categoryPage === pageNumber ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setCategoryPage(pageNumber)}>
                    {pageNumber}
                  </button>
                ))}
                <button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setCategoryPage((page) => Math.min(categoryTotalPages, page + 1))} disabled={categoryPage >= categoryTotalPages}>
                  ถัดไป
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr><th className="p-3">หมวดหมู่</th><th>สี</th><th>สถานะ</th><th className="p-3 text-right">จัดการ</th></tr>
                </thead>
                <tbody>
                  {paginatedCategories.map((category) => {
                    const isEditing = editingCategoryId === category.id && categoryDraft;
                    const rowDraft = isEditing ? categoryDraft : category;
                    return (
                      <tr key={category.id} className={`border-t border-slate-100 ${isEditing ? 'bg-primary-50/40' : ''}`}>
                        <td className="p-3">
                          <input className="rounded-md border-slate-300 disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-slate-900 disabled:opacity-100" value={rowDraft.name} disabled={!isEditing} onChange={(event) => updateCategoryDraft({ name: event.target.value })} />
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <input type="color" className="h-10 w-16 rounded-md border-slate-300 disabled:opacity-70" value={rowDraft.color} disabled={!isEditing} onChange={(event) => updateCategoryDraft({ color: event.target.value })} />
                            <span className="text-xs font-bold text-slate-500">{rowDraft.color}</span>
                          </div>
                        </td>
                        <td>{category.isActive ? 'แสดง' : 'ซ่อน'}</td>
                        <td className="p-3 text-right">
                          {isEditing ? (
                            <>
                              <button className="rounded-md bg-primary-600 p-2 text-white disabled:cursor-not-allowed disabled:bg-slate-300" onClick={() => saveCategoryDraft(category.id)} disabled={!canManageCatalog || !hasCategoryDraftChange} aria-label="บันทึกหมวดหมู่"><Save size={18} /></button>
                              <button className="ml-2 rounded-md bg-slate-100 p-2 text-slate-700" onClick={cancelEditCategory} aria-label="ยกเลิกแก้ไข"><X size={18} /></button>
                            </>
                          ) : (
                            <>
                              <button className="rounded-md bg-primary-50 p-2 text-primary-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => startEditCategory(category)} disabled={!canManageCatalog} aria-label="แก้ไขหมวดหมู่"><Pencil size={18} /></button>
                              <button className="ml-2 rounded-md bg-slate-100 p-2 disabled:cursor-not-allowed disabled:opacity-40" onClick={async () => { await CategoryRepository.updateCategory(category.id, { isActive: !category.isActive }); reloadCategories(); }} disabled={!canManageCatalog} aria-label="ซ่อนแสดง">{category.isActive ? <Eye size={18} /> : <EyeOff size={18} />}</button>
                              <button className="ml-2 rounded-md bg-red-50 p-2 text-red-600 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => requestDeleteCategory(category)} disabled={!canManageCatalog} aria-label="ลบหมวดหมู่"><Trash2 size={18} /></button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {activeTab === 'sorting' && (
        <Card className="p-4">
          <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[220px_minmax(220px,1fr)_auto_auto_1fr]">
            <select className="rounded-md border-slate-300" value={sortingCategory} onChange={(event) => changeSortingCategory(event.target.value)}>
              <option value="all">ทุกหมวดหมู่</option>
              {(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <label className="flex min-w-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3">
              <Search size={18} className="shrink-0 text-slate-400" />
              <input className="min-w-0 flex-1 border-0 bg-transparent py-2 focus:ring-0" placeholder="ค้นหารายการสินค้า" value={sortingQuery} onChange={(event) => setSortingQuery(event.target.value)} />
            </label>
            <button className="rounded-md bg-slate-800 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" onClick={saveAlphabeticalOrder} disabled={!canManageCatalog}>
              <ArrowDownAZ className="mr-1 inline" size={18} /> Sort ตามตัวอักษร
            </button>
            <button className="rounded-md bg-primary-600 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" onClick={saveManualOrder} disabled={!canManageCatalog || !hasSortingDraft}>
              <Save className="mr-1 inline" size={18} /> บันทึกการแก้ไข
            </button>
            <div className="self-center text-sm text-slate-500">ลากแถวสินค้าเพื่อเปลี่ยนตำแหน่ง ปุ่มขายในหน้า POS จะเรียงตามลำดับที่บันทึก</div>
          </div>

          <div className="max-h-[65vh] overflow-auto rounded-md border border-slate-200">
            {draftOrder.map((product, index) => (
              <div
                key={product.id}
                draggable={canManageCatalog}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex === null || dragIndex === index) return;
                  setDraftOrder((current) => moveItem(current, dragIndex, index));
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className={`grid grid-cols-[44px_64px_1fr_140px_120px] items-center gap-3 border-b border-slate-100 bg-white p-3 ${canManageCatalog ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-70'} ${dragIndex === index ? 'opacity-50' : ''}`}
              >
                <GripVertical className="text-slate-400" size={20} />
                <button
                  className="rounded-md bg-slate-100 px-2 py-1 text-center text-sm font-black hover:bg-primary-50 hover:text-primary-700"
                  disabled={!canManageCatalog}
                  onClick={() => {
                    if (!canManageCatalog) return;
                    if (sortingCategory === 'all') {
                      toast('กรุณาเลือกหมวดหมู่ก่อนย้ายสินค้าด้วยเลขลำดับ', 'error');
                      return;
                    }
                    setMoveTarget({ product, index });
                    setMovePosition(String(index + 1));
                  }}
                >
                  {index + 1}
                </button>
                <div className="min-w-0">
                  <div className="truncate font-black">{product.name}</div>
                  <div className="text-xs text-slate-500">{categoryName(product.categoryId)}</div>
                </div>
                <div className="font-bold">{product.price.toLocaleString('th-TH')} บาท</div>
                <span className={`rounded-full px-2 py-1 text-center text-xs font-bold ${product.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {product.isActive ? 'แสดง' : 'ซ่อน'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showCreateCategoryModal && (
        <Modal title="เพิ่มหมวดหมู่" onClose={() => setShowCreateCategoryModal(false)}>
          <form onSubmit={createCategory} className="space-y-3">
            <label className="block text-sm font-bold text-slate-700">
              ชื่อหมวดหมู่
              <input className="mt-1 w-full rounded-md border-slate-300" value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} required />
            </label>
            <label className="block text-sm font-bold text-slate-700">
              สีหมวดหมู่
              <div className="mt-1 grid grid-cols-[1fr_96px] gap-2">
                <input className="rounded-md border-slate-300" value={categoryForm.color} onChange={(event) => setCategoryForm({ ...categoryForm, color: event.target.value })} required />
                <input type="color" className="h-11 w-full rounded-md border-slate-300" value={categoryForm.color} onChange={(event) => setCategoryForm({ ...categoryForm, color: event.target.value })} />
              </div>
            </label>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={() => setShowCreateCategoryModal(false)}>
                ยกเลิก
              </button>
              <button className="rounded-md bg-primary-600 py-3 font-black text-white">
                <Plus className="mr-1 inline" size={18} /> เพิ่มหมวดหมู่
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showCreateProductModal && (
        <Modal title="เพิ่มรายการสินค้า" onClose={() => setShowCreateProductModal(false)}>
          <form onSubmit={createProduct} className="space-y-3">
            <label className="block text-sm font-bold text-slate-700">
              ชื่อสินค้า
              <input
                className="mt-1 w-full rounded-md border-slate-300"
                value={productForm.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setProductForm({ ...productForm, name, displayName: syncDisplayName ? name : productForm.displayName });
                }}
                required
              />
            </label>
            <label className="block text-sm font-bold text-slate-700">
              Display name
              <input
                className="mt-1 w-full rounded-md border-slate-300 disabled:bg-slate-100 disabled:text-slate-500"
                value={productForm.displayName}
                onChange={(event) => setProductForm({ ...productForm, displayName: event.target.value })}
                disabled={syncDisplayName}
                required
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-600"
                checked={syncDisplayName}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSyncDisplayName(checked);
                  if (checked) setProductForm((form) => ({ ...form, displayName: form.name }));
                }}
              />
              ใช้ชื่อเดียวกับสินค้า
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-bold text-slate-700">
                ราคา
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border-slate-300 disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder={productForm.isOpenPrice ? 'Open price' : 'ราคา'}
                  value={productForm.isOpenPrice ? '' : productForm.price || ''}
                  onChange={(event) => setProductForm({ ...productForm, price: Number(event.target.value) })}
                  disabled={productForm.isOpenPrice}
                  required={!productForm.isOpenPrice}
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                หมวดหมู่
                <select className="mt-1 w-full rounded-md border-slate-300" value={productForm.categoryId} onChange={(event) => {
                  const category = categories?.find((item) => item.id === event.target.value);
                  setProductForm({ ...productForm, categoryId: event.target.value, color: category?.color ?? productForm.color });
                }}>
                  {(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_96px]">
              <label className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 font-bold text-slate-700">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-600"
                  checked={productForm.isOpenPrice}
                  onChange={(event) => {
                    const open = event.target.checked;
                    const openCategory = categories?.find((category) => category.id === 'cat_open');
                    setProductForm({
                      ...productForm,
                      isOpenPrice: open,
                      price: open ? 0 : productForm.price,
                      categoryId: open ? (openCategory?.id ?? productForm.categoryId) : productForm.categoryId,
                      color: open ? (openCategory?.color ?? '#f97316') : productForm.color,
                    });
                  }}
                />
                Open price
              </label>
              <input type="color" className="h-11 w-full rounded-md border-slate-300" value={productForm.color} onChange={(event) => setProductForm({ ...productForm, color: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={() => setShowCreateProductModal(false)}>
                ยกเลิก
              </button>
              <button className="rounded-md bg-primary-600 py-3 font-black text-white">
                <Plus className="mr-1 inline" size={18} /> เพิ่มสินค้า
              </button>
            </div>
          </form>
        </Modal>
      )}

      {moveTarget && (
        <Modal title="ย้ายสินค้าไปลำดับที่" onClose={() => setMoveTarget(null)}>
          <div className="mb-4 rounded-md bg-slate-50 p-3">
            <div className="font-black">{moveTarget.product.name}</div>
            <div className="text-sm text-slate-500">ลำดับปัจจุบัน {moveTarget.index + 1} จาก {draftOrder.length}</div>
          </div>
          <label className="block text-sm font-bold text-slate-700">
            ย้ายไปลำดับที่
            <input
              type="number"
              min={1}
              max={draftOrder.length}
              className="mt-1 w-full rounded-md border-slate-300 text-2xl font-black"
              value={movePosition}
              onChange={(event) => setMovePosition(event.target.value)}
              autoFocus
            />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={() => setMoveTarget(null)}>
              ยกเลิก
            </button>
            <button className="rounded-md bg-primary-600 py-3 font-bold text-white" onClick={moveProductToPosition}>
              ย้ายสินค้า
            </button>
          </div>
        </Modal>
      )}

      {confirmDialog && (
        <Modal title={confirmDialog.title} onClose={closeConfirmDialog}>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="text-base font-black text-amber-900">{confirmDialog.message}</div>
              <div className="mt-1 text-sm font-medium text-amber-700">ข้อมูลที่ยังไม่ได้กดบันทึกการแก้ไขจะไม่ถูกบันทึก</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={closeConfirmDialog}>
                กลับไปแก้ไข
              </button>
              <button className="rounded-md bg-red-600 py-3 font-black text-white hover:bg-red-700" onClick={confirmDialog.onConfirm}>
                {confirmDialog.confirmText ?? 'ยืนยัน'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
