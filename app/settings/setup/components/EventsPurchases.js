'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, MoreHorizontal, Trash2, X } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SearchInput from '@/components/ui/search-input'
import api from '@/lib/api'
import { toast } from '@/components/ui/toast'
import GlobalLoader from '@/components/shared/GlobalLoader'

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const selectCls = 'h-9 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function StatusBadge({ active }) {
  return (
    <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'].join(' ')}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function Shell({ count, noun, onAdd, addLabel, search, setSearch, children }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <SearchInput className="w-[220px] shrink-0" placeholder={`Search ${noun}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-brand bg-background border border-border">
            {count} {count === 1 ? noun.replace(/s$/, '') : noun}
          </span>
          <Button className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2 shrink-0" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            {addLabel}
          </Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card min-h-[420px] overflow-x-auto">
        {children}
      </div>
    </div>
  )
}

/* ─────────────────────────── Products ─────────────────────────── */

function ProductDialog({ open, onClose, product, onRefresh }) {
  const isEdit = Boolean(product)
  const [form, setForm] = useState({ name: '', description: '', defaultPrice: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(product
      ? { name: product.name || '', description: product.description || '', defaultPrice: product.defaultPrice ?? '' }
      : { name: '', description: '', defaultPrice: '' })
  }, [open, product])

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), description: form.description.trim() || undefined, defaultPrice: Number(form.defaultPrice) || 0 }
      const res = isEdit ? await api.put(`/api/product/${product._id}`, payload) : await api.post('/api/product', payload)
      if (res.success) { toast.success(isEdit ? 'Product updated' : 'Product created'); onRefresh(); onClose() }
      else toast.error('Failed', { description: res.error })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md">
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Product' : 'Add Product'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" placeholder="Guest ticket, hotel night…" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Input id="p-desc" placeholder="Optional" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-price">Default price</Label>
            <Input id="p-price" type="number" min="0" step="0.01" placeholder="0.00" value={form.defaultPrice} onChange={(e) => setForm((f) => ({ ...f, defaultPrice: e.target.value }))} />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ProductsTab() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async (s) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (s) params.set('search', s)
      const res = await api.get(`/api/product?${params}`)
      if (res.success) { setRows(Array.isArray(res.data) ? res.data : []); setCount(res.pagination?.total ?? res.data?.length ?? 0) }
      else toast.error('Failed to load products', { description: res.error })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { const t = setTimeout(() => load(search), 250); return () => clearTimeout(t) }, [search, load])

  async function remove(row) {
    if (!window.confirm(`Delete "${row.name}"?`)) return
    const res = await api.delete(`/api/product/${row._id}`)
    if (res.success) { toast.success('Product deleted'); load(search) } else toast.error('Delete failed', { description: res.error })
  }
  async function toggle(row) {
    const res = await api.patch(`/api/product/${row._id}/toggle`)
    if (res.success) { load(search) } else toast.error('Failed', { description: res.error })
  }

  if (loading && rows.length === 0) return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading products…" /></div>

  return (
    <Shell count={count} noun="products" addLabel="Add Product" onAdd={() => { setEditing(null); setDialogOpen(true) }} search={search} setSearch={setSearch}>
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Name</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Description</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Default Price</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Status</TableHead>
            <TableHead className="w-12 py-3 pr-4 pl-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="py-16 text-center text-sm text-muted-foreground">{search ? 'No products match your search.' : 'No products yet. Click "Add Product" to create one.'}</TableCell></TableRow>
          ) : rows.map((row) => (
            <TableRow key={row._id} className="border-b border-border hover:bg-muted/30 cursor-pointer" onClick={() => { setEditing(row); setDialogOpen(true) }}>
              <TableCell className="py-3 px-4 text-sm font-medium text-foreground">{row.name}</TableCell>
              <TableCell className="py-3 px-4 text-sm text-muted-foreground max-w-[280px] truncate">{row.description || '—'}</TableCell>
              <TableCell className="py-3 px-4 text-sm text-foreground">{money(row.defaultPrice)}</TableCell>
              <TableCell className="py-3 px-4"><StatusBadge active={row.isActive} /></TableCell>
              <TableCell className="py-3 pr-4 pl-0" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditing(row); setDialogOpen(true) }}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggle(row)}>{row.isActive ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => remove(row)}>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ProductDialog open={dialogOpen} onClose={() => setDialogOpen(false)} product={editing} onRefresh={() => load(search)} />
    </Shell>
  )
}

/* ─────────────────────────── Event Types ─────────────────────────── */

