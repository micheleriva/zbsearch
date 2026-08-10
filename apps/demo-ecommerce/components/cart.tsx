'use client'

import { useEffect } from 'react'
import { findProduct } from '@/lib/catalog'
import { formatPrice } from '@/lib/format'
import type { Product } from '@/lib/types'

export type CartState = Record<string, number>

const FREE_SHIPPING_OVER = 50

function Drawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />

      <aside className="zbs-slide-in relative flex h-full w-full max-w-md flex-col bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-shade hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {children}

        {footer}
      </aside>
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return <p className="flex-1 px-5 py-8 text-[13px] text-ink-muted">{message}</p>
}

export function CartDrawer({
  cart,
  onClose,
  onSetQuantity,
}: {
  cart: CartState
  onClose: () => void
  onSetQuantity: (id: string, quantity: number) => void
}) {
  const lines = Object.entries(cart)
    .map(([id, quantity]) => ({ product: findProduct(id), quantity }))
    .filter((line): line is { product: Product; quantity: number } => Boolean(line.product))

  const subtotal = lines.reduce((total, line) => total + line.product.price * line.quantity, 0)
  const toFreeShipping = Math.max(0, FREE_SHIPPING_OVER - subtotal)

  return (
    <Drawer
      title={`Your cart (${lines.reduce((total, line) => total + line.quantity, 0)})`}
      onClose={onClose}
      footer={
        <footer className="border-t border-line px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-muted">Subtotal</span>
            <span className="text-[20px] font-semibold tabular-nums text-ink">{formatPrice(subtotal)}</span>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-faint">Taxes and shipping calculated at checkout.</p>
          <button
            type="button"
            disabled
            className="mt-3 w-full cursor-not-allowed rounded-xl bg-ink py-3 text-[13px] font-medium text-card opacity-60"
          >
            Checkout — it&apos;s a demo
          </button>
        </footer>
      }
    >
      {lines.length === 0 ? (
        <Empty message="Your cart is empty. Search for something you don't need." />
      ) : (
        <>
          {subtotal > 0 ? (
            <p className="border-b border-line-soft bg-shade px-5 py-2.5 text-[12px] text-ink-muted">
              {toFreeShipping > 0 ? (
                <>
                  Add <span className="font-medium text-ink">{formatPrice(toFreeShipping)}</span> more for free
                  delivery.
                </>
              ) : (
                <span className="font-medium text-positive">You&apos;ve unlocked free delivery.</span>
              )}
            </p>
          ) : null}

          <ul className="flex-1 divide-y divide-line-soft overflow-auto">
            {lines.map(({ product, quantity }) => (
              <li key={product.id} className="flex gap-3.5 px-5 py-4">
                <img
                  src={product.image}
                  alt=""
                  width={64}
                  height={64}
                  className="h-16 w-16 shrink-0 rounded-lg border border-line-soft bg-white object-contain p-1.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{product.title}</div>
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                    {product.brand || product.category}
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center rounded-lg border border-line">
                      <button
                        type="button"
                        onClick={() => onSetQuantity(product.id, quantity - 1)}
                        className="h-7 w-7 text-ink-muted hover:text-ink"
                        aria-label={`Remove one ${product.title}`}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-[12px] tabular-nums text-ink">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => onSetQuantity(product.id, quantity + 1)}
                        className="h-7 w-7 text-ink-muted hover:text-ink"
                        aria-label={`Add one ${product.title}`}
                      >
                        +
                      </button>
                    </div>
                    <span className="text-[13px] font-semibold tabular-nums text-ink">
                      {formatPrice(product.price * quantity)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  )
}

export function SavedDrawer({
  saved,
  onClose,
  onRemove,
  onAddToCart,
}: {
  saved: string[]
  onClose: () => void
  onRemove: (id: string) => void
  onAddToCart: (id: string) => void
}) {
  const items = saved.map(findProduct).filter((product): product is Product => Boolean(product))

  return (
    <Drawer title={`Saved items (${items.length})`} onClose={onClose}>
      {items.length === 0 ? (
        <Empty message="Nothing saved yet. Tap the heart on any product." />
      ) : (
        <ul className="flex-1 divide-y divide-line-soft overflow-auto">
          {items.map(product => (
            <li key={product.id} className="flex gap-3.5 px-5 py-4">
              <img
                src={product.image}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 rounded-lg border border-line-soft bg-white object-contain p-1.5"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{product.title}</div>
                <div className="text-[13px] font-semibold tabular-nums text-ink">{formatPrice(product.price)}</div>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onAddToCart(product.id)}
                    disabled={!product.inStock}
                    className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-card disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {product.inStock ? 'Add to cart' : 'Sold out'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(product.id)}
                    className="text-[12px] text-ink-muted hover:text-ink hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}
