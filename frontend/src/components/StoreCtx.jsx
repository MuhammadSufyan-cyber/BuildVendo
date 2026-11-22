"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export const StoreContext = createContext(null);
export const useStore = () => useContext(StoreContext);

// Cart lives in the browser (localStorage). Prices are NEVER trusted from it: the server re-prices at checkout.
export function useCart(slug) {
  const key = `cart:${slug}`;
  const [items, setItems] = useState([]);
  useEffect(() => { try { setItems(JSON.parse(localStorage.getItem(key) || "[]")); } catch { setItems([]); } }, [key]);
  const save = useCallback((next) => { setItems(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage blocked */ } }, [key]);
  const add = (item) => { const i = items.findIndex((x) => x.variantId === item.variantId); save(i >= 0 ? items.map((x, j) => (j === i ? { ...x, qty: Math.min(99, x.qty + item.qty) } : x)) : [...items, item]); };
  const setQty = (variantId, qty) => save(qty <= 0 ? items.filter((x) => x.variantId !== variantId) : items.map((x) => (x.variantId === variantId ? { ...x, qty: Math.min(99, qty) } : x)));
  const clear = () => save([]);
  return { items, add, setQty, clear, count: items.reduce((s, i) => s + i.qty, 0) };
}