function EventTypeDialog({ open, onClose, eventType, onRefresh }) {
  const isEdit = Boolean(eventType)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(eventType ? { name: eventType.name || '', description: eventType.description || '' } : { name: '', description: '' })
  }, [open, eventType])

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), description: form.description.trim() || undefined }
      const res = isEdit ? await api.put(`/api/event-type/${eventType._id}`, payload) : await api.post('/api/event-type', payload)
      if (res.success) { toast.success(isEdit ? 'Event type updated' : 'Event type created'); onRefresh(); onClose() }
      else toast.error('Failed', { description: res.error })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md">
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Event Type' : 'Add Event Type'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="et-name">Name</Label>
            <Input id="et-name" placeholder="Competition, showcase, retreat…" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="et-desc">Description</Label>
            <Input id="et-desc" placeholder="Optional" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create event type'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EventTypesTab() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async (s) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (s) params.set('search', s)
      const res = await api.get(`/api/event-type?${params}`)
      if (res.success) { setRows(Array.isArray(res.data) ? res.data : []); setCount(res.pagination?.total ?? res.data?.length ?? 0) }
      else toast.error('Failed to load event types', { description: res.error })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { const t = setTimeout(() => load(search), 250); return () => clearTimeout(t) }, [search, load])

  async function remove(row) {
    if (!window.confirm(`Delete "${row.name}"?`)) return
    const res = await api.delete(`/api/event-type/${row._id}`)
    if (res.success) { toast.success('Event type deleted'); load(search) } else toast.error('Delete failed', { description: res.error })
  }
  async function toggle(row) {
    const res = await api.patch(`/api/event-type/${row._id}/toggle`)
    if (res.success) { load(search) } else toast.error('Failed', { description: res.error })
  }

  if (loading && rows.length === 0) return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading event types…" /></div>

  return (
    <Shell count={count} noun="event types" addLabel="Add Event Type" onAdd={() => { setEditing(null); setDialogOpen(true) }} search={search} setSearch={setSearch}>
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Name</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Description</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Status</TableHead>
            <TableHead className="w-12 py-3 pr-4 pl-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={4} className="py-16 text-center text-sm text-muted-foreground">{search ? 'No event types match your search.' : 'No event types yet. Click "Add Event Type" to create one.'}</TableCell></TableRow>
          ) : rows.map((row) => (
            <TableRow key={row._id} className="border-b border-border hover:bg-muted/30 cursor-pointer" onClick={() => { setEditing(row); setDialogOpen(true) }}>
              <TableCell className="py-3 px-4 text-sm font-medium text-foreground">{row.name}</TableCell>
              <TableCell className="py-3 px-4 text-sm text-muted-foreground max-w-[320px] truncate">{row.description || '—'}</TableCell>
              <TableCell className="py-3 px-4"><StatusBadge active={row.isActive} /></TableCell>
              <TableCell className="py-3 pr-4 pl-0" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditing(row); setDialogOpen(true) }}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggle(row)}>{row.isActive ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => remove(row)}>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <EventTypeDialog open={dialogOpen} onClose={() => setDialogOpen(false)} eventType={editing} onRefresh={() => load(search)} />
    </Shell>
  )
}

/* ─────────────────────────── Line-item editor (shared) ─────────────────────────── */

const emptyLine = () => ({ productID: '', name: '', quantity: 1, unitPrice: 0, discount: 0, eventDate: '' })
const lineTotal = (li) => Math.max(0, (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0) - (Number(li.discount) || 0))

const th = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
const numInput = 'h-9 w-[76px] text-right tabular-nums px-2'

function LineItemsEditor({ items, setItems, products, footerExtra = null, showDate = false }) {
  function update(i, patch) { setItems((prev) => prev.map((li, idx) => idx === i ? { ...li, ...patch } : li)) }
  function pickProduct(i, id) {
    const p = products.find((x) => x._id === id)
    update(i, p ? { productID: id, name: p.name, unitPrice: p.defaultPrice ?? 0 } : { productID: '' })
  }
  function addSaved() {
    const p = products[0]
    setItems((prev) => [...prev, { ...emptyLine(), productID: p?._id || '', name: p?.name || '', unitPrice: p?.defaultPrice ?? 0 }])
  }

  const dashBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 h-9 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-brand/50 hover:bg-muted/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/40 text-left">
              <th className={`${th} w-full`}>Product</th>
              <th className={`${th} text-right`}>Qty.</th>
              <th className={`${th} text-right`}>Price</th>
              <th className={`${th} text-right`}>Discount</th>
              <th className={`${th} text-right`}>Total</th>
              {showDate && <th className={th}>Event date <span className="font-normal normal-case">(optional)</span></th>}
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={showDate ? 7 : 6} className="px-3 py-6 text-center text-sm text-muted-foreground">No line items yet — add a saved product or a custom item below.</td></tr>
            ) : items.map((li, i) => (
              <tr key={i} className="border-t border-border align-middle">
                <td className="px-3 py-2">
                  {li.productID ? (
                    <select className="h-9 w-full min-w-[240px] rounded-md border border-border bg-background px-2 text-sm" value={li.productID} onChange={(e) => pickProduct(i, e.target.value)}>
                      {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <Input placeholder="Custom item name" value={li.name} onChange={(e) => update(i, { name: e.target.value })} className="h-9 w-full min-w-[240px]" />
                  )}
                </td>
                <td className="px-1.5 py-2"><Input type="number" min="0" value={li.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className={numInput} /></td>
                <td className="px-1.5 py-2"><Input type="number" min="0" step="0.01" value={li.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} className={numInput} /></td>
                <td className="px-1.5 py-2"><Input type="number" min="0" step="0.01" value={li.discount} onChange={(e) => update(i, { discount: e.target.value })} className={numInput} /></td>
                <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums whitespace-nowrap">{money(lineTotal(li))}</td>
                {showDate && (
                  <td className="px-1.5 py-2">
                    <Input type="datetime-local" value={li.eventDate || ''} onChange={(e) => update(i, { eventDate: e.target.value })} className="h-9 w-[200px]" />
                  </td>
                )}
                <td className="px-1 py-2 text-center">
                  <button type="button" aria-label="Remove line" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-3 border-t border-border bg-muted/20">
        <button type="button" className={dashBtn} onClick={addSaved} disabled={products.length === 0}>
          <Plus className="h-3.5 w-3.5" /> Add saved product
        </button>
        <button type="button" className={dashBtn} onClick={() => setItems((prev) => [...prev, emptyLine()])}>
          <Plus className="h-3.5 w-3.5" /> Add custom item
        </button>
        {footerExtra}
      </div>
    </div>
  )
}

/* ─────────────────────────── Saved Templates ─────────────────────────── */

function TemplateDialog({ open, onClose, template, products, eventTypes, onRefresh }) {
  const isEdit = Boolean(template)
  const [name, setName] = useState('')
  const [eventTypeID, setEventTypeID] = useState('')
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (template) {
      setName(template.name || '')
      setEventTypeID(template.eventTypeID?._id || template.eventTypeID || '')
      setItems((template.lineItems || []).map((li) => ({
        productID: li.productID?._id || li.productID || '',
        name: li.name || '', quantity: li.quantity ?? 1, unitPrice: li.unitPrice ?? 0, discount: li.discount ?? 0,
      })))
    } else { setName(''); setEventTypeID(''); setItems([]) }
  }, [open, template])

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Template name is required'); return }
    const lineItems = items.filter((li) => (li.name || '').trim())
    if (lineItems.length === 0) { toast.error('Add at least one product'); return }
    setSaving(true)
    try {
      const payload = { name: name.trim(), eventTypeID: eventTypeID || undefined, lineItems }
      const res = isEdit ? await api.put(`/api/purchase-template/${template._id}`, payload) : await api.post('/api/purchase-template', payload)
      if (res.success) { toast.success(isEdit ? 'Template updated' : 'Template created'); onRefresh(); onClose() }
      else toast.error('Failed', { description: res.error })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="3xl">
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Saved Template' : 'Add Saved Template'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-name">Template name</Label>
              <Input id="t-name" placeholder="AODC New Jersey 2026" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-et">Event type</Label>
              <select id="t-et" className={selectCls} value={eventTypeID} onChange={(e) => setEventTypeID(e.target.value)}>
                <option value="">—</option>
                {eventTypes.map((et) => <option key={et._id} value={et._id}>{et.name}</option>)}
              </select>
            </div>
          </div>
          <LineItemsEditor items={items} setItems={setItems} products={products} />
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SavedTemplatesTab() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState([])
  const [eventTypes, setEventTypes] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async (s) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (s) params.set('search', s)
      const [tRes, pRes, eRes] = await Promise.all([
        api.get(`/api/purchase-template?${params}`),
        api.get('/api/product?limit=200&isActive=true'),
        api.get('/api/event-type?limit=200&isActive=true'),
      ])
      if (tRes.success) { setRows(Array.isArray(tRes.data) ? tRes.data : []); setCount(tRes.pagination?.total ?? tRes.data?.length ?? 0) }
      else toast.error('Failed to load templates', { description: tRes.error })
      if (pRes.success) setProducts(Array.isArray(pRes.data) ? pRes.data : [])
      if (eRes.success) setEventTypes(Array.isArray(eRes.data) ? eRes.data : [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { const t = setTimeout(() => load(search), 250); return () => clearTimeout(t) }, [search, load])

  async function openEdit(row) {
    const res = await api.get(`/api/purchase-template/${row._id}`)
    setEditing(res.success ? res.data : row)
    setDialogOpen(true)
  }
  async function remove(row) {
    if (!window.confirm(`Delete "${row.name}"?`)) return
    const res = await api.delete(`/api/purchase-template/${row._id}`)
    if (res.success) { toast.success('Template deleted'); load(search) } else toast.error('Delete failed', { description: res.error })
  }
  async function toggle(row) {
    const res = await api.patch(`/api/purchase-template/${row._id}/toggle`)
    if (res.success) { load(search) } else toast.error('Failed', { description: res.error })
  }

  if (loading && rows.length === 0) return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading templates…" /></div>

  return (
    <Shell count={count} noun="templates" addLabel="Add Template" onAdd={() => { setEditing(null); setDialogOpen(true) }} search={search} setSearch={setSearch}>
      <Table>
        <TableHeader>
          <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Template Name</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Event Type</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Default Products</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Last Updated</TableHead>
            <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Status</TableHead>
            <TableHead className="w-12 py-3 pr-4 pl-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="py-16 text-center text-sm text-muted-foreground">{search ? 'No templates match your search.' : 'No saved templates yet. Click "Add Template" to create one.'}</TableCell></TableRow>
          ) : rows.map((row) => (
            <TableRow key={row._id} className="border-b border-border hover:bg-muted/30 cursor-pointer" onClick={() => openEdit(row)}>
              <TableCell className="py-3 px-4 text-sm font-medium text-foreground">{row.name}</TableCell>
              <TableCell className="py-3 px-4 text-sm text-foreground">{row.eventTypeID?.name || '—'}</TableCell>
              <TableCell className="py-3 px-4 text-sm text-muted-foreground">{row.lineItems?.length ?? 0} product{(row.lineItems?.length ?? 0) !== 1 ? 's' : ''}</TableCell>
              <TableCell className="py-3 px-4 text-sm text-muted-foreground">{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}</TableCell>
              <TableCell className="py-3 px-4"><StatusBadge active={row.isActive} /></TableCell>
              <TableCell className="py-3 pr-4 pl-0" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(row)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggle(row)}>{row.isActive ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => remove(row)}>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TemplateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} template={editing} products={products} eventTypes={eventTypes} onRefresh={() => load(search)} />
    </Shell>
  )
}

/* ─────────────────────────── Create Event & Purchase ─────────────────────────── */

export function CreateEventPurchaseDialog({ open, onClose, onCreated }) {
  const [step, setStep] = useState(1)
  const [products, setProducts] = useState([])
  const [eventTypes, setEventTypes] = useState([])
  const [templates, setTemplates] = useState([])
  const [teachers, setTeachers] = useState([])

  const [customerQuery, setCustomerQuery] = useState('')
  const [customers, setCustomers] = useState([])
  const [customer, setCustomer] = useState(null)
  const [showResults, setShowResults] = useState(false)

  const [eventTypeID, setEventTypeID] = useState('')
  const [templateID, setTemplateID] = useState('')
  const [name, setName] = useState('')
  const [items, setItems] = useState([])
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [saving, setSaving] = useState(false)

  // Billing
  const todayISO = () => new Date().toISOString().slice(0, 10)
  const [billingType, setBillingType] = useState('one_time') // one_time | payment_plan | flexible
  const [collectNow, setCollectNow] = useState(true)
  const [payMethod, setPayMethod] = useState('cash') // cash | card | cheque | other
  const [collectDate, setCollectDate] = useState(todayISO())
  const [useWallet, setUseWallet] = useState(false)
  const [walletAmount, setWalletAmount] = useState('')
  const [walletBalance, setWalletBalance] = useState(null)
  // tip
  const [tipEnabled, setTipEnabled] = useState(false)
  const [tipTeacherID, setTipTeacherID] = useState('')
  const [tipAmount, setTipAmount] = useState('')
  // payment_plan
  const [planCount, setPlanCount] = useState('3')
  const [planFreq, setPlanFreq] = useState('monthly')
  const [planStart, setPlanStart] = useState(todayISO())
  // flexible
  const [flexMode, setFlexMode] = useState('single') // single | custom
  const [flexDueDate, setFlexDueDate] = useState(todayISO())
  const [flexRows, setFlexRows] = useState([{ dueDate: todayISO(), amount: '' }])

  useEffect(() => {
    if (!open) return
    setStep(1); setCustomer(null); setCustomerQuery(''); setEventTypeID(''); setTemplateID('')
    setName(''); setItems([]); setSaveAsTemplate(false)
    setBillingType('one_time'); setCollectNow(true); setPayMethod('cash'); setCollectDate(todayISO())
    setUseWallet(false); setWalletAmount(''); setWalletBalance(null)
    setTipEnabled(false); setTipTeacherID(''); setTipAmount('')
    setPlanCount('3'); setPlanFreq('monthly'); setPlanStart(todayISO())
    setFlexMode('single'); setFlexDueDate(todayISO()); setFlexRows([{ dueDate: todayISO(), amount: '' }])
    setCustomers([])
    Promise.all([
      api.get('/api/product?limit=200&isActive=true'),
      api.get('/api/event-type?limit=200&isActive=true'),
      api.get('/api/purchase-template?limit=200&isActive=true'),
      api.get('/api/customer?limit=500'),
      api.get('/api/teacher?limit=200&status=active'),
    ]).then(([p, e, t, c, tch]) => {
      if (p.success) setProducts(Array.isArray(p.data) ? p.data : [])
      if (e.success) setEventTypes(Array.isArray(e.data) ? e.data : [])
      if (t.success) setTemplates(Array.isArray(t.data) ? t.data : [])
      if (c.success) setCustomers(Array.isArray(c.data) ? c.data : [])
      if (tch.success) setTeachers(Array.isArray(tch.data) ? tch.data : [])
    })
  }, [open])

  useEffect(() => {
    if (!customer?._id) { setWalletBalance(null); return }
    api.get(`/api/wallet/${customer._id}/balance`).then((res) => {
      if (res.success) setWalletBalance(Number(res.data?.balance ?? 0))
    })
  }, [customer])

  const customerMatches = (() => {
    const q = customerQuery.trim().toLowerCase()
    const list = q
      ? customers.filter((c) => `${c.name || ''} ${c.email || ''}`.toLowerCase().includes(q))
      : customers
    return list.slice(0, 50)
  })()

  function applyTemplate(id) {
    setTemplateID(id)
    const tpl = templates.find((x) => x._id === id)
    if (!tpl) return
    if (!name.trim()) setName(tpl.name)
    if (tpl.eventTypeID) setEventTypeID(tpl.eventTypeID._id || tpl.eventTypeID)
    setItems((tpl.lineItems || []).map((li) => ({
      productID: li.productID?._id || li.productID || '',
      name: li.name || '', quantity: li.quantity ?? 1, unitPrice: li.unitPrice ?? 0, discount: li.discount ?? 0,
    })))
  }

  const totals = items.reduce((acc, li) => {
    const q = Number(li.quantity) || 0, up = Number(li.unitPrice) || 0, d = Number(li.discount) || 0
    acc.subtotal += q * up; acc.discount += d
    return acc
  }, { subtotal: 0, discount: 0 })
  const payable = Math.max(0, totals.subtotal - totals.discount)

  const isPlan = billingType === 'payment_plan'
  const isFlex = billingType === 'flexible'
  const walletEligible = billingType === 'one_time' && collectNow && useWallet && walletBalance != null
  const walletEntered = walletEligible ? Number(walletAmount) || 0 : 0
  const walletApplied = Math.min(walletEntered, payable, walletBalance ?? 0)
  const walletOver = walletEligible && walletEntered > (walletBalance ?? 0)
  const methodCharge = Math.max(0, payable - walletApplied)

  const planCountN = Math.max(1, Number(planCount) || 1)
  const perInstallment = payable / planCountN
  const flexTotal = flexRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const flexBalanced = Math.abs(flexTotal - payable) < 0.01

  async function submit() {
    if (!customer) { toast.error('Select a student or customer'); return }
    if (!name.trim()) { toast.error('Enter a purchase name'); return }
    const lineItems = items.filter((li) => (li.name || '').trim())
    if (lineItems.length === 0) { toast.error('Add at least one line item'); return }
    setSaving(true)
    try {
      const res = await api.post('/api/purchase', {
        customerID: customer._id,
        eventTypeID: eventTypeID || undefined,
        sourceTemplateID: templateID || undefined,
        name: name.trim(),
        lineItems,
        saveAsTemplate,
        templateName: name.trim(),
      })
      if (!res.success) { toast.error('Failed', { description: res.error }); return }

      const purchase = res.data

      if (payable <= 0) {
        toast.success('Event & purchase created')
      } else if (billingType === 'one_time') {
        if (collectNow && !walletOver) {
          const tip = tipEnabled && tipTeacherID && Number(tipAmount) > 0
            ? { teacherID: tipTeacherID, amount: Number(tipAmount), method: payMethod === 'card' ? 'card' : payMethod }
            : undefined
          const payRes = await api.post('/api/payment', {
            customerID: customer._id, purchaseID: purchase._id, type: 'event_purchase',
            amount: payable, method: payMethod, paymentDate: collectDate || undefined,
            walletAmount: walletApplied > 0 ? walletApplied : undefined, notes: name.trim(),
            tip,
          })
          if (!payRes.success) toast.error('Purchase saved, but payment failed', { description: payRes.error })
          else if (payRes.data?.checkoutUrl) { window.open(payRes.data.checkoutUrl, '_blank', 'noopener'); toast.success('Card checkout opened in a new tab') }
          else toast.success('Event & purchase created and paid')
        } else {
          toast.success('Event & purchase created')
        }
      } else {
        // payment_plan or flexible → build a payment plan
        let billing
        if (isPlan) {
          billing = { numberOfInstallments: planCountN, frequency: planFreq, startDate: planStart, method: payMethod, collectDate }
        } else if (flexMode === 'custom') {
          billing = { customInstallments: flexRows.filter((r) => r.dueDate && Number(r.amount) > 0).map((r) => ({ dueDate: r.dueDate, amount: Number(r.amount) })), method: payMethod, collectDate }
        } else {
          billing = { dueDate: flexDueDate, method: payMethod, collectDate }
        }
        const planRes = await api.post('/api/payment-plan/purchase', {
          customerID: customer._id, purchaseID: purchase._id, collectNow, billing,
        })
        if (!planRes.success) toast.error('Purchase saved, but the payment plan failed', { description: planRes.error })
        else if (planRes.data?.checkoutUrl) { window.open(planRes.data.checkoutUrl, '_blank', 'noopener'); toast.success('Plan created — first installment checkout opened') }
        else toast.success(`${isPlan ? 'Payment plan' : 'Flexible schedule'} created`)
      }

      onCreated?.(purchase)
      onClose()
    } finally { setSaving(false) }
  }

  const canProceed = customer && name.trim() && items.some((li) => (li.name || '').trim())

  return (
    <Sheet open={open} onClose={onClose} width="640px">
      <SheetContent onClose={onClose} className="p-0">
        <div className="shrink-0 border-b border-border px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold tracking-tight">Create Event &amp; Purchase</h2>
          <p className="text-sm text-muted-foreground mt-1">Sell an event, product, or custom charge.</p>
          <div className="flex items-center gap-2 pt-3">
            {[{ n: 1, label: 'Details & billing' }, { n: 2, label: 'Payment' }].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                {i > 0 && <span className="h-px w-6 bg-border" />}
                <span className={['inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold', step >= s.n ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground'].join(' ')}>{s.n}</span>
                <span className={['text-xs font-medium', step === s.n ? 'text-foreground' : 'text-muted-foreground'].join(' ')}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label>Student or customer</Label>
                {customer ? (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 h-10">
                    <span className="text-sm font-medium">{customer.name}{customer.email ? <span className="text-muted-foreground font-normal"> · {customer.email}</span> : null}</span>
                    <button type="button" aria-label="Clear customer" onClick={() => { setCustomer(null); setCustomerQuery(''); setShowResults(false) }} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder={customers.length ? 'Search by name or email…' : 'Loading customers…'}
                      value={customerQuery}
                      onChange={(e) => { setCustomerQuery(e.target.value); setShowResults(true) }}
                      onFocus={() => setShowResults(true)}
                    />
                    {showResults && (
                      <div className="rounded-lg border border-border bg-card divide-y divide-border max-h-56 overflow-y-auto">
                        {customerMatches.length === 0 ? (
                          <p className="px-3 py-3 text-sm text-muted-foreground">{customers.length ? 'No matches.' : 'Loading…'}</p>
                        ) : customerMatches.map((c) => (
                          <button key={c._id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/60"
                            onClick={() => { setCustomer(c); setShowResults(false); setCustomerQuery('') }}>
                            {c.name}{c.email ? <span className="text-muted-foreground"> · {c.email}</span> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.6fr] gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Event Type</Label>
                  <select className={selectCls} value={eventTypeID} onChange={(e) => setEventTypeID(e.target.value)}>
                    <option value="">Select…</option>
                    {eventTypes.map((et) => <option key={et._id} value={et._id}>{et.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Saved Template or Custom Name</Label>
                  <select className={selectCls} value={templateID} onChange={(e) => applyTemplate(e.target.value)}>
                    <option value="">Custom purchase</option>
                    {templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cep-name">Purchase name</Label>
                <Input id="cep-name" placeholder="e.g. AODC New Jersey 2026" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <p className="text-xs text-muted-foreground -mb-2">
                Give a product an event date to auto-check it once that time passes; leave it blank to check it off manually from the customer profile.
              </p>

              <LineItemsEditor
                items={items}
                setItems={setItems}
                products={products}
                showDate
                footerExtra={(
                  <button
                    type="button"
                    onClick={() => setSaveAsTemplate((v) => !v)}
                    aria-pressed={saveAsTemplate}
                    className={[
                      'ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 h-9 text-sm font-medium transition-colors',
                      saveAsTemplate ? 'border-brand bg-brand/5 text-brand' : 'border-brand/60 text-brand hover:bg-brand/5',
                    ].join(' ')}
                  >
                    {saveAsTemplate ? '✓ Will save as template' : 'Save as Template'}
                  </button>
                )}
              />

              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3.5">
                <span className="text-sm font-medium text-muted-foreground">Payable Balance</span>
                <span className="text-xl font-semibold tabular-nums">{money(payable)}</span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-5">
              <div className="rounded-xl border border-border overflow-hidden text-sm">
                <div className="flex justify-between px-4 py-2.5"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(totals.subtotal)}</span></div>
                <div className="flex justify-between px-4 py-2.5 border-t border-border"><span className="text-muted-foreground">Discounts</span><span className="tabular-nums">−{money(totals.discount)}</span></div>
                <div className="flex justify-between px-4 py-3 border-t border-border bg-muted/30 font-semibold"><span>Payable Balance</span><span className="tabular-nums">{money(payable)}</span></div>
              </div>

              {/* Billing type */}
              <div className="inline-flex rounded-lg border border-border bg-background p-0.5 w-fit">
                {[
                  { v: 'one_time', label: 'One-time' },
                  { v: 'payment_plan', label: 'Payment plan' },
                  { v: 'flexible', label: 'Flexible' },
                ].map((o) => (
                  <button key={o.v} type="button" onClick={() => setBillingType(o.v)}
                    className={['h-8 px-4 rounded-md text-[13px] font-medium transition-colors', billingType === o.v ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground'].join(' ')}>
                    {o.label}
                  </button>
                ))}
              </div>

              {/* Method + date (shared) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Payment method</Label>
                  <select className={selectCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Bank transfer / other</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cep-date">Payment date</Label>
                  <Input id="cep-date" type="date" value={collectDate} onChange={(e) => setCollectDate(e.target.value)} />
                </div>
              </div>

              {billingType === 'one_time' && (
                <>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} />
                    Collect the full balance now
                  </label>
                  {!collectNow ? (
                    <p className="text-xs text-muted-foreground">Recorded as unpaid — collect later from the customer’s Events &amp; Purchases tab.</p>
                  ) : (
                    <>
                      <div className="rounded-xl border border-border p-4 flex flex-col gap-3">
                        <label className="flex items-center justify-between gap-2 text-sm font-medium">
                          <span className="flex items-center gap-2">
                            <input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} disabled={walletBalance == null} />
                            Use account wallet balance
                          </span>
                          <span className="text-xs font-normal text-muted-foreground">{walletBalance == null ? 'no wallet' : `available ${money(walletBalance)}`}</span>
                        </label>
                        {useWallet && walletBalance != null && (
                          <>
                            <Input type="number" min="0" step="0.01" placeholder={String(Math.min(payable, walletBalance))} value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)} className="w-[180px]" />
                            {walletOver && <p className="text-xs text-destructive">Exceeds the wallet balance.</p>}
                          </>
                        )}
                      </div>
                      <div className="rounded-xl border border-border p-4 flex flex-col gap-3">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <input type="checkbox" checked={tipEnabled} onChange={(e) => setTipEnabled(e.target.checked)} />
                          Add a tip for a teacher
                        </label>
                        {tipEnabled && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <select className={selectCls} value={tipTeacherID} onChange={(e) => setTipTeacherID(e.target.value)}>
                              <option value="">Select teacher…</option>
                              {teachers.map((t) => <option key={t._id} value={t._id}>{t.name || t.email}</option>)}
                            </select>
                            <Input type="number" min="0" step="0.01" placeholder="Tip amount" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)} />
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-border bg-muted/30 text-sm divide-y divide-border">
                        {walletApplied > 0 && <div className="flex justify-between px-4 py-2.5"><span className="text-muted-foreground">From wallet</span><span className="tabular-nums">{money(walletApplied)}</span></div>}
                        <div className="flex justify-between px-4 py-2.5"><span className="text-muted-foreground">{payMethod === 'card' ? 'On card' : `By ${payMethod}`}</span><span className="tabular-nums">{money(methodCharge)}</span></div>
                        {tipEnabled && Number(tipAmount) > 0 && (
                          <div className="flex justify-between px-4 py-2.5"><span className="text-muted-foreground">Teacher tip (recorded separately)</span><span className="tabular-nums">{money(Number(tipAmount))}</span></div>
                        )}
                        <div className="flex justify-between px-4 py-3 font-semibold"><span>Total collected</span><span className="tabular-nums">{money(payable)}</span></div>
                      </div>
                    </>
                  )}
                </>
              )}

              {isPlan && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="plan-count"># of installments</Label>
                      <Input id="plan-count" type="number" min="2" value={planCount} onChange={(e) => setPlanCount(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Frequency</Label>
                      <select className={selectCls} value={planFreq} onChange={(e) => setPlanFreq(e.target.value)}>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Every 2 weeks</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="plan-start">First payment date</Label>
                      <Input id="plan-start" type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm flex justify-between">
                    <span className="text-muted-foreground">{planCountN} payments of</span>
                    <span className="font-semibold tabular-nums">{money(perInstallment)}</span>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} />
                    Collect the first installment now ({money(perInstallment)})
                  </label>
                </>
              )}

              {isFlex && (
                <>
                  <div className="inline-flex rounded-lg border border-border bg-background p-0.5 w-fit">
                    {[{ v: 'single', label: 'Single due date' }, { v: 'custom', label: 'Custom schedule' }].map((o) => (
                      <button key={o.v} type="button" onClick={() => setFlexMode(o.v)}
                        className={['h-7 px-3 rounded-md text-[12px] font-medium', flexMode === o.v ? 'bg-brand text-brand-foreground' : 'text-muted-foreground'].join(' ')}>
                        {o.label}
                      </button>
                    ))}
                  </div>

                  {flexMode === 'single' ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="flex-due">Due date for {money(payable)}</Label>
                      <Input id="flex-due" type="date" value={flexDueDate} onChange={(e) => setFlexDueDate(e.target.value)} className="w-[220px]" />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {flexRows.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input type="date" value={r.dueDate} onChange={(e) => setFlexRows((p) => p.map((x, idx) => idx === i ? { ...x, dueDate: e.target.value } : x))} className="w-[170px]" />
                          <Input type="number" min="0" step="0.01" placeholder="Amount" value={r.amount} onChange={(e) => setFlexRows((p) => p.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))} className="w-[120px]" />
                          {flexRows.length > 1 && (
                            <button type="button" onClick={() => setFlexRows((p) => p.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                          )}
                        </div>
                      ))}
                      <button type="button" onClick={() => setFlexRows((p) => [...p, { dueDate: todayISO(), amount: '' }])}
                        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-3 h-8 text-[13px] font-medium text-muted-foreground hover:text-foreground">
                        <Plus className="h-3.5 w-3.5" /> Add installment
                      </button>
                      <p className={['text-xs', flexBalanced ? 'text-muted-foreground' : 'text-destructive'].join(' ')}>
                        Scheduled {money(flexTotal)} of {money(payable)}{flexBalanced ? ' ✓' : ` — ${money(payable - flexTotal)} unallocated`}
                      </p>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} />
                    Collect the first installment now
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          {step === 1 ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" onClick={() => setStep(2)} disabled={!canProceed}>Next: Payment →</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>← Back</Button>
              <Button
                type="button"
                onClick={submit}
                disabled={saving || walletOver || (isPlan && planCountN < 2) || (isFlex && flexMode === 'custom' && !flexBalanced)}
              >
                {saving
                  ? 'Saving…'
                  : isPlan
                    ? 'Create payment plan'
                    : isFlex
                      ? 'Create schedule'
                      : collectNow
                        ? (payMethod === 'card' ? 'Create & open checkout' : 'Create & record payment')
                        : 'Create purchase'}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
